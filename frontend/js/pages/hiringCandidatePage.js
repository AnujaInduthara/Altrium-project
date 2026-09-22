// Hiring Candidate detail page (PB-20/PB-21) — a Hiring Manager reads the
// full picture for one candidate: the AI screening summary and every
// interview stage's ratings/comments from every interviewer, then records
// the final Hire/Reject decision.

import { AuthService } from '../services/authService.js';
import { HiringService } from '../services/hiringService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { readParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['hiring_manager', 'management'];

const DECISION_LABELS = { pending: 'Pending', hired: 'Hired', rejected: 'Rejected' };
const DECISION_BADGE_CLASSES = { pending: 'badge--warning', hired: 'badge--success', rejected: 'badge--danger' };

const STAGE_STATUS_LABELS = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  completed: 'Completed',
  skipped: 'Skipped',
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

const SCREENING_STATUS_LABELS = {
  not_started: 'Not started',
  pending: 'Queued',
  processing: 'Processing…',
  completed: 'Completed',
  failed: 'Unavailable',
};

const PENDING_NOTES = {
  not_started: 'This application has not been through AI screening yet.',
  pending: 'AI screening is queued for this application.',
  processing: 'AI screening is currently being processed for this application.',
  failed: 'AI screening could not be completed for this application.',
};

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'hiring-dashboard',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('candidate-page');
const loadingEl = $('candidate-loading');
const errorEl = $('candidate-error');
const contentEl = $('candidate-content');
const alert = createAlert($('candidate-alert'));
const stageTemplate = $('stage-card-template');
const evaluationTemplate = $('evaluation-card-template');

const decisionForm = $('decision-form');
const decisionDecidedEl = $('decision-decided');
const decisionErrorEl = $('decision-error');
const reasonInput = $('decision-reason');
const reasonRequiredEl = $('decision-reason-required');
const reasonErrorEl = $('decision-reason-error');
const reasonFieldRoot = document.querySelector('[data-field="reason"]');
const decisionFieldRoot = document.querySelector('[data-field="decision"]');
const acknowledgeWrap = $('decision-acknowledge-wrap');
const acknowledgeCheckbox = $('decision-acknowledge');
const outstandingListEl = $('decision-outstanding-list');
const decisionModal = createModal($('decision-modal'));

const applicationId = readParam('id');
let pendingDecisionInput = null;
let decidingSubmitting = false;
// 'management' can read everything on this page but never decides (Step
// 5.2's rule — the backend also enforces this with its own stricter
// requireRole on the decision route); set once auth resolves.
let canDecide = false;

function text(id, value) {
  $(id).textContent = value == null || value === '' ? '—' : String(value);
}

function renderChips(listEl, skills) {
  const items = Array.isArray(skills) ? skills.filter((s) => typeof s === 'string' && s.trim()) : [];
  listEl.replaceChildren(
    ...items.map((skill) => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.textContent = skill;
      return li;
    })
  );
}

function showError() {
  loadingEl.hidden = true;
  contentEl.hidden = true;
  errorEl.hidden = false;
}

function formatDateTime(stageInterview) {
  if (!stageInterview) return 'Not yet scheduled';
  const d = new Date(`${stageInterview.scheduled_date}T00:00:00`);
  const dateLabel = Number.isNaN(d.getTime())
    ? stageInterview.scheduled_date
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${dateLabel}, ${stageInterview.start_time} – ${stageInterview.end_time}`;
}

function buildEvaluationCard(evaluation) {
  const node = evaluationTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('[data-interviewer]').textContent = evaluation.interviewer_name || 'Interviewer';
  node.querySelector('[data-overall]').textContent = `${evaluation.overall_rating} / 5 overall`;
  node.querySelector('[data-technical]').textContent = `${evaluation.technical_rating} / 5`;
  node.querySelector('[data-problem-solving]').textContent = `${evaluation.problem_solving_rating} / 5`;
  node.querySelector('[data-communication]').textContent = `${evaluation.communication_rating} / 5`;
  node.querySelector('[data-role-knowledge]').textContent = `${evaluation.role_knowledge_rating} / 5`;
  node.querySelector('[data-comments]').textContent = evaluation.comments || 'No comments.';
  return node;
}

function buildStageCard(stage) {
  const node = stageTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('[data-stage-name]').textContent = stage.stage_name;
  node.querySelector('[data-stage-schedule]').textContent = formatDateTime(stage.interview);

  const statusEl = node.querySelector('[data-stage-status]');
  statusEl.textContent = STAGE_STATUS_LABELS[stage.status] || stage.status;
  statusEl.classList.add(stage.status === 'completed' ? 'badge--success' : 'badge--neutral');

  const evaluations = stage.evaluations || [];
  node.querySelector('[data-no-evaluations]').hidden = evaluations.length > 0;
  node.querySelector('[data-evaluation-list]').replaceChildren(...evaluations.map(buildEvaluationCard));

  return node;
}

function renderScreening(screening) {
  const status = String(screening?.status || 'not_started');
  const statusBadge = $('screening-status');
  statusBadge.textContent = SCREENING_STATUS_LABELS[status] || status;
  statusBadge.classList.toggle('badge--published', status === 'completed');
  statusBadge.classList.toggle('badge--closed', status === 'failed');

  const isCompleted = status === 'completed' && typeof screening?.score === 'number';
  $('screening-body').hidden = !isCompleted;
  $('screening-pending-note').hidden = isCompleted;

  if (!isCompleted) {
    $('screening-pending-note').textContent = PENDING_NOTES[status] || PENDING_NOTES.not_started;
    return;
  }

  text('screening-score', String(screening.score));
  const rec = RECOMMENDATION_LABELS[screening.recommendation] || screening.recommendation || '';
  text('screening-rec', rec ? `AI recommendation: ${rec}` : null);
  text('screening-exp', MATCH_LABELS[screening.experience_match] || screening.experience_match);
  text('screening-edu', MATCH_LABELS[screening.education_match] || screening.education_match);
  renderChips($('screening-matched'), screening.matched_skills);
  renderChips($('screening-missing'), screening.missing_skills);
  text('screening-summary-text', screening.summary || 'No summary was generated.');
}

// --- hiring decision (PB-21) ----------------------------------------------

function clearDecisionErrors() {
  decisionFieldRoot.classList.remove('is-invalid');
  decisionErrorEl.textContent = '';
  reasonFieldRoot.classList.remove('is-invalid');
  reasonErrorEl.textContent = '';
}

function resetDecisionForm() {
  decisionForm.reset();
  clearDecisionErrors();
  acknowledgeWrap.hidden = true;
  acknowledgeCheckbox.checked = false;
  reasonRequiredEl.hidden = true;
  outstandingListEl.replaceChildren();
}

function renderDecision(decision) {
  if (decision) {
    decisionForm.hidden = true;
    decisionDecidedEl.hidden = false;
    text('decision-decided-by', decision.decided_by_name);
    const decidedAt = new Date(decision.decided_at);
    text('decision-decided-at', Number.isNaN(decidedAt.getTime()) ? decision.decided_at : decidedAt.toLocaleString());
    text('decision-decided-reason', decision.reason || 'No reason given.');
    return;
  }

  decisionDecidedEl.hidden = true;
  $('decision-readonly-note').hidden = canDecide;
  decisionForm.hidden = !canDecide;
  if (canDecide) resetDecisionForm();
}

function showOutstandingStages(stages) {
  acknowledgeWrap.hidden = false;
  reasonRequiredEl.hidden = false;
  outstandingListEl.replaceChildren(
    ...(stages || []).map((s) => {
      const li = document.createElement('li');
      li.textContent = `${s.stage_name} (${s.status})`;
      return li;
    })
  );
}

decisionForm.querySelectorAll('input[name="decision"]').forEach((input) =>
  input.addEventListener('change', clearDecisionErrors)
);
reasonInput.addEventListener('input', () => {
  reasonFieldRoot.classList.remove('is-invalid');
  reasonErrorEl.textContent = '';
});

decisionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearDecisionErrors();

  const decisionInput = decisionForm.querySelector('input[name="decision"]:checked');
  if (!decisionInput) {
    decisionFieldRoot.classList.add('is-invalid');
    decisionErrorEl.textContent = 'Please choose Hire or Reject.';
    return;
  }

  const reason = reasonInput.value.trim();
  const needsAcknowledgement = !acknowledgeWrap.hidden;

  if (needsAcknowledgement && !acknowledgeCheckbox.checked) {
    alert.error('Please acknowledge the incomplete stages before deciding, or wait until every stage is complete.');
    return;
  }
  if (needsAcknowledgement && !reason) {
    reasonFieldRoot.classList.add('is-invalid');
    reasonErrorEl.textContent = 'A reason is required when deciding with incomplete stages.';
    return;
  }

  pendingDecisionInput = {
    decision: decisionInput.value,
    reason,
    acknowledge_incomplete: needsAcknowledgement && acknowledgeCheckbox.checked,
  };

  const verb = decisionInput.value === 'hired' ? 'hire' : 'reject';
  $('decision-modal-body').textContent =
    `This will ${verb} the candidate, notify HR and the candidate, and cannot be undone. Continue?`;
  decisionModal.open();
});

async function confirmDecision() {
  if (decidingSubmitting || !pendingDecisionInput) return;
  decidingSubmitting = true;

  const confirmBtn = $('confirm-decision-btn');
  const confirmLabel = confirmBtn.querySelector('[data-label]');
  confirmBtn.disabled = true;
  confirmLabel.textContent = 'Recording…';

  try {
    const { ok, status, body } = await HiringService.decide(applicationId, pendingDecisionInput);
    decisionModal.close();

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok && body?.data) {
      alert.success('The hiring decision has been recorded.');
      await load();
      return;
    }

    if (status === 409 && body?.error?.code === 'STAGES_INCOMPLETE') {
      showOutstandingStages(body.error.outstanding_stages);
      alert.error(body?.error?.message || 'One or more interview stages are not yet completed.');
      return;
    }

    if (status === 409 && body?.error?.code === 'DECISION_EXISTS') {
      alert.error(body?.error?.message || 'A hiring decision has already been recorded for this candidate.');
      await load();
      return;
    }

    alert.error(body?.error?.message || 'Unable to record the decision. Please try again.');
  } catch (err) {
    decisionModal.close();
    alert.error('Unable to record the decision. Please check your connection and try again.');
  } finally {
    decidingSubmitting = false;
    pendingDecisionInput = null;
    confirmBtn.disabled = false;
    confirmLabel.textContent = 'Confirm Decision';
  }
}

$('confirm-decision-btn').addEventListener('click', confirmDecision);

function render({ application, vacancy, screening, stages, decision }) {
  text('candidate-name', application.full_name || 'Candidate');
  const subtitleParts = [application.email, application.location].filter(Boolean);
  text('candidate-subtitle', subtitleParts.join(' · '));

  text('candidate-email', application.email);
  text('candidate-phone', application.phone);
  text('candidate-location', application.location);
  const emailLink = $('candidate-email-link');
  const phoneLink = $('candidate-phone-link');
  if (application.email) emailLink.href = `mailto:${application.email}`;
  if (application.phone) phoneLink.href = `tel:${String(application.phone).replace(/[^\d+]/g, '')}`;

  text('candidate-job-title', vacancy?.job_title);
  text('candidate-department', vacancy?.department);

  const stagesCompleted = (stages || []).filter((s) => s.status === 'completed').length;
  text('candidate-progress', `${stagesCompleted} of ${(stages || []).length} completed`);

  const completedOveralls = (stages || [])
    .filter((s) => s.status === 'completed')
    .flatMap((s) => s.evaluations.map((e) => e.overall_rating))
    .filter((n) => typeof n === 'number');
  text(
    'candidate-avg-rating',
    completedOveralls.length > 0
      ? `${(completedOveralls.reduce((sum, n) => sum + n, 0) / completedOveralls.length).toFixed(2)} / 5`
      : null
  );

  const decisionKey = decision?.status || 'pending';
  const decisionEl = $('candidate-decision');
  decisionEl.textContent = DECISION_LABELS[decisionKey] || decisionKey;
  decisionEl.classList.remove('badge--neutral', 'badge--warning', 'badge--success', 'badge--danger');
  decisionEl.classList.add(DECISION_BADGE_CLASSES[decisionKey] || 'badge--neutral');
  renderDecision(decision);

  renderScreening(screening);

  $('stage-cards').replaceChildren(...(stages || []).map(buildStageCard));

  loadingEl.hidden = true;
  errorEl.hidden = true;
  contentEl.hidden = false;
}

async function openCv(button, { download }) {
  const label = button.querySelector('[data-label]');
  const original = label.textContent;

  const cvWindow = download ? null : window.open('about:blank', '_blank');
  if (cvWindow) {
    try { cvWindow.opener = null; } catch (err) { /* cross-origin, ignore */ }
  }

  button.disabled = true;
  label.textContent = download ? 'Preparing…' : 'Opening…';

  try {
    const { ok, status, body } = await HiringService.getCvLink(applicationId, { download });

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

async function load() {
  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email, role: result.profile.role });
  canDecide = result.profile.role === 'hiring_manager';
  page.hidden = false;

  if (!applicationId) {
    showError();
    return;
  }

  try {
    const { ok, status, body } = await HiringService.getCandidate(applicationId);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok && body?.data) {
      render(body.data);
      return;
    }

    showError();
  } catch (err) {
    showError();
  }
}

$('view-cv-btn').addEventListener('click', (e) => openCv(e.currentTarget, { download: false }));
$('download-cv-btn').addEventListener('click', (e) => openCv(e.currentTarget, { download: true }));

document.addEventListener('DOMContentLoaded', load);
