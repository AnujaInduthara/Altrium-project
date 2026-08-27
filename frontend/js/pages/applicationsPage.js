// Applications page controller: mounts the app shell, enforces the HR-only
// route, lets the HR user pick one of their vacancies and shows the CV
// applications submitted to it — applicant details + a "View CV" action that
// opens a short-lived signed URL.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { ApplicationService } from '../services/applicationService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { readParam, withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  selected: 'Selected',
};

// PB-05 — AI screening is advisory. These are screening states, NOT hiring
// outcomes; the applicant's own status stays "Submitted".
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

const SCREENING_ERROR_NOTES = {
  CV_EXTRACTION_ERROR:
    'The CV text could not be read (it may be a scanned image). The application is still available for manual review.',
  AI_PROVIDER_ERROR: 'The AI service could not be reached. You can re-run screening.',
  AI_TIMEOUT: 'AI screening timed out. You can re-run screening.',
  INVALID_AI_RESPONSE: 'AI screening returned an unusable result. You can re-run screening.',
  DEPENDENCY_MISSING: 'AI screening could not be completed for this application.',
  UNKNOWN_ERROR: 'AI screening could not be completed. The application remains available for manual review.',
};

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'applications',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('applications-page');
const alert = createAlert($('applications-alert'));
const select = $('vacancy-select');
const countEl = $('applications-count');
const loadingEl = $('applications-loading');
const promptEl = $('applications-prompt');
const emptyEl = $('applications-empty');
const listEl = $('applications-list');
const cardTemplate = $('application-card-template');

let loadToken = 0;

// --- helpers ---------------------------------------------------------------

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function setView(view) {
  loadingEl.hidden = view !== 'loading';
  promptEl.hidden = view !== 'prompt';
  emptyEl.hidden = view !== 'empty';
  listEl.hidden = view !== 'list';
  if (view !== 'list' && view !== 'empty') {
    countEl.hidden = true;
    countEl.textContent = '';
  }
}

// --- rendering -----------------------------------------------------------

function renderApplication(application) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  const set = (sel, value) => {
    node.querySelector(sel).textContent = value == null ? '' : String(value);
  };

  set('[data-name]', application.full_name);

  const statusKey = String(application.status || 'submitted').toLowerCase();
  const statusEl = node.querySelector('[data-status]');
  statusEl.textContent = STATUS_LABELS[statusKey] || application.status || 'Submitted';
  if (statusKey === 'submitted') statusEl.classList.add('badge--published');

  set('[data-email]', application.email);
  set('[data-phone]', application.phone);
  set('[data-location]', application.location);
  set('[data-submitted]', formatDate(application.created_at));
  set('[data-reference]', application.reference);

  node.querySelector('[data-email-link]').href = `mailto:${application.email}`;
  node.querySelector('[data-phone-link]').href = `tel:${String(application.phone).replace(/[^\d+]/g, '')}`;

  const cvMeta = [
    application.cv_content_type === 'application/pdf'
      ? 'PDF'
      : application.cv_content_type
        ? 'DOCX'
        : '',
    formatBytes(application.cv_size_bytes),
  ]
    .filter(Boolean)
    .join(' · ');
  node.querySelector('[data-cv-meta]').textContent = cvMeta;

  const cvBtn = node.querySelector('[data-view-cv]');
  cvBtn.addEventListener('click', () => openCv(application.id, cvBtn));

  renderScreening(node, application);

  return node;
}

// --- PB-05 screening summary -------------------------------------------

function renderScreening(node, application) {
  const wrap = node.querySelector('[data-screening]');
  if (!wrap) return;
  const screening = application.screening || { status: 'not_started' };
  const status = String(screening.status || 'not_started');

  wrap.hidden = false;

  const statusEl = wrap.querySelector('[data-screening-status]');
  statusEl.textContent = SCREENING_STATUS_LABELS[status] || status;
  statusEl.classList.toggle('badge--published', status === 'completed');
  statusEl.classList.toggle('badge--closed', status === 'failed');

  const body = wrap.querySelector('[data-screening-body]');
  const note = wrap.querySelector('[data-screening-note]');
  const retryBtn = wrap.querySelector('[data-screening-retry]');
  body.hidden = true;
  note.hidden = true;
  retryBtn.hidden = true;

  if (status === 'completed') {
    body.hidden = false;
    wrap.querySelector('[data-screening-score]').textContent =
      typeof screening.score === 'number' ? String(screening.score) : '—';
    const recEl = wrap.querySelector('[data-screening-rec]');
    recEl.textContent = RECOMMENDATION_LABELS[screening.recommendation] || screening.recommendation || '';

    const rankEl = wrap.querySelector('[data-screening-rank]');
    if (screening.ai_screening_rank) {
      rankEl.hidden = false;
      rankEl.textContent = `AI rank #${screening.ai_screening_rank}`;
    } else {
      rankEl.hidden = true;
    }

    wrap.querySelector('[data-screening-summary]').textContent = screening.summary || '';
    fillSkillList(wrap, '[data-screening-matched]', '[data-screening-matched-list]', screening.matched_skills);
    fillSkillList(wrap, '[data-screening-missing]', '[data-screening-missing-list]', screening.missing_skills);
  } else if (status === 'failed') {
    note.hidden = false;
    note.textContent =
      SCREENING_ERROR_NOTES[screening.error_code] || SCREENING_ERROR_NOTES.UNKNOWN_ERROR;
    retryBtn.hidden = false;
    retryBtn.onclick = () => retryScreening(application.id, retryBtn);
  } else if (status === 'pending' || status === 'processing') {
    note.hidden = false;
    note.textContent =
      status === 'processing'
        ? 'AI screening is currently being processed.'
        : 'AI screening is waiting to be processed.';
  }
}

function fillSkillList(wrap, groupSel, listSel, skills) {
  const group = wrap.querySelector(groupSel);
  const list = wrap.querySelector(listSel);
  const items = Array.isArray(skills) ? skills.filter(Boolean) : [];
  if (items.length === 0) {
    group.hidden = true;
    return;
  }
  group.hidden = false;
  list.textContent = items.join(', ');
}

async function retryScreening(applicationId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Re-running…';
  try {
    const { ok, status, body } = await ApplicationService.retryScreening(applicationId);
    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (ok) {
      alert.hide();
      // Refresh the list so the new screening state shows.
      await loadApplications(select.value);
      return;
    }
    alert.error(body?.error?.message || 'Unable to re-run AI screening right now.');
  } catch (err) {
    alert.error('Unable to re-run AI screening. Please check your connection and try again.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderList(applications) {
  listEl.replaceChildren(...applications.map(renderApplication));
  countEl.textContent =
    applications.length === 1 ? '1 applicant' : `${applications.length} applicants`;
  countEl.hidden = false;
  setView('list');
}

// --- CV viewing ---------------------------------------------------------

async function openCv(applicationId, button) {
  // Open the tab synchronously (inside the click) so it isn't blocked as a
  // pop-up, then point it at the signed URL once we have it. No 'noopener' in
  // the features string (that would make window.open return null); we null the
  // opener ourselves instead.
  const cvWindow = window.open('about:blank', '_blank');
  if (cvWindow) {
    try { cvWindow.opener = null; } catch (err) { /* cross-origin, ignore */ }
  }
  const label = button.querySelector('[data-label]');
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
      if (cvWindow) {
        cvWindow.location = body.data.url;
      } else {
        // Pop-up was blocked despite the sync open — fall back to same tab.
        window.location.assign(body.data.url);
      }
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

// --- data loading -----------------------------------------------------

async function loadApplications(vacancyId) {
  alert.hide();

  if (!vacancyId) {
    setView('prompt');
    return;
  }

  const thisLoad = ++loadToken;
  setView('loading');

  try {
    const { ok, status, body } = await ApplicationService.listForVacancy(vacancyId);
    if (thisLoad !== loadToken) return; // a newer selection superseded this one

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok) {
      setView('prompt');
      alert.error(body?.error?.message || 'Unable to load applications. Please try again later.');
      return;
    }

    const applications = (body && body.data && body.data.applications) || [];
    if (applications.length === 0) {
      setView('empty');
    } else {
      renderList(applications);
    }
  } catch (err) {
    if (thisLoad !== loadToken) return;
    setView('prompt');
    alert.error('Unable to load applications. Please check your connection and try again.');
  }
}

const VACANCY_STATUS_LABELS = { published: 'Published', closed: 'Closed', draft: 'Draft' };

function populateVacancies(vacancies) {
  // Published first, then closed, then drafts; newest first within each group.
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
        'Create and publish a vacancy first — applications will show up here.';
      return;
    }

    populateVacancies(vacancies);

    const preselect = readParam('vacancy');
    if (preselect && [...select.options].some((o) => o.value === preselect)) {
      select.value = preselect;
      await loadApplications(preselect);
    }
  } catch (err) {
    alert.error('Unable to load your vacancies. Please check your connection and try again.');
  }
}

select.addEventListener('change', () => {
  const id = select.value;
  // Keep the selection in the URL so a refresh / back keeps context.
  history.replaceState(null, '', id ? withHashParam('applications.html', 'vacancy', id) : 'applications.html');
  loadApplications(id);
});

document.addEventListener('DOMContentLoaded', init);
