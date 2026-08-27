// Vacancy Details page controller: mounts the app shell, enforces the HR-only
// route, shows one vacancy, and drives the DRAFT -> PUBLISHED publish action.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { readParam, withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const STATUS_LABELS = { draft: 'Draft', published: 'Published', closed: 'Closed' };

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

const $ = (id) => document.getElementById(id);

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
  text('detail-subtitle', `${vacancy.department} · ${vacancy.location}`);
  text('detail-department', vacancy.department);
  text('detail-location', vacancy.location);
  text('detail-employment-type', vacancy.employment_type);
  text('detail-experience-level', vacancy.experience_level);
  text('detail-positions', vacancy.number_of_positions);
  text('detail-description', vacancy.job_description);
  renderRequirements(vacancy.job_requirements);

  const status = String(vacancy.status || 'draft').toLowerCase();
  const badge = $('detail-status');
  badge.textContent = STATUS_LABELS[status] || vacancy.status;
  badge.className = `badge badge--${status}`;

  const isDraft = status === 'draft';
  $('publish-btn').hidden = !isDraft;
  $('draft-note').hidden = !isDraft;
  $('published-panel').hidden = status !== 'published';
  $('closed-note').hidden = status !== 'closed';

  if (status === 'published') {
    $('public-url').value = vacancy.public_url || '';
    text(
      'published-at-hint',
      vacancy.published_at ? `Published ${formatDateTime(vacancy.published_at)}` : ''
    );
    $('view-applications-link').href = withHashParam('applications.html', 'vacancy', vacancy.id);
    $('view-screening-link').href = withHashParam('ai-screening.html', 'vacancy', vacancy.id);
  }

  $('publish-modal-body').textContent = `Are you sure you want to publish “${vacancy.job_title}”?`;

  loadingEl.hidden = true;
  errorEl.hidden = true;
  detailEl.hidden = false;
}

function setPublishing(on) {
  publishing = on;
  const confirmBtn = $('confirm-publish-btn');
  confirmBtn.disabled = on;
  confirmBtn.setAttribute('aria-busy', String(on));
  confirmBtn.querySelector('[data-label]').textContent = on ? 'Publishing…' : 'Publish Vacancy';
  $('publish-btn').disabled = on;
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

    // For "already published" / state conflicts, reload the true state.
    if (status === 409 || status === 404) {
      await loadVacancy();
    }
  } catch (err) {
    modal.close();
    alert.error('Unable to publish the vacancy. Please check your connection and try again.');
  } finally {
    setPublishing(false);
  }
}

async function copyLink() {
  const url = $('public-url').value;
  if (!url) return;
  const btn = $('copy-btn');
  const label = btn.querySelector('[data-label]');
  const restore = () => { label.textContent = 'Copy link'; };

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
