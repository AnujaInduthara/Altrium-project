// Hiring Dashboard (PB-20) — one screen where a Hiring Manager compares
// candidates across the AI screening score and every completed interview
// stage. Read-only: no decision is recorded here (that's Step 5.2).

import { AuthService } from '../services/authService.js';
import { HiringService } from '../services/hiringService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['hiring_manager', 'management'];

const DECISION_LABELS = { pending: 'Pending', hired: 'Hired', rejected: 'Rejected' };
const DECISION_BADGE_CLASSES = { pending: 'badge--warning', hired: 'badge--success', rejected: 'badge--danger' };

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'hiring-dashboard',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('hiring-page');
const alert = createAlert($('hiring-alert'));
const vacancyFilter = $('hiring-vacancy-filter');
const statusFilter = $('hiring-status-filter');
const loadingEl = $('hiring-loading');
const emptyEl = $('hiring-empty');
const errorEl = $('hiring-error');
const listEl = $('hiring-candidate-list');
const template = $('hiring-candidate-template');

let vacancyOptionsPopulated = false;

function setView(view) {
  loadingEl.hidden = view !== 'loading';
  emptyEl.hidden = view !== 'empty';
  errorEl.hidden = view !== 'error';
  listEl.hidden = view !== 'results';
}

function populateVacancyFilter(candidates) {
  if (vacancyOptionsPopulated) return;
  vacancyOptionsPopulated = true;

  const seen = new Set();
  const vacancies = [];
  for (const candidate of candidates) {
    if (!candidate.vacancy_id || seen.has(candidate.vacancy_id)) continue;
    seen.add(candidate.vacancy_id);
    vacancies.push({ id: candidate.vacancy_id, label: candidate.job_title || 'Vacancy' });
  }
  vacancies.sort((a, b) => a.label.localeCompare(b.label));

  for (const vacancy of vacancies) {
    const option = document.createElement('option');
    option.value = vacancy.id;
    option.textContent = vacancy.label;
    vacancyFilter.appendChild(option);
  }
}

function stageStripClass(stage) {
  if (stage.status !== 'completed') return 'hiring-stage-strip__item--pending';
  if (typeof stage.overall_rating !== 'number') return 'hiring-stage-strip__item--pending';
  if (stage.overall_rating >= 4) return 'hiring-stage-strip__item--good';
  if (stage.overall_rating >= 3) return 'hiring-stage-strip__item--ok';
  return 'hiring-stage-strip__item--low';
}

function buildStagePill(stage) {
  const li = document.createElement('li');
  li.className = `hiring-stage-strip__item ${stageStripClass(stage)}`;
  li.title = `${stage.stage_name}: ${
    typeof stage.overall_rating === 'number' ? `${stage.overall_rating} / 5` : 'no rating yet'
  }`;
  li.textContent = typeof stage.overall_rating === 'number' ? stage.overall_rating.toFixed(1) : '—';
  return li;
}

function buildCandidateCard(candidate) {
  const node = template.content.firstElementChild.cloneNode(true);

  node.querySelector('[data-link]').href = withHashParam('hiring-candidate.html', 'id', candidate.application_id);
  node.querySelector('[data-name]').textContent = candidate.candidate_name || 'Candidate';
  node.querySelector('[data-meta]').textContent = [candidate.job_title, candidate.department]
    .filter(Boolean)
    .join('  ·  ');

  const decisionEl = node.querySelector('[data-decision]');
  decisionEl.textContent = DECISION_LABELS[candidate.decision_status] || candidate.decision_status;
  decisionEl.classList.add(DECISION_BADGE_CLASSES[candidate.decision_status] || 'badge--neutral');

  const aiScoreEl = node.querySelector('[data-ai-score]');
  aiScoreEl.textContent = typeof candidate.ai_score === 'number' ? `${candidate.ai_score}%` : '—';

  const avgRatingEl = node.querySelector('[data-avg-rating]');
  avgRatingEl.textContent =
    typeof candidate.average_interview_rating === 'number' ? `${candidate.average_interview_rating} / 5` : '—';

  node.querySelector('[data-progress]').textContent = `${candidate.stages_completed} of ${candidate.stages_total} stages`;

  node.querySelector('[data-stage-strip]').replaceChildren(...(candidate.stages || []).map(buildStagePill));

  return node;
}

function renderCandidates(candidates) {
  if (candidates.length === 0) {
    setView('empty');
    return;
  }
  listEl.replaceChildren(...candidates.map(buildCandidateCard));
  setView('results');
}

async function loadCandidates({ silent = false } = {}) {
  if (!silent) setView('loading');
  alert.hide();

  try {
    const { ok, status, body } = await HiringService.list({
      vacancy_id: vacancyFilter.value || undefined,
      status: statusFilter.value || undefined,
    });

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok) {
      setView('error');
      $('hiring-error-message').textContent = body?.error?.message || 'Please check your connection and try again.';
      return;
    }

    const candidates = body?.data?.candidates || [];
    populateVacancyFilter(candidates);
    renderCandidates(candidates);
  } catch (err) {
    setView('error');
  }
}

async function init() {
  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email, role: result.profile.role });
  page.hidden = false;

  await loadCandidates();
}

vacancyFilter.addEventListener('change', () => loadCandidates());
statusFilter.addEventListener('change', () => loadCandidates());
$('hiring-retry').addEventListener('click', () => loadCandidates());

document.addEventListener('DOMContentLoaded', init);
