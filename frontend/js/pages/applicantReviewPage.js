// Applicant Review page controller (PB-06). Mounts the app shell, enforces the
// HR-only route, and shows one applicant's details alongside the AI screening
// result that PB-05 already stored for them.
//
// This page is READ-ONLY. It never changes the application, its status, or the
// screening result — opening it does not re-run AI screening. Candidate
// selection (PB-07) is deliberately not here: the AI provides a recommendation
// only, and the final decision stays with HR.

import { AuthService } from '../services/authService.js';
import { ApplicationService } from '../services/applicationService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { readParam, withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const APPLICATION_STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  selected: 'Selected',
};

// PB-05 screening lifecycle — NOT a hiring outcome.
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
  STRONG: 'Strong match',
  MODERATE: 'Moderate match',
  WEAK: 'Limited match',
  NOT_APPLICABLE: 'Not applicable',
  NOT_DEMONSTRATED: 'Not demonstrated in the CV',
  INSUFFICIENT_INFORMATION: 'Insufficient information',
};

const SCREENING_ERROR_NOTES = {
  CV_EXTRACTION_ERROR:
    'The CV text could not be read automatically (it may be a scanned image). The CV is still available above for manual review.',
  AI_PROVIDER_ERROR: 'The AI screening service could not be reached. Screening can be re-run from the AI Screening list.',
  AI_TIMEOUT: 'AI screening timed out. It can be re-run from the AI Screening list.',
  INVALID_AI_RESPONSE: 'AI screening returned an unusable result. It can be re-run from the AI Screening list.',
  DEPENDENCY_MISSING: 'AI screening could not be completed for this application.',
  UNKNOWN_ERROR: 'AI screening could not be completed. The CV above remains available for manual review.',
};

const PENDING_NOTES = {
  not_started: 'This application has not been through AI screening yet.',
  pending: 'AI screening is queued for this application.',
  processing: 'AI screening is currently being processed for this application.',
};

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'ai-screening',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('review-page');
const loadingEl = $('review-loading');
const errorEl = $('review-error');
const detailEl = $('review-detail');
const alert = createAlert($('review-alert'));

const applicationId = readParam('id');
const vacancyParam = readParam('vacancy');

// --- helpers -------------------------------------------------------------

function text(id, value) {
  $(id).textContent = value == null || value === '' ? '—' : String(value);
}

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

function cvKind(contentType) {
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType) return 'DOCX';
  return '';
}

function showError(title, message) {
  loadingEl.hidden = true;
  detailEl.hidden = true;
  if (title) text('review-error-title', title);
  if (message) text('review-error-message', message);
  errorEl.hidden = false;
}

function renderChips(listEl, emptyEl, skills) {
  const items = Array.isArray(skills) ? skills.filter((s) => typeof s === 'string' && s.trim()) : [];
  listEl.replaceChildren(
    ...items.map((skill) => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.textContent = skill;
      return li;
    })
  );
  listEl.hidden = items.length === 0;
  emptyEl.hidden = items.length > 0;
}

// --- rendering ----------------------------------------------------------

function render({ application, vacancy, screening }) {
  const screeningTarget = vacancy?.id
    ? withHashParam('ai-screening.html', 'vacancy', vacancy.id)
    : 'ai-screening.html';

  $('back-link').href = screeningTarget;
  $('crumb-screening').href = screeningTarget;
  if (vacancy?.id) {
    const vacancyHref = withHashParam('vacancy.html', 'id', vacancy.id);
    $('crumb-vacancy').href = vacancyHref;
  }
  $('crumb-vacancy').textContent = vacancy?.job_title || 'Vacancy';
  $('crumb-applicant').textContent = application.full_name || 'Applicant';

  // --- applicant header
  text('review-name', application.full_name || 'Applicant');
  const subtitleParts = [application.email, application.location].filter(Boolean);
  text('review-subtitle', subtitleParts.join(' · '));

  const statusKey = String(application.status || 'submitted').toLowerCase();
  const statusEl = $('review-status');
  statusEl.textContent = APPLICATION_STATUS_LABELS[statusKey] || application.status || 'Submitted';
  statusEl.classList.toggle('badge--published', statusKey === 'submitted');

  // --- applicant information
  text('review-email', application.email);
  text('review-phone', application.phone);
  text('review-location', application.location);
  text('review-applied', formatDate(application.created_at));
  text('review-reference', application.reference);

  const emailLink = $('review-email-link');
  const phoneLink = $('review-phone-link');
  if (application.email) emailLink.href = `mailto:${application.email}`;
  if (application.phone) phoneLink.href = `tel:${String(application.phone).replace(/[^\d+]/g, '')}`;

  const cvMeta = [cvKind(application.cv_content_type), formatBytes(application.cv_size_bytes)]
    .filter(Boolean)
    .join(' · ');
  text('review-cv-meta', cvMeta || 'On file');

  // --- AI screening result (read-only)
  const status = String(screening?.status || 'not_started');
  const statusBadge = $('review-screening-status');
  statusBadge.textContent = SCREENING_STATUS_LABELS[status] || status;
  statusBadge.classList.toggle('badge--published', status === 'completed');
  statusBadge.classList.toggle('badge--closed', status === 'failed');

  const scoreBody = $('review-score-body');
  const pendingNote = $('review-screening-note');
  const matchCard = $('review-match-card');
  const skillsCard = $('review-skills-card');
  const summaryCard = $('review-summary-card');

  const isCompleted = status === 'completed' && typeof screening.score === 'number';

  scoreBody.hidden = !isCompleted;
  matchCard.hidden = !isCompleted;
  skillsCard.hidden = !isCompleted;
  summaryCard.hidden = !isCompleted;
  pendingNote.hidden = isCompleted;

  if (isCompleted) {
    const score = Math.max(0, Math.min(100, screening.score));
    text('review-score', String(screening.score));

    const rankEl = $('review-rank');
    if (screening.ai_screening_rank) {
      rankEl.hidden = false;
      rankEl.textContent = `Rank #${screening.ai_screening_rank}`;
    } else {
      rankEl.hidden = true;
    }

    const meter = $('review-score-meter');
    meter.style.width = `${score}%`;
    meter.dataset.band = score >= 70 ? 'high' : score >= 50 ? 'mid' : 'low';

    const rec = RECOMMENDATION_LABELS[screening.recommendation] || screening.recommendation || '';
    text('review-rec', rec ? `AI recommendation: ${rec}` : '');

    text('review-exp', MATCH_LABELS[screening.experience_match] || screening.experience_match);
    text('review-edu', MATCH_LABELS[screening.education_match] || screening.education_match);

    renderChips($('review-matched'), $('review-matched-empty'), screening.matched_skills);
    renderChips($('review-missing'), $('review-missing-empty'), screening.missing_skills);

    text('review-summary', screening.summary || 'No summary was generated.');
  } else if (status === 'failed') {
    pendingNote.textContent =
      SCREENING_ERROR_NOTES[screening.error_code] || SCREENING_ERROR_NOTES.UNKNOWN_ERROR;
  } else {
    pendingNote.textContent = PENDING_NOTES[status] || PENDING_NOTES.not_started;
  }

  loadingEl.hidden = true;
  errorEl.hidden = true;
  detailEl.hidden = false;
}

// --- CV access --------------------------------------------------------

async function openCv(button, { download }) {
  const label = button.querySelector('[data-label]');
  const original = label.textContent;

  // Open the tab synchronously (inside the click) so it is not blocked as a
  // pop-up, then point it at the signed URL once we have it.
  const cvWindow = download ? null : window.open('about:blank', '_blank');
  if (cvWindow) {
    try { cvWindow.opener = null; } catch (err) { /* cross-origin, ignore */ }
  }

  button.disabled = true;
  label.textContent = download ? 'Preparing…' : 'Opening…';

  try {
    const { ok, status, body } = await ApplicationService.getCvLink(applicationId, { download });

    if (status === 401) {
      if (cvWindow) cvWindow.close();
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok && body?.data?.url) {
      if (download) {
        window.location.assign(body.data.url);
      } else if (cvWindow) {
        cvWindow.location = body.data.url;
      } else {
        window.location.assign(body.data.url);
      }
      alert.hide();
    } else {
      if (cvWindow) cvWindow.close();
      alert.error(
        body?.error?.message ||
          'The applicant’s CV could not be loaded. Please try again.'
      );
    }
  } catch (err) {
    if (cvWindow) cvWindow.close();
    alert.error('The applicant’s CV could not be loaded. Please check your connection and try again.');
  } finally {
    button.disabled = false;
    label.textContent = original;
  }
}

// --- data loading ----------------------------------------------------

async function load() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });
  page.hidden = false;

  // Keep the "back to screening" targets useful even before the payload loads.
  if (vacancyParam) {
    const screeningTarget = withHashParam('ai-screening.html', 'vacancy', vacancyParam);
    $('back-link').href = screeningTarget;
    $('crumb-screening').href = screeningTarget;
    $('crumb-vacancy').href = withHashParam('vacancy.html', 'id', vacancyParam);
  }

  if (!applicationId) {
    showError('Applicant not specified', 'No applicant was provided to review.');
    return;
  }

  try {
    const { ok, status, body } = await ApplicationService.getReview(applicationId);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok && body?.data?.application) {
      render(body.data);
      return;
    }

    if (status === 404) {
      showError(
        'This applicant could not be found.',
        'It may have been removed, or you may not have access to this vacancy.'
      );
      return;
    }

    showError('Unable to load this applicant', body?.error?.message || 'Please try again later.');
  } catch (err) {
    showError('Unable to load this applicant', 'Please check your connection and try again.');
  }
}

$('view-cv-btn').addEventListener('click', (e) => openCv(e.currentTarget, { download: false }));
$('download-cv-btn').addEventListener('click', (e) => openCv(e.currentTarget, { download: true }));

document.addEventListener('DOMContentLoaded', load);
