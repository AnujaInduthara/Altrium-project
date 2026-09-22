// Interview Detail page (PB-18) — one interview the signed-in employee is
// assigned to conduct. Mirrors applicantReviewPage.js's detail-page
// structure, minus every AI section: the backend's interviewer projection
// already excludes screening, other candidates, other interviewers'
// evaluations and HR notes, so there is nothing AI-related to render here.

import { AuthService } from '../services/authService.js';
import { InterviewService } from '../services/interviewService.js';
import { ApplicationService } from '../services/applicationService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { readParam } from '../utils/urlParams.js';

// PB-19 — the four rating dimensions, in display order. Kept in sync by hand
// with backend/src/utils/evaluationValidation.js's RATING_FIELDS.
const RATING_FIELDS = [
  { name: 'technical_rating', label: 'Technical' },
  { name: 'problem_solving_rating', label: 'Problem Solving' },
  { name: 'communication_rating', label: 'Communication' },
  { name: 'role_knowledge_rating', label: 'Role Knowledge' },
];

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['employee', 'hr', 'hiring_manager'];

const STATUS_LABELS = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const STATUS_BADGE_CLASSES = {
  scheduled: 'badge--success',
  completed: 'badge--neutral',
  cancelled: 'badge--danger',
  no_show: 'badge--warning',
};

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'my-interviews',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('detail-page');
const loadingEl = $('detail-loading');
const errorEl = $('detail-error');
const contentEl = $('detail-content');
const alert = createAlert($('detail-alert'));

const evaluationForm = $('evaluation-form');
const evaluationNotStartedNote = $('evaluation-not-started-note');
const evaluationSummaryEl = $('evaluation-summary');
const commentsInput = $('evaluation-comments');
const commentsCountEl = $('evaluation-comments-count');
const commentsFieldRoot = document.querySelector('[data-field="comments"]');
const commentsErrorEl = $('comments-error');
const submitModal = createModal($('submit-evaluation-modal'));

const ratingFields = new Map(
  RATING_FIELDS.map(({ name }) => {
    const root = document.querySelector(`[data-field="${name}"]`);
    const inputs = Array.from(root.querySelectorAll('input[type="radio"]'));
    const errorEl = root.querySelector('.field__error');
    return [name, { root, inputs, errorEl }];
  })
);

const interviewId = readParam('id');
let applicationIdForCv = null;
let currentInterview = null;
let pendingEvaluationInput = null;
let submittingEvaluation = false;

function text(id, value) {
  $(id).textContent = value == null || value === '' ? '—' : String(value);
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function showError() {
  loadingEl.hidden = true;
  contentEl.hidden = true;
  errorEl.hidden = false;
}

function renderChips(listEl, requirements) {
  const items = Array.isArray(requirements) ? requirements.filter((r) => typeof r === 'string' && r.trim()) : [];
  listEl.replaceChildren(
    ...items.map((req) => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.textContent = req;
      return li;
    })
  );
}

// --- evaluation (PB-19) --------------------------------------------------

function clearFieldError(field) {
  field.root.classList.remove('is-invalid');
  if (field.errorEl) field.errorEl.textContent = '';
}

function setFieldError(field, message) {
  field.root.classList.add('is-invalid');
  if (field.errorEl) field.errorEl.textContent = message;
}

for (const field of ratingFields.values()) {
  field.inputs.forEach((input) => input.addEventListener('change', () => clearFieldError(field)));
}

commentsInput.addEventListener('input', () => {
  commentsCountEl.textContent = String(commentsInput.value.length);
  commentsFieldRoot.classList.remove('is-invalid');
  commentsErrorEl.textContent = '';
});

function hasInterviewStarted(interview) {
  const startsAt = new Date(`${interview.scheduled_date}T${interview.start_time}`);
  return !Number.isNaN(startsAt.getTime()) && Date.now() >= startsAt.getTime();
}

function renderEvaluationSummary(evaluation) {
  for (const { name } of RATING_FIELDS) {
    text(`summary-${name}`, `${evaluation[name]} / 5`);
  }
  text('summary-overall_rating', `${evaluation.overall_rating} / 5`);
  text('summary-comments', evaluation.comments || 'No comments.');
  const submittedAt = new Date(evaluation.submitted_at);
  text(
    'summary-submitted_at',
    Number.isNaN(submittedAt.getTime()) ? evaluation.submitted_at : submittedAt.toLocaleString()
  );
}

function renderEvaluationSection(interview, evaluation) {
  if (evaluation) {
    renderEvaluationSummary(evaluation);
    evaluationForm.hidden = true;
    evaluationNotStartedNote.hidden = true;
    evaluationSummaryEl.hidden = false;
    return;
  }

  evaluationSummaryEl.hidden = true;

  if (!hasInterviewStarted(interview)) {
    evaluationForm.hidden = true;
    evaluationNotStartedNote.hidden = false;
    return;
  }

  evaluationNotStartedNote.hidden = true;
  evaluationForm.hidden = false;
}

function collectEvaluationInput() {
  const value = { comments: commentsInput.value };
  for (const { name } of RATING_FIELDS) {
    const checked = ratingFields.get(name).inputs.find((i) => i.checked);
    value[name] = checked ? Number(checked.value) : null;
  }
  return value;
}

function validateBeforeConfirm(value) {
  let valid = true;
  for (const { name, label } of RATING_FIELDS) {
    const field = ratingFields.get(name);
    if (!value[name]) {
      setFieldError(field, `Please rate ${label.toLowerCase()}.`);
      valid = false;
    } else {
      clearFieldError(field);
    }
  }
  return valid;
}

async function loadEvaluation() {
  try {
    const { status, body } = await InterviewService.getEvaluation(interviewId);
    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    renderEvaluationSection(currentInterview, body?.data || null);
  } catch (err) {
    renderEvaluationSection(currentInterview, null);
  }
}

async function confirmSubmitEvaluation() {
  if (submittingEvaluation || !pendingEvaluationInput) return;
  submittingEvaluation = true;

  const confirmBtn = $('confirm-submit-evaluation-btn');
  const confirmLabel = confirmBtn.querySelector('[data-label]');
  confirmBtn.disabled = true;
  confirmLabel.textContent = 'Submitting…';

  try {
    const { ok, status, body } = await InterviewService.submitEvaluation(interviewId, pendingEvaluationInput);
    submitModal.close();

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok && body?.data) {
      alert.success('Your evaluation has been submitted.');
      const evaluation = body.data;
      const refreshed = await InterviewService.getOne(interviewId);
      if (refreshed.ok && refreshed.body?.data) {
        currentInterview = refreshed.body.data;
        render(currentInterview);
      }
      renderEvaluationSection(currentInterview, evaluation);
      return;
    }

    if (status === 400 && body?.error?.fields) {
      for (const [name, message] of Object.entries(body.error.fields)) {
        if (name === 'comments') {
          commentsFieldRoot.classList.add('is-invalid');
          commentsErrorEl.textContent = message;
        } else if (ratingFields.has(name)) {
          setFieldError(ratingFields.get(name), message);
        }
      }
      alert.error(body?.error?.message || 'Please check your ratings and try again.');
      return;
    }

    if (status === 409 && body?.error?.code === 'EVALUATION_EXISTS') {
      alert.error(body?.error?.message || 'You have already submitted an evaluation for this interview.');
      await loadEvaluation();
      return;
    }

    alert.error(body?.error?.message || 'Unable to submit your evaluation. Please try again.');
  } catch (err) {
    submitModal.close();
    alert.error('Unable to submit your evaluation. Please check your connection and try again.');
  } finally {
    submittingEvaluation = false;
    pendingEvaluationInput = null;
    confirmBtn.disabled = false;
    confirmLabel.textContent = 'Submit Evaluation';
  }
}

function render(interview) {
  const statusKey = String(interview.status || 'scheduled').toLowerCase();

  text('detail-candidate-name', interview.candidate_name || 'Candidate');
  text('detail-candidate-name-row', interview.candidate_name);
  text('detail-subtitle', [interview.job_title, interview.stage_name].filter(Boolean).join('  ·  '));

  const statusEl = $('detail-status');
  statusEl.textContent = STATUS_LABELS[statusKey] || interview.status || 'Scheduled';
  statusEl.classList.remove('badge--neutral', 'badge--warning', 'badge--success', 'badge--danger');
  statusEl.classList.add(STATUS_BADGE_CLASSES[statusKey] || 'badge--neutral');

  text('detail-date', formatDate(interview.scheduled_date));
  text('detail-time', interview.start_time && interview.end_time ? `${interview.start_time} – ${interview.end_time}` : null);
  text('detail-stage', interview.stage_name);

  text('detail-email', interview.candidate_email);
  text('detail-phone', interview.candidate_phone);
  const emailLink = $('detail-email-link');
  const phoneLink = $('detail-phone-link');
  if (interview.candidate_email) emailLink.href = `mailto:${interview.candidate_email}`;
  if (interview.candidate_phone) phoneLink.href = `tel:${String(interview.candidate_phone).replace(/[^\d+]/g, '')}`;

  text('detail-job-title', interview.job_title);
  text('detail-department', interview.department);

  const descriptionCard = $('detail-description-card');
  const hasDescription = Boolean(interview.job_description);
  const hasRequirements = Array.isArray(interview.job_requirements) && interview.job_requirements.length > 0;
  descriptionCard.hidden = !hasDescription && !hasRequirements;
  text('detail-description', interview.job_description);
  renderChips($('detail-requirements'), interview.job_requirements);

  loadingEl.hidden = true;
  errorEl.hidden = true;
  contentEl.hidden = false;
}

// Same short-lived signed-URL pattern as applicantReviewPage.js's openCv,
// against the same /api/applications/:id/cv endpoint — extended (PB-18) to
// also authorize an assigned, non-cancelled interviewer.
async function openCv(button, { download }) {
  if (!applicationIdForCv) return;

  const label = button.querySelector('[data-label]');
  const original = label.textContent;

  const cvWindow = download ? null : window.open('about:blank', '_blank');
  if (cvWindow) {
    try { cvWindow.opener = null; } catch (err) { /* cross-origin, ignore */ }
  }

  button.disabled = true;
  label.textContent = download ? 'Preparing…' : 'Opening…';

  try {
    const { ok, status, body } = await ApplicationService.getCvLink(applicationIdForCv, { download });

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
      alert.error(body?.error?.message || 'The candidate’s CV could not be loaded. Please try again.');
    }
  } catch (err) {
    if (cvWindow) cvWindow.close();
    alert.error('The candidate’s CV could not be loaded. Please check your connection and try again.');
  } finally {
    button.disabled = false;
    label.textContent = original;
  }
}

async function loadInterview() {
  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email, role: result.profile.role });
  page.hidden = false;

  if (!interviewId) {
    showError();
    return;
  }

  try {
    const { ok, status, body } = await InterviewService.getOne(interviewId);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok && body?.data) {
      applicationIdForCv = body.data.application_id || null;
      currentInterview = body.data;
      render(body.data);
      await loadEvaluation();
      return;
    }

    showError();
  } catch (err) {
    showError();
  }
}

$('view-cv-btn').addEventListener('click', (e) => openCv(e.currentTarget, { download: false }));
$('download-cv-btn').addEventListener('click', (e) => openCv(e.currentTarget, { download: true }));

evaluationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = collectEvaluationInput();
  if (!validateBeforeConfirm(value)) return;
  pendingEvaluationInput = value;
  submitModal.open();
});

$('confirm-submit-evaluation-btn').addEventListener('click', confirmSubmitEvaluation);

document.addEventListener('DOMContentLoaded', loadInterview);
