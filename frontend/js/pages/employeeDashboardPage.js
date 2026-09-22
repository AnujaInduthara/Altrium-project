// Employee dashboard controller: the 'employee' role's landing page. Shows
// the interviews the signed-in employee is assigned to conduct (PB-18) —
// nothing about screening, other candidates, or other interviewers' notes,
// since /api/interviews/mine already returns the interviewer-safe projection.

import { AuthService } from '../services/authService.js';
import { InterviewService } from '../services/interviewService.js';
import { mountAppShell } from '../components/AppShell.js';
import { withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['employee'];

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'my-interviews',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const loadingEl = $('dashboard-interviews-loading');
const emptyEl = $('dashboard-interviews-empty');
const listEl = $('dashboard-interviews-list');
const EMPTY_MESSAGE = emptyEl.textContent;

function formatWhen(interview) {
  const d = new Date(`${interview.scheduled_date}T00:00:00`);
  const dateLabel = Number.isNaN(d.getTime())
    ? interview.scheduled_date
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${dateLabel} · ${interview.start_time}`;
}

function buildInterviewRow(interview) {
  const li = document.createElement('li');
  li.className = 'interview-row';

  const main = document.createElement('div');
  main.className = 'interview-row__main';

  const when = document.createElement('span');
  when.className = 'interview-row__time';
  when.textContent = formatWhen(interview);

  const details = document.createElement('div');
  details.className = 'interview-row__details';

  const candidate = document.createElement('span');
  candidate.className = 'interview-row__candidate';
  candidate.textContent = interview.candidate_name || 'Candidate';

  const meta = document.createElement('span');
  meta.className = 'interview-row__meta';
  meta.textContent = [interview.job_title, interview.stage_name].filter(Boolean).join('  ·  ');

  details.append(candidate, meta);
  main.append(when, details);

  const link = document.createElement('a');
  link.className = 'button button--ghost';
  link.textContent = 'View interview';
  link.href = withHashParam('interview-detail.html', 'id', interview.id);

  li.append(main, link);
  return li;
}

async function loadInterviews() {
  loadingEl.hidden = false;
  emptyEl.hidden = true;
  emptyEl.textContent = EMPTY_MESSAGE;
  listEl.hidden = true;

  try {
    const { ok, status, body } = await InterviewService.listMine({ scope: 'upcoming' });

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    loadingEl.hidden = true;

    if (!ok) {
      emptyEl.hidden = false;
      emptyEl.textContent = body?.error?.message || 'Unable to load your interviews right now.';
      return;
    }

    const interviews = body?.data?.interviews || [];
    if (interviews.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    listEl.replaceChildren(...interviews.map(buildInterviewRow));
    listEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = 'Unable to load your interviews. Please check your connection and try again.';
  }
}

async function renderDashboard() {
  const content = document.getElementById('dashboard-content');

  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected to login

  document.getElementById('user-email').textContent = result.profile.email;
  shell.setUser({ email: result.profile.email, role: result.profile.role });
  content.hidden = false;

  await loadInterviews();
}

document.addEventListener('DOMContentLoaded', renderDashboard);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    document.getElementById('dashboard-content').hidden = true;
    renderDashboard();
  }
});
