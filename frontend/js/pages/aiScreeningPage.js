// AI Screening page controller: mounts the app shell, enforces the HR-only
// route, lets the HR user pick one of their vacancies and shows every applicant
// in a results table ranked by their AI CV-match score.
//
// PB-05 — AI screening is advisory. The score / recommendation / rank never
// change the applicant's own status and are never a hiring decision. Screening
// runs automatically after an application is submitted; this page also lets HR
// (re)run it for candidates still pending or previously failed.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { ApplicationService } from '../services/applicationService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { readParam, withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

// Short chip text for a screening that has not produced a score yet.
const SCREENING_CHIP_LABELS = {
  not_started: 'Not screened',
  pending: 'Queued',
  processing: 'Processing…',
  failed: 'Unavailable',
};

const MATCH_LABELS = {
  STRONG: 'Strong',
  MODERATE: 'Moderate',
  WEAK: 'Weak',
  NOT_APPLICABLE: 'Not applicable',
  NOT_DEMONSTRATED: 'Not shown',
  INSUFFICIENT_INFORMATION: 'Not shown',
};

// Applicant status (owned by HR, never by the AI) -> badge label + colour.
const APP_STATUS = {
  submitted: { label: 'New', cls: 'badge--neutral' },
  under_review: { label: 'Review', cls: 'badge--warning' },
  shortlisted: { label: 'Shortlisted', cls: 'badge--success' },
  selected: { label: 'Selected', cls: 'badge--success' },
  rejected: { label: 'Rejected', cls: 'badge--danger' },
};

const SCREENING_ERROR_NOTES = {
  CV_EXTRACTION_ERROR:
    'The CV text could not be read (it may be a scanned image). The application is still available for manual review.',
  AI_PROVIDER_ERROR: 'The AI service could not be reached. You can re-run screening.',
  AI_TIMEOUT: 'AI screening timed out. You can re-run screening.',
  INVALID_AI_RESPONSE: 'AI screening returned an unusable result. You can re-run screening.',
  DEPENDENCY_MISSING: 'AI screening could not be completed for this application.',
  UNKNOWN_ERROR: 'AI screening could not be completed. The application remains available for manual review.',
};

// Display order: completed (highest score first), then in-flight, then failed,
// then never-run.
const STATUS_ORDER = { completed: 0, processing: 1, pending: 2, failed: 3, not_started: 4 };

const REFRESH_MS = 5000;
const MAX_AUTO_REFRESHES = 60; // ~5 min ceiling on background polling

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'ai-screening',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('screening-page');
const alert = createAlert($('screening-alert'));
const select = $('vacancy-select');
const statusFilter = $('status-filter');
const searchInput = $('candidate-search');
const runBtn = $('screening-run');
const summaryEl = $('screening-summary');
const vacancyEl = $('screening-vacancy');
const loadingEl = $('screening-loading');
const promptEl = $('screening-prompt');
const emptyEl = $('screening-empty');
const noMatchEl = $('screening-no-match');
const resultsEl = $('screening-results');
const tbodyEl = $('screening-tbody');
const rowTemplate = $('screening-row-template');

let loadToken = 0;
let refreshTimer = null;
let refreshCount = 0;

// The full, unfiltered application list for the selected vacancy, plus the
// completed-only ranking. Filter / search re-render from these without a fetch.
let currentApplications = [];
let rankByApplication = new Map();

// --- helpers -------------------------------------------------------------

function setView(view) {
  loadingEl.hidden = view !== 'loading';
  promptEl.hidden = view !== 'prompt';
  emptyEl.hidden = view !== 'empty';
  noMatchEl.hidden = view !== 'nomatch';
  resultsEl.hidden = view !== 'results';
  summaryEl.hidden = view !== 'results';
  // The vacancy sub-header stays useful once a vacancy is chosen.
  vacancyEl.hidden = !(view === 'results' || view === 'empty' || view === 'nomatch');
  if (view !== 'results' && view !== 'nomatch') {
    runBtn.hidden = true;
    stopAutoRefresh();
  }
}

function renderVacancyHeader(vacancy) {
  if (!vacancy || !vacancy.job_title) {
    vacancyEl.hidden = true;
    vacancyEl.textContent = '';
    return;
  }
  const meta = [vacancy.department, vacancy.location].filter(Boolean).join(' · ');
  vacancyEl.textContent = meta ? `${vacancy.job_title} — ${meta}` : vacancy.job_title;
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleAutoRefresh(vacancyId) {
  stopAutoRefresh();
  if (refreshCount >= MAX_AUTO_REFRESHES) return;
  refreshTimer = setTimeout(() => {
    refreshCount += 1;
    loadScreenings(vacancyId, { silent: true });
  }, REFRESH_MS);
}

function screeningOf(application) {
  return application.screening || { status: 'not_started' };
}

function statusKey(application) {
  return String(screeningOf(application).status || 'not_started');
}

function candidateName(application) {
  return screeningOf(application).candidate_name || application.full_name || 'Applicant';
}

function sortApplications(applications) {
  return [...applications].sort((a, b) => {
    const sa = screeningOf(a);
    const sb = screeningOf(b);
    const orderA = STATUS_ORDER[sa.status] ?? 5;
    const orderB = STATUS_ORDER[sb.status] ?? 5;
    if (orderA !== orderB) return orderA - orderB;
    if (sa.status === 'completed') {
      const scoreA = typeof sa.score === 'number' ? sa.score : -1;
      const scoreB = typeof sb.score === 'number' ? sb.score : -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
    }
    return candidateName(a).localeCompare(candidateName(b));
  });
}

function summarize(applications) {
  const counts = { completed: 0, processing: 0, pending: 0, failed: 0, not_started: 0 };
  for (const application of applications) {
    const key = statusKey(application);
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

function computeRanks(applications) {
  const map = new Map();
  const completed = sortApplications(
    applications.filter((a) => statusKey(a) === 'completed')
  );
  completed.forEach((application, index) => map.set(application.id, index + 1));
  return map;
}

// "Skills Match" qualitative label — derived from the matched vs missing skill
// evidence, falling back to the advisory recommendation when no skill lists are
// present.
function skillsMatch(screening) {
  const count = (list) => (Array.isArray(list) ? list.filter(Boolean).length : 0);
  const matched = count(screening.matched_skills);
  const missing = count(screening.missing_skills);
  const total = matched + missing;

  let ratio;
  if (total > 0) {
    ratio = matched / total;
  } else {
    const byRec = {
      STRONG_MATCH: 0.95,
      GOOD_MATCH: 0.75,
      PARTIAL_MATCH: 0.5,
      WEAK_MATCH: 0.25,
    };
    ratio = byRec[screening.recommendation];
    if (ratio == null) return { label: '—', band: 'none' };
  }

  if (ratio >= 0.85) return { label: 'Excellent', band: 'excellent' };
  if (ratio >= 0.65) return { label: 'Very Good', band: 'good' };
  if (ratio >= 0.4) return { label: 'Good', band: 'ok' };
  return { label: 'Average', band: 'low' };
}

function scoreBand(score) {
  if (score >= 70) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

function reviewHref(applicationId) {
  const vacancyId = select.value;
  return vacancyId
    ? `applicant-review.html#id=${encodeURIComponent(applicationId)}&vacancy=${encodeURIComponent(vacancyId)}`
    : `applicant-review.html#id=${encodeURIComponent(applicationId)}`;
}

// --- rendering ----------------------------------------------------------

function renderSummary(counts, total, applications) {
  const set = (sel, value, show = true) => {
    const el = summaryEl.querySelector(sel);
    el.textContent = value;
    el.hidden = !show;
  };
  set('[data-summary-total]', `${total} applicant${total === 1 ? '' : 's'}`);
  set('[data-summary-completed]', `${counts.completed} screened`);

  const scores = applications
    .map((a) => screeningOf(a))
    .filter((s) => s.status === 'completed' && typeof s.score === 'number')
    .map((s) => s.score);
  if (scores.length > 0) {
    const avg = Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length);
    const top = Math.max(...scores);
    set('[data-summary-average]', `Average score ${avg}%`, true);
    set('[data-summary-top]', `Top match ${top}%`, true);
  } else {
    set('[data-summary-average]', '', false);
    set('[data-summary-top]', '', false);
  }

  const running = counts.processing + counts.pending;
  set('[data-summary-running]', `${running} in progress`, running > 0);
  set('[data-summary-failed]', `${counts.failed} unavailable`, counts.failed > 0);
  set('[data-summary-pending]', `${counts.not_started} not started`, counts.not_started > 0);
}

function buildRow(application) {
  const node = rowTemplate.content.firstElementChild.cloneNode(true);
  const screening = screeningOf(application);
  const status = statusKey(application);
  const href = reviewHref(application.id);
  const name = candidateName(application);

  const nameEl = node.querySelector('[data-name]');
  nameEl.textContent = name;
  nameEl.href = href;
  node.querySelector('[data-ref]').textContent = application.reference || '';

  // Whole row navigates to the read-only review, except clicks on the Re-run
  // control (or the name link, which navigates on its own).
  node.addEventListener('click', (event) => {
    if (event.target.closest('a') || event.target.closest('[data-rerun]')) return;
    window.location.assign(href);
  });

  const scoreCell = node.querySelector('[data-score-cell]');
  const chip = node.querySelector('[data-score-chip]');
  const rerunBtn = node.querySelector('[data-rerun]');

  if (status === 'completed' && typeof screening.score === 'number') {
    const score = Math.max(0, Math.min(100, screening.score));
    scoreCell.hidden = false;
    node.querySelector('[data-score]').textContent = `${score}%`;
    const fill = node.querySelector('[data-fill]');
    fill.style.width = `${score}%`;
    fill.dataset.band = scoreBand(score);
  } else {
    chip.hidden = false;
    chip.textContent = SCREENING_CHIP_LABELS[status] || 'Not screened';
    chip.classList.toggle('screening-chip--warn', status === 'failed');

    if (status === 'failed' || status === 'not_started' || status === 'pending') {
      rerunBtn.hidden = false;
      rerunBtn.textContent = status === 'failed' ? 'Re-run' : 'Run now';
      rerunBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        rerunOne(application.id, rerunBtn);
      });
      if (status === 'failed' && screening.error_code) {
        rerunBtn.title = SCREENING_ERROR_NOTES[screening.error_code] || SCREENING_ERROR_NOTES.UNKNOWN_ERROR;
      }
    }
  }

  const skills = node.querySelector('[data-skills]');
  if (status === 'completed') {
    const sm = skillsMatch(screening);
    skills.textContent = sm.label;
    skills.dataset.band = sm.band;
  }

  if (status === 'completed') {
    node.querySelector('[data-exp]').textContent =
      MATCH_LABELS[screening.experience_match] || '—';
    node.querySelector('[data-edu]').textContent =
      MATCH_LABELS[screening.education_match] || '—';
  }

  const rankEl = node.querySelector('[data-rank]');
  const rank = rankByApplication.get(application.id);
  if (rank) rankEl.textContent = String(rank);

  const badge = node.querySelector('[data-status]');
  const meta = APP_STATUS[application.status] || { label: application.status || 'New', cls: 'badge--neutral' };
  badge.textContent = meta.label;
  badge.classList.add(meta.cls);

  return node;
}

function applyFilters() {
  if (currentApplications.length === 0) return;

  const wanted = statusFilter.value;
  const query = searchInput.value.trim().toLowerCase();

  const filtered = currentApplications.filter((application) => {
    if (wanted !== 'all' && application.status !== wanted) return false;
    if (query && !candidateName(application).toLowerCase().includes(query)) return false;
    return true;
  });

  if (filtered.length === 0) {
    setView('nomatch');
    return;
  }

  tbodyEl.replaceChildren(...sortApplications(filtered).map(buildRow));
  setView('results');
}

function renderList(applications) {
  currentApplications = applications;
  rankByApplication = computeRanks(applications);

  const counts = summarize(applications);
  renderSummary(counts, applications.length, applications);

  const hasRunnable = counts.pending + counts.failed + counts.not_started > 0;
  runBtn.hidden = !hasRunnable;

  applyFilters();

  // Keep refreshing while anything is still in flight.
  if (counts.processing + counts.pending > 0) {
    scheduleAutoRefresh(select.value);
  } else {
    refreshCount = 0;
    stopAutoRefresh();
  }
}

// --- actions ----------------------------------------------------------

async function rerunOne(applicationId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Queuing…';
  try {
    const { ok, status, body } = await ApplicationService.retryScreening(applicationId);
    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (ok) {
      alert.hide();
      refreshCount = 0;
      await loadScreenings(select.value, { silent: true });
      return;
    }
    alert.error(body?.error?.message || 'Unable to run AI screening right now.');
  } catch (err) {
    alert.error('Unable to run AI screening. Please check your connection and try again.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function runPending() {
  const vacancyId = select.value;
  if (!vacancyId) return;
  const original = runBtn.textContent;
  runBtn.disabled = true;
  runBtn.textContent = 'Queuing…';
  try {
    const { ok, status, body } = await ApplicationService.runPendingScreenings(vacancyId);
    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (ok) {
      alert.success(body?.data?.message || 'AI screening has been queued.');
      refreshCount = 0;
      await loadScreenings(vacancyId, { silent: true });
      return;
    }
    alert.error(body?.error?.message || 'Unable to run pending screenings right now.');
  } catch (err) {
    alert.error('Unable to run pending screenings. Please check your connection and try again.');
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = original;
  }
}

// --- data loading ----------------------------------------------------

async function loadScreenings(vacancyId, { silent = false } = {}) {
  if (!silent) alert.hide();

  if (!vacancyId) {
    currentApplications = [];
    setView('prompt');
    return;
  }

  const thisLoad = ++loadToken;
  if (!silent) setView('loading');

  try {
    const { ok, status, body } = await ApplicationService.listForVacancy(vacancyId);
    if (thisLoad !== loadToken) return; // superseded

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok) {
      if (!silent) setView('prompt');
      alert.error(body?.error?.message || 'Unable to load screening results. Please try again later.');
      return;
    }

    const applications = (body && body.data && body.data.applications) || [];
    renderVacancyHeader(body && body.data && body.data.vacancy);
    if (applications.length === 0) {
      currentApplications = [];
      setView('empty');
    } else {
      renderList(applications);
    }
  } catch (err) {
    if (thisLoad !== loadToken) return;
    if (!silent) setView('prompt');
    alert.error('Unable to load screening results. Please check your connection and try again.');
  }
}

const VACANCY_STATUS_LABELS = { published: 'Published', closed: 'Closed', draft: 'Draft' };

function populateVacancies(vacancies) {
  const order = { published: 0, closed: 1, draft: 2 };
  const sorted = [...vacancies].sort((a, b) => {
    const byStatus = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (byStatus !== 0) return byStatus;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  for (const vacancy of sorted) {
    const option = document.createElement('option');
    option.value = vacancy.id;
    const label = VACANCY_STATUS_LABELS[vacancy.status] || vacancy.status;
    option.textContent = label ? `${vacancy.job_title} — ${label}` : vacancy.job_title;
    select.appendChild(option);
  }
}

async function init() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });
  page.hidden = false;

  try {
    const { ok, status, body } = await VacancyService.list();
    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (!ok) {
      alert.error(body?.error?.message || 'Unable to load your vacancies. Please try again later.');
      return;
    }

    const vacancies = (body && body.data && body.data.vacancies) || [];
    if (vacancies.length === 0) {
      promptEl.querySelector('.heading-lg').textContent = 'No vacancies yet';
      promptEl.querySelector('.text-muted').textContent =
        'Create and publish a vacancy first — screened candidates will show up here.';
      return;
    }

    populateVacancies(vacancies);

    const preselect = readParam('vacancy');
    if (preselect && [...select.options].some((o) => o.value === preselect)) {
      select.value = preselect;
      await loadScreenings(preselect);
    }
  } catch (err) {
    alert.error('Unable to load your vacancies. Please check your connection and try again.');
  }
}

select.addEventListener('change', () => {
  const id = select.value;
  refreshCount = 0;
  stopAutoRefresh();
  history.replaceState(
    null,
    '',
    id ? withHashParam('ai-screening.html', 'vacancy', id) : 'ai-screening.html'
  );
  loadScreenings(id);
});

statusFilter.addEventListener('change', applyFilters);
searchInput.addEventListener('input', applyFilters);
runBtn.addEventListener('click', runPending);

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', stopAutoRefresh);
