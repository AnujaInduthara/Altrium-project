// Hiring Candidate detail page (PB-20) — a Hiring Manager reads the full
// picture for one candidate: the AI screening summary and every interview
// stage's ratings/comments from every interviewer. Read-only — the decision
// panel is a placeholder here; Step 5.2 (PB-21) fills it in.

import { AuthService } from '../services/authService.js';
import { HiringService } from '../services/hiringService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
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

const applicationId = readParam('id');

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

  // `decision` is always null until Step 5.2 (PB-21) exists, which reads as pending here.
  const decisionKey = decision?.status || 'pending';
  const decisionEl = $('candidate-decision');
  decisionEl.textContent = DECISION_LABELS[decisionKey] || decisionKey;
  decisionEl.classList.remove('badge--neutral', 'badge--warning', 'badge--success', 'badge--danger');
  decisionEl.classList.add(DECISION_BADGE_CLASSES[decisionKey] || 'badge--neutral');

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
