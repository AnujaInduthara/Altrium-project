// AI Screening page controller: mounts the app shell, enforces the HR-only
// route, lets the HR user pick one of their vacancies and shows every applicant
// ranked by their AI CV-match score.
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

const SCREENING_STATUS_LABELS = {
  not_started: 'Not started',
  pending: 'Queued',
  processing: 'Processing…',
  completed: 'Completed',
  failed: 'Unavailable',
};

const RECOMMENDATION_LABELS = {
  STRONG_MATCH: 'Strong match',
  GOOD_MATCH: 'Good match',
  PARTIAL_MATCH: 'Partial match',
  WEAK_MATCH: 'Weak match',
  INSUFFICIENT_INFORMATION: 'Insufficient information',
};

const MATCH_LABELS = {
  STRONG: 'Strong',
  MODERATE: 'Moderate',
  WEAK: 'Weak',
  NOT_APPLICABLE: 'Not applicable',
  NOT_DEMONSTRATED: 'Not demonstrated',
  INSUFFICIENT_INFORMATION: 'Insufficient info',
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
const runBtn = $('screening-run');
const summaryEl = $('screening-summary');
const vacancyEl = $('screening-vacancy');
const footNoteEl = $('screening-foot-note');
const loadingEl = $('screening-loading');
const promptEl = $('screening-prompt');
const emptyEl = $('screening-empty');
const listEl = $('screening-list');
const cardTemplate = $('screening-card-template');

let loadToken = 0;
let refreshTimer = null;
let refreshCount = 0;

// --- helpers -------------------------------------------------------------

function setView(view) {
  loadingEl.hidden = view !== 'loading';
  promptEl.hidden = view !== 'prompt';
  emptyEl.hidden = view !== 'empty';
  listEl.hidden = view !== 'list';
  summaryEl.hidden = view !== 'list';
  footNoteEl.hidden = view !== 'list';
  // The vacancy sub-header is useful for both the populated list and the
  // "no applications yet" empty state.
  vacancyEl.hidden = view !== 'list' && view !== 'empty';
  if (view !== 'list') {
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
    return String(a.full_name || '').localeCompare(String(b.full_name || ''));
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

// --- rendering ----------------------------------------------------------

function renderSummary(counts, total, applications) {
  const set = (sel, value, show = true) => {
    const el = summaryEl.querySelector(sel);
    el.textContent = value;
    el.hidden = !show;
  };
  set('[data-summary-total]', `${total} applicant${total === 1 ? '' : 's'}`);
  set('[data-summary-completed]', `${counts.completed} screened`);

  // Average / top AI score across the completed screenings only.
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
  const notRun = counts.not_started;
  set('[data-summary-pending]', `${notRun} not started`, notRun > 0);
}

function fillSkillList(wrap, groupSel, listSel, skills) {
  const group = wrap.querySelector(groupSel);
  const items = Array.isArray(skills) ? skills.filter(Boolean) : [];
  if (items.length === 0) {
    group.hidden = true;
    return;
  }
  group.hidden = false;
  wrap.querySelector(listSel).textContent = items.join(', ');
}

function renderCard(application, rank) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  const screening = screeningOf(application);
  const status = String(screening.status || 'not_started');

  node.querySelector('[data-name]').textContent =
    screening.candidate_name || application.full_name || 'Applicant';

  const statusEl = node.querySelector('[data-status]');
  statusEl.textContent = SCREENING_STATUS_LABELS[status] || status;
  statusEl.classList.toggle('badge--published', status === 'completed');
  statusEl.classList.toggle('badge--closed', status === 'failed');

  const rankEl = node.querySelector('[data-rank]');
  if (status === 'completed' && rank) {
    rankEl.textContent = `#${rank}`;
  } else {
    rankEl.textContent = '';
    rankEl.classList.add('screening-card__rank--empty');
  }

  const scoreline = node.querySelector('[data-scoreline]');
  const meter = node.querySelector('[data-meter]');
  const matches = node.querySelector('[data-matches]');
  const summary = node.querySelector('[data-summary]');
  const note = node.querySelector('[data-note]');
  const rerunBtn = node.querySelector('[data-rerun]');

  if (status === 'completed') {
    scoreline.hidden = false;
    const score = typeof screening.score === 'number' ? screening.score : null;
    node.querySelector('[data-score]').textContent = score == null ? '—' : String(score);
    node.querySelector('[data-rec]').textContent =
      RECOMMENDATION_LABELS[screening.recommendation] || screening.recommendation || '';

    if (score != null) {
      meter.hidden = false;
      const fill = node.querySelector('[data-meter-fill]');
      fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
      fill.dataset.band = score >= 70 ? 'high' : score >= 50 ? 'mid' : 'low';
    }

    const exp = MATCH_LABELS[screening.experience_match];
    const edu = MATCH_LABELS[screening.education_match];
    if (exp || edu) {
      matches.hidden = false;
      node.querySelector('[data-exp]').textContent = exp ? `Experience: ${exp}` : '';
      node.querySelector('[data-edu]').textContent = edu ? `Education: ${edu}` : '';
    }

    if (screening.summary) {
      summary.hidden = false;
      summary.textContent = screening.summary;
    }
    fillSkillList(node, '[data-matched-wrap]', '[data-matched]', screening.matched_skills);
    fillSkillList(node, '[data-missing-wrap]', '[data-missing]', screening.missing_skills);

    rerunBtn.hidden = false;
    rerunBtn.textContent = 'Re-run';
  } else if (status === 'failed') {
    note.hidden = false;
    note.textContent = SCREENING_ERROR_NOTES[screening.error_code] || SCREENING_ERROR_NOTES.UNKNOWN_ERROR;
    rerunBtn.hidden = false;
    rerunBtn.textContent = 'Re-run';
  } else if (status === 'processing' || status === 'pending') {
    note.hidden = false;
    note.textContent =
      status === 'processing'
        ? 'AI screening is currently being processed.'
        : 'AI screening is queued.';
  } else {
    note.hidden = false;
    note.textContent = 'AI screening has not run for this application yet.';
    rerunBtn.hidden = false;
    rerunBtn.textContent = 'Run screening';
  }

  const viewLink = node.querySelector('[data-view]');
  const vacancyId = select.value;
  viewLink.href = vacancyId
    ? `applicant-review.html#id=${encodeURIComponent(application.id)}&vacancy=${encodeURIComponent(vacancyId)}`
    : `applicant-review.html#id=${encodeURIComponent(application.id)}`;
  viewLink.setAttribute(
    'aria-label',
    `Review ${screening.candidate_name || application.full_name || 'applicant'}`
  );

  const cvBtn = node.querySelector('[data-view-cv]');
  cvBtn.addEventListener('click', () => openCv(application.id, cvBtn));
  if (!rerunBtn.hidden) {
    rerunBtn.addEventListener('click', () => rerunOne(application.id, rerunBtn));
  }

  return node;
}

function renderList(applications) {
  const sorted = sortApplications(applications);
  let rank = 0;
  const nodes = sorted.map((application) => {
    const isCompleted = statusKey(application) === 'completed';
    if (isCompleted) rank += 1;
    return renderCard(application, isCompleted ? rank : null);
  });
  listEl.replaceChildren(...nodes);

  const counts = summarize(applications);
  renderSummary(counts, applications.length, applications);

  const hasRunnable = counts.pending + counts.failed + counts.not_started > 0;
  runBtn.hidden = !hasRunnable;

  setView('list');

  // Keep refreshing while anything is still in flight.
  if (counts.processing + counts.pending > 0) {
    scheduleAutoRefresh(select.value);
  } else {
    refreshCount = 0;
    stopAutoRefresh();
  }
}

// --- actions ----------------------------------------------------------

async function openCv(applicationId, button) {
  const cvWindow = window.open('about:blank', '_blank');
  if (cvWindow) {
    try { cvWindow.opener = null; } catch (err) { /* cross-origin, ignore */ }
  }
  const label = button.querySelector('[data-cv-label]');
  const original = label.textContent;
  button.disabled = true;
  label.textContent = 'Opening…';

  try {
    const { ok, status, body } = await ApplicationService.getCvLink(applicationId);
    if (status === 401) {
      if (cvWindow) cvWindow.close();
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (ok && body?.data?.url) {
      if (cvWindow) cvWindow.location = body.data.url;
      else window.location.assign(body.data.url);
    } else {
      if (cvWindow) cvWindow.close();
      alert.error(body?.error?.message || 'Unable to open this CV. Please try again.');
    }
  } catch (err) {
    if (cvWindow) cvWindow.close();
    alert.error('Unable to open this CV. Please check your connection and try again.');
  } finally {
    button.disabled = false;
    label.textContent = original;
  }
}

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

runBtn.addEventListener('click', runPending);

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', stopAutoRefresh);
