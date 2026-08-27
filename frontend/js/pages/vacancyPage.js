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

const vacancyId = readParam('id');

let publishing = false;
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

  // The switch shows the live state and is only interactive on a draft. The
  // "Update to Published" button stays disabled until the user flips it on.
  setToggle(isPublished);
  $('status-toggle').disabled = !isDraft;
  $('publish-btn').hidden = !isDraft;
  $('publish-btn').disabled = true;

  $('published-links').hidden = !isPublished;
  $('closed-note').hidden = !isClosed;
  $('copy-btn').disabled = !isPublished;

  if (isPublished) {
    $('public-url').value = vacancy.public_url || '';
    text(
      'published-at-hint',
      vacancy.published_at ? `Published ${formatDateTime(vacancy.published_at)}` : ''
    );
    $('view-applications-link').href = withHashParam('applications.html', 'vacancy', vacancy.id);
    $('view-screening-link').href = withHashParam('ai-screening.html', 'vacancy', vacancy.id);
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

  $('publish-modal-body').textContent = `Are you sure you want to publish “${vacancy.job_title}”?`;

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
