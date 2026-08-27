// Select Candidates page controller (PB-07). Mounts the app shell, enforces the
// HR-only route, lets HR pick one of their vacancies, and select applicants who
// should proceed as candidates for the next recruitment stage.
//
// The AI does NOT make this decision. PB-05 screening score / rank are shown to
// inform HR; the selection itself is an explicit, confirmed HR action. Selecting
// a candidate never changes or re-runs the AI screening, and never touches the
// CV.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { ApplicationService } from '../services/applicationService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { readParam, withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const SCREENING_CHIP_LABELS = {
  not_started: 'Not screened',
  pending: 'Queued',
  processing: 'Processing…',
  failed: 'Screening unavailable',
};

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'candidates',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('candidates-page');
const alert = createAlert($('candidates-alert'));
const modal = createModal($('confirm-modal'));

const select = $('vacancy-select');
const vacancyEl = $('candidates-vacancy');
const loadingEl = $('candidates-loading');
const promptEl = $('candidates-prompt');
const emptyEl = $('candidates-empty');
const noteEl = $('candidates-note');

const selectedSection = $('selected-section');
const selectedList = $('selected-list');
const selectedCountEl = $('selected-count');

const poolSection = $('pool-section');
const poolList = $('pool-list');
const selectionCountEl = $('selection-count');
const cancelBtn = $('cancel-btn');
const selectBtn = $('select-btn');
const confirmBtn = $('confirm-btn');
const confirmList = $('confirm-list');
const confirmIntro = $('confirm-modal-intro');

const poolRowTemplate = $('pool-row-template');
const selectedRowTemplate = $('selected-row-template');

let loadToken = 0;
let submitting = false;

// Applicants eligible for selection (status 'submitted'), in display order, plus
// the working set of chosen application ids.
let eligibleApplications = [];
const chosen = new Set();

// --- helpers -------------------------------------------------------------

function setView(view) {
  loadingEl.hidden = view !== 'loading';
  promptEl.hidden = view !== 'prompt';
  emptyEl.hidden = view !== 'empty';
  vacancyEl.hidden = !(view === 'results' || view === 'empty');
  noteEl.hidden = view !== 'results';
  // The selected / pool sections are shown explicitly by renderVacancy for the
  // 'results' and 'empty' views. Only the pre-data views clear them.
  if (view === 'loading' || view === 'prompt') {
    poolSection.hidden = true;
    selectedSection.hidden = true;
  }
}

function screeningOf(application) {
  return application.screening || { status: 'not_started' };
}

function candidateName(application) {
  return screeningOf(application).candidate_name || application.full_name || 'Applicant';
}

// Rank / score come straight from the persisted PB-05 screening — never
// recomputed here.
function rankOf(application) {
  const r = screeningOf(application).ai_screening_rank;
  return typeof r === 'number' ? r : null;
}

function scoreOf(application) {
  const s = screeningOf(application);
  return s.status === 'completed' && typeof s.score === 'number' ? s.score : null;
}

// Highest AI score first; unscored applicants last; then by name. AI ranking is
// informational only — nothing is auto-selected.
function sortForDisplay(applications) {
  return [...applications].sort((a, b) => {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sa !== sb) return (sb ?? -1) - (sa ?? -1);
    return candidateName(a).localeCompare(candidateName(b));
  });
}

function reviewHref(applicationId) {
  const vacancyId = select.value;
  return vacancyId
    ? `applicant-review.html#id=${encodeURIComponent(applicationId)}&vacancy=${encodeURIComponent(vacancyId)}`
    : `applicant-review.html#id=${encodeURIComponent(applicationId)}`;
}

function metaText(application) {
  return [application.email, application.reference].filter(Boolean).join(' · ');
}

function fillScore(node, application) {
  const score = scoreOf(application);
  const rank = rankOf(application);
  const scoreEl = node.querySelector('[data-score]');
  const rankEl = node.querySelector('[data-rank]');
  const chipEl = node.querySelector('[data-chip]');

  if (score !== null) {
    scoreEl.hidden = false;
    scoreEl.textContent = `AI score ${score}%`;
  }
  if (rank !== null) {
    rankEl.hidden = false;
    rankEl.textContent = `Rank #${rank}`;
  }
  if (score === null && chipEl) {
    const status = String(screeningOf(application).status || 'not_started');
    chipEl.hidden = false;
    chipEl.textContent = SCREENING_CHIP_LABELS[status] || 'Not screened';
  }
}

// --- rendering ----------------------------------------------------------

function updateSelectionCount() {
  const n = chosen.size;
  selectionCountEl.textContent = `${n} applicant${n === 1 ? '' : 's'} selected`;
  cancelBtn.disabled = submitting || n === 0;
}

function buildPoolRow(application) {
  const node = poolRowTemplate.content.firstElementChild.cloneNode(true);
  const checkbox = node.querySelector('[data-checkbox]');
  const name = candidateName(application);

  checkbox.value = application.id;
  checkbox.checked = chosen.has(application.id);
  checkbox.setAttribute('aria-label', `Select ${name}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) chosen.add(application.id);
    else chosen.delete(application.id);
    node.classList.toggle('is-selected', checkbox.checked);
    updateSelectionCount();
  });
  node.classList.toggle('is-selected', checkbox.checked);

  node.querySelector('[data-name]').textContent = name;
  node.querySelector('[data-meta]').textContent = metaText(application);
  fillScore(node, application);

  const view = node.querySelector('[data-view]');
  view.href = reviewHref(application.id);
  view.setAttribute('aria-label', `Review ${name}`);

  return node;
}

function buildSelectedRow(application) {
  const node = selectedRowTemplate.content.firstElementChild.cloneNode(true);
  const name = candidateName(application);
  node.querySelector('[data-name]').textContent = name;
  node.querySelector('[data-meta]').textContent = metaText(application);
  fillScore(node, application);
  const view = node.querySelector('[data-view]');
  view.href = reviewHref(application.id);
  view.setAttribute('aria-label', `Review ${name}`);
  return node;
}

function renderVacancy(vacancy, applications) {
  if (vacancy && vacancy.job_title) {
    const meta = [vacancy.department, vacancy.location].filter(Boolean).join(' · ');
    vacancyEl.textContent = meta ? `${vacancy.job_title} — ${meta}` : vacancy.job_title;
  }

  const selected = sortForDisplay(applications.filter((a) => a.status === 'selected'));
  eligibleApplications = sortForDisplay(applications.filter((a) => a.status === 'submitted'));

  // Drop any chosen ids that are no longer eligible (e.g. selected elsewhere).
  const eligibleIds = new Set(eligibleApplications.map((a) => a.id));
  for (const id of [...chosen]) if (!eligibleIds.has(id)) chosen.delete(id);

  // Selected candidates section.
  if (selected.length > 0) {
    selectedList.replaceChildren(...selected.map(buildSelectedRow));
    selectedCountEl.textContent =
      selected.length === 1
        ? '1 applicant has been selected by HR.'
        : `${selected.length} applicants have been selected by HR.`;
    selectedSection.hidden = false;
  } else {
    selectedSection.hidden = true;
  }

  // Eligible applicants pool.
  if (eligibleApplications.length > 0) {
    poolList.replaceChildren(...eligibleApplications.map(buildPoolRow));
    poolSection.hidden = false;
    setView('results');
  } else {
    poolSection.hidden = true;
    // Still show the vacancy header + any selected section.
    setView('empty');
    vacancyEl.hidden = false;
    noteEl.hidden = selected.length === 0;
  }

  updateSelectionCount();
}

// --- selection flow ---------------------------------------------------

function openConfirm() {
  alert.hide();
  if (chosen.size === 0) {
    alert.error('Please select at least one applicant.');
    return;
  }
  const names = eligibleApplications
    .filter((a) => chosen.has(a.id))
    .map((a) => candidateName(a));
  confirmIntro.textContent =
    names.length === 1
      ? 'You are about to select this applicant as a candidate:'
      : `You are about to select these ${names.length} applicants as candidates:`;
  confirmList.replaceChildren(
    ...names.map((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      return li;
    })
  );
  modal.open();
}

function setSubmitting(on) {
  submitting = on;
  confirmBtn.disabled = on;
  confirmBtn.setAttribute('aria-busy', String(on));
  confirmBtn.querySelector('[data-label]').textContent = on ? 'Selecting candidates…' : 'Confirm Selection';
  selectBtn.disabled = on;
  cancelBtn.disabled = on || chosen.size === 0;
}

async function submitSelection() {
  if (submitting) return;
  const vacancyId = select.value;
  const ids = [...chosen];
  if (!vacancyId || ids.length === 0) return;

  setSubmitting(true);
  try {
    const { ok, status, body } = await ApplicationService.selectCandidates(vacancyId, ids);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok) {
      modal.close();
      chosen.clear();
      const count = body?.data?.selectedCount ?? ids.length;
      alert.success(
        `${count} applicant${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} been selected to proceed to the next recruitment stage.`
      );
      await loadApplicants(vacancyId, { silent: true });
      selectedSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    modal.close();
    if (status === 400 && body?.error?.code === 'NO_APPLICATIONS_SELECTED') {
      alert.error('Please select at least one applicant.');
    } else if (status === 400 || status === 409) {
      alert.error(
        body?.error?.message ||
          'Some applicants could not be selected. The list has been refreshed — please try again.'
      );
      await loadApplicants(vacancyId, { silent: true });
    } else if (status === 403) {
      alert.error('You do not have permission to perform this action.');
    } else if (status === 404) {
      alert.error('This vacancy could not be found. It may have been removed.');
    } else {
      alert.error(body?.error?.message || 'Unable to select candidates. Please try again.');
    }
  } catch (err) {
    modal.close();
    alert.error('Something went wrong. Please check your connection and try again.');
  } finally {
    setSubmitting(false);
    updateSelectionCount();
  }
}

function cancelSelection() {
  if (submitting || chosen.size === 0) return;
  chosen.clear();
  poolList.querySelectorAll('[data-checkbox]').forEach((cb) => {
    cb.checked = false;
    cb.closest('.candidate-row').classList.remove('is-selected');
  });
  updateSelectionCount();
  alert.hide();
}

// --- data loading ----------------------------------------------------

async function loadApplicants(vacancyId, { silent = false } = {}) {
  if (!silent) alert.hide();

  if (!vacancyId) {
    eligibleApplications = [];
    chosen.clear();
    setView('prompt');
    return;
  }

  const thisLoad = ++loadToken;
  if (!silent) {
    chosen.clear();
    setView('loading');
  }

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
      alert.error(body?.error?.message || 'Unable to load applicants. Please try again later.');
      return;
    }

    const applications = (body && body.data && body.data.applications) || [];
    renderVacancy(body && body.data && body.data.vacancy, applications);
  } catch (err) {
    if (thisLoad !== loadToken) return;
    if (!silent) setView('prompt');
    alert.error('Unable to load applicants. Please check your connection and try again.');
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
        'Create and publish a vacancy first — its applicants will show up here.';
      return;
    }

    populateVacancies(vacancies);

    const preselect = readParam('vacancy');
    if (preselect && [...select.options].some((o) => o.value === preselect)) {
      select.value = preselect;
      await loadApplicants(preselect);
    }
  } catch (err) {
    alert.error('Unable to load your vacancies. Please check your connection and try again.');
  }
}

select.addEventListener('change', () => {
  const id = select.value;
  history.replaceState(
    null,
    '',
    id ? withHashParam('candidates.html', 'vacancy', id) : 'candidates.html'
  );
  loadApplicants(id);
});

selectBtn.addEventListener('click', openConfirm);
confirmBtn.addEventListener('click', submitSelection);
cancelBtn.addEventListener('click', cancelSelection);

document.addEventListener('DOMContentLoaded', init);
