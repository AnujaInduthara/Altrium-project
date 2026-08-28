// Vacancy Details page controller: mounts the app shell, enforces the HR-only
// route, shows one vacancy, and drives the DRAFT -> PUBLISHED publish action.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { readParam, withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'vacancies',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const page = document.getElementById('vacancy-page');
const loadingEl = document.getElementById('detail-loading');
const errorEl = document.getElementById('detail-error');
const detailEl = document.getElementById('vacancy-detail');
const alert = createAlert(document.getElementById('detail-alert'));
const modal = createModal(document.getElementById('publish-modal'));
const closeModal = createModal(document.getElementById('close-modal'));

const vacancyId = readParam('id');

let publishing = false;
let closing = false;
let currentStatus = 'draft';

const $ = (id) => document.getElementById(id);

// Reflects the on/off state on the Draft ↔ Published switch.
function setToggle(on) {
  const toggle = $('status-toggle');
  toggle.setAttribute('aria-checked', String(on));
  toggle.classList.toggle('is-on', on);
}

function text(id, value) {
  $(id).textContent = value == null ? '' : String(value);
}

function showError(title, message) {
  loadingEl.hidden = true;
  detailEl.hidden = true;
  if (title) text('detail-error-title', title);
  if (message) text('detail-error-message', message);
  errorEl.hidden = false;
}

function renderRequirements(list) {
  const ul = $('detail-requirements');
  ul.replaceChildren(
    ...(Array.isArray(list) ? list : []).map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    })
  );
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function render(vacancy) {
  text('detail-title', vacancy.job_title);
  text('detail-department', vacancy.department);
  text('detail-location', vacancy.location);
  text('detail-employment-type', vacancy.employment_type);
  text('detail-experience-level', vacancy.experience_level);
  text('detail-positions', vacancy.number_of_positions);
  text('detail-description', vacancy.job_description);
  renderRequirements(vacancy.job_requirements);

  currentStatus = String(vacancy.status || 'draft').toLowerCase();
  const isDraft = currentStatus === 'draft';
  const isPublished = currentStatus === 'published';
  const isClosed = currentStatus === 'closed';

  // Page heading reflects where the vacancy is in its lifecycle.
  text(
    'detail-page-title',
    isPublished ? 'Job Vacancy' : isClosed ? 'Closed Job Vacancy' : 'Publish Job Vacancy'
  );
  text(
    'detail-page-subtitle',
    isPublished
      ? 'This vacancy is live. Share the public application link or close it when hiring is done.'
      : isClosed
        ? 'This vacancy is closed. Recruitment data is preserved and remains accessible below.'
        : 'Review and publish the vacancy to generate a public application link.'
  );

  // The Draft ↔ Published switch is only meaningful before closing. Once closed,
  // it is replaced by a plain "Closed" status badge.
  $('status-toggle-row').hidden = isClosed;
  $('status-closed-badge').hidden = !isClosed;

  // The switch shows the live state and is only interactive on a draft. The
  // "Update to Published" button stays disabled until the user flips it on.
  setToggle(isPublished);
  $('status-toggle').disabled = !isDraft;
  $('publish-btn').hidden = !isDraft;
  $('publish-btn').disabled = true;

  // Close Vacancy is only offered for a published vacancy; never for a draft
  // (nothing to close) or an already-closed one. Button visibility is a UX aid
  // only — the backend independently rejects any invalid transition.
  $('close-btn').hidden = !isPublished;
  $('close-btn').disabled = closing;

  // Deep links to the recruitment data stay available while published AND after
  // closing, so historical applications / screening / candidates remain reachable.
  const hasRecruitmentData = isPublished || isClosed;
  $('published-links').hidden = !hasRecruitmentData;
  $('closed-note').hidden = !isClosed;
  $('copy-btn').disabled = !isPublished;
  // The copyable public link only makes sense while the vacancy is live; a
  // closed vacancy's link resolves to a "closed" notice, not the form.
  $('public-link-field').hidden = isClosed;

  if (hasRecruitmentData) {
    $('view-applications-link').href = withHashParam('applications.html', 'vacancy', vacancy.id);
    $('view-screening-link').href = withHashParam('ai-screening.html', 'vacancy', vacancy.id);
    $('select-candidates-link').href = withHashParam('candidates.html', 'vacancy', vacancy.id);
  }

  if (isPublished) {
    $('public-url').value = vacancy.public_url || '';
    text(
      'published-at-hint',
      vacancy.published_at ? `Published ${formatDateTime(vacancy.published_at)}` : ''
    );
    text('publish-panel-subtitle', 'This vacancy is live. Candidates can apply using the link below.');
  } else {
    $('public-url').value = '';
    text('published-at-hint', '');
    text(
      'publish-panel-subtitle',
      isClosed
        ? 'This vacancy is closed and can no longer be published.'
        : 'Make this vacancy live for candidates to apply.'
    );
  }

  text(
    'closed-at-hint',
    isClosed && vacancy.closed_at ? `Closed ${formatDateTime(vacancy.closed_at)}.` : ''
  );

  $('publish-modal-body').textContent = `Are you sure you want to publish “${vacancy.job_title}”?`;
  $('close-modal-body').textContent = `Are you sure you want to close “${vacancy.job_title}”?`;

  loadingEl.hidden = true;
  errorEl.hidden = true;
  detailEl.hidden = false;
}

// Flipping the switch on a draft arms (or disarms) the publish button.
function onToggleClick() {
  if (currentStatus !== 'draft' || publishing) return;
  const next = $('status-toggle').getAttribute('aria-checked') !== 'true';
  setToggle(next);
  $('publish-btn').disabled = !next;
}

function setPublishing(on) {
  publishing = on;
  const confirmBtn = $('confirm-publish-btn');
  confirmBtn.disabled = on;
  confirmBtn.setAttribute('aria-busy', String(on));
  confirmBtn.querySelector('[data-label]').textContent = on ? 'Publishing…' : 'Publish Vacancy';
  if (on) $('publish-btn').disabled = true;
}

// Publishing didn't happen — put the switch and button back to the draft state.
function resetPublishControls() {
  setToggle(false);
  $('publish-btn').disabled = true;
}

function messageForStatus(status, body) {
  const apiMessage = body?.error?.message;
  switch (status) {
    case 400:
      return apiMessage || 'Please complete all required vacancy information before publishing.';
    case 403:
      return apiMessage || 'You do not have permission to publish this vacancy.';
    case 404:
      return apiMessage || 'This vacancy could not be found.';
    case 409:
      return apiMessage || 'This vacancy can no longer be published.';
    default:
      return apiMessage || 'Unable to publish the vacancy. Please try again.';
  }
}

async function doPublish() {
  if (publishing) return;
  alert.hide();
  setPublishing(true);

  try {
    const { ok, status, body } = await VacancyService.publish(vacancyId);

    if (ok) {
      modal.close();
      render(body.data);
      // Re-checking here would need another round trip; the returned record is
      // authoritative. Move focus to the freshly shown link for keyboard users.
      $('public-url').focus();
      $('public-url').select();
      return;
    }

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    modal.close();
    alert.error(messageForStatus(status, body));
    resetPublishControls();

    // For "already published" / state conflicts, reload the true state.
    if (status === 409 || status === 404) {
      await loadVacancy();
    }
  } catch (err) {
    modal.close();
    alert.error('Unable to publish the vacancy. Please check your connection and try again.');
    resetPublishControls();
  } finally {
    setPublishing(false);
  }
}

// --- Close vacancy (PB-08) ---------------------------------------------------

function setClosing(on) {
  closing = on;
  const confirmBtn = $('confirm-close-btn');
  confirmBtn.disabled = on;
  confirmBtn.setAttribute('aria-busy', String(on));
  confirmBtn.querySelector('[data-label]').textContent = on ? 'Closing…' : 'Yes, Close Vacancy';
  // Prevent a second close attempt from the panel button while one is running.
  $('close-btn').disabled = on;
}

function messageForCloseStatus(status, body) {
  const apiMessage = body?.error?.message;
  switch (status) {
    case 403:
      return apiMessage || 'You do not have permission to close this vacancy.';
    case 404:
      return apiMessage || 'This vacancy could not be found.';
    case 409:
      return apiMessage || 'This vacancy can no longer be closed.';
    default:
      return apiMessage || 'Unable to close the vacancy. Please try again.';
  }
}

async function doClose() {
  if (closing) return;
  alert.hide();
  setClosing(true);

  try {
    const { ok, status, body } = await VacancyService.close(vacancyId);

    if (ok) {
      closeModal.close();
      render(body.data);
      alert.success('Job vacancy closed successfully.');
      return;
    }

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    closeModal.close();
    alert.error(messageForCloseStatus(status, body));

    // For state conflicts / not-found, reload the true state so the UI is honest
    // about whether the vacancy is already closed.
    if (status === 409 || status === 404) {
      await loadVacancy();
    }
  } catch (err) {
    closeModal.close();
    alert.error('Unable to close the vacancy. Please check your connection and try again.');
  } finally {
    setClosing(false);
  }
}

async function copyLink() {
  const url = $('public-url').value;
  if (!url) return;
  const btn = $('copy-btn');
  const label = btn.querySelector('[data-label]');
  const restore = () => { label.textContent = 'Copy'; };

  try {
    await navigator.clipboard.writeText(url);
    label.textContent = '✓ Copied';
    setTimeout(restore, 2000);
  } catch (err) {
    // Clipboard API unavailable (e.g. insecure context) — fall back to select.
    $('public-url').focus();
    $('public-url').select();
    label.textContent = 'Press Ctrl/Cmd + C';
    setTimeout(restore, 3000);
  }
}

async function loadVacancy() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });
  page.hidden = false;

  if (!vacancyId) {
    showError('This vacancy could not be found.', 'No vacancy was specified.');
    return;
  }

  try {
    const { ok, status, body } = await VacancyService.get(vacancyId);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (ok) {
      render(body.data);
      return;
    }
    if (status === 403) {
      showError('Vacancy not available', 'You do not have permission to view this vacancy.');
      return;
    }
    if (status === 404) {
      showError('This vacancy could not be found.', 'It may have been removed.');
      return;
    }
    showError('Something went wrong', body?.error?.message || 'Please try again later.');
  } catch (err) {
    showError('Unable to load the vacancy', 'Please check your connection and try again.');
  }
}

function wireOnce() {
  $('status-toggle').addEventListener('click', onToggleClick);
  $('publish-btn').addEventListener('click', () => modal.open());
  $('confirm-publish-btn').addEventListener('click', doPublish);
  $('close-btn').addEventListener('click', () => closeModal.open());
  $('confirm-close-btn').addEventListener('click', doClose);
  $('copy-btn').addEventListener('click', copyLink);
}

wireOnce();
document.addEventListener('DOMContentLoaded', loadVacancy);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    detailEl.hidden = true;
    errorEl.hidden = true;
    loadingEl.hidden = false;
    alert.hide();
    loadVacancy();
  }
});
