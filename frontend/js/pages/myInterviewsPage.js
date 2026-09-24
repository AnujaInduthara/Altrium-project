// Candidate "My Interviews" page. Not built on AppShell — a candidate has
// exactly one page and no multi-section nav, so a lightweight header (logo +
// sign-out) is enough. Renders only the four-field allow-list
// GET /api/candidate/interviews returns: job_title, stage_name,
// scheduled_date, start_time/end_time, status — never a CV, an evaluation,
// an interviewer's identity, or another candidate.

import { AuthService } from '../services/authService.js';
import { CandidateService } from '../services/candidateService.js';

const LOGIN_PAGE = 'login.html';

// Mirrors interviewDetailPage.js's status vocabulary/labels for visual
// consistency with the staff-facing interview views.
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

const $ = (id) => document.getElementById(id);

const els = {
  loading: $('interviews-loading'),
  error: $('interviews-error'),
  empty: $('interviews-empty'),
  list: $('interviews-list'),
  retry: $('interviews-retry'),
  signOut: $('sign-out-btn'),
};

function showOnly(...visible) {
  const all = [els.loading, els.error, els.empty, els.list];
  for (const el of all) el.hidden = !visible.includes(el);
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTimeRange(startTime, endTime) {
  return [startTime, endTime].filter(Boolean).join(' – ');
}

function renderCard(interview) {
  const li = document.createElement('li');
  li.className = 'card interview-card';

  const header = document.createElement('div');
  header.className = 'interview-card__header';

  const title = document.createElement('h2');
  title.className = 'interview-card__title';
  title.textContent = interview.job_title || 'Interview';

  const statusKey = String(interview.status || 'scheduled').toLowerCase();
  const badge = document.createElement('span');
  badge.className = `badge ${STATUS_BADGE_CLASSES[statusKey] || 'badge--neutral'}`;
  badge.textContent = STATUS_LABELS[statusKey] || interview.status || 'Scheduled';

  header.append(title, badge);

  const meta = document.createElement('p');
  meta.className = 'interview-card__meta';
  meta.textContent = [
    interview.stage_name,
    formatDate(interview.scheduled_date),
    formatTimeRange(interview.start_time, interview.end_time),
  ]
    .filter(Boolean)
    .join(' · ');

  li.append(header, meta);
  return li;
}

function renderList(interviews) {
  els.list.replaceChildren(...interviews.map(renderCard));
  showOnly(els.list);
}

async function loadInterviews() {
  showOnly(els.loading);
  try {
    const { ok, status, body } = await CandidateService.listMyInterviews();

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok || !body?.data) {
      showOnly(els.error);
      return;
    }

    const interviews = body.data.interviews || [];
    if (interviews.length === 0) {
      showOnly(els.empty);
      return;
    }

    renderList(interviews);
  } catch (err) {
    showOnly(els.error);
  }
}

async function init() {
  const result = await AuthService.requireSession(LOGIN_PAGE, ['candidate']);
  if (!result) return; // already redirected

  els.signOut.addEventListener('click', async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  });
  els.retry.addEventListener('click', loadInterviews);

  await loadInterviews();
}

document.addEventListener('DOMContentLoaded', init);
