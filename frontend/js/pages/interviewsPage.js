// HR's Interviews page (PB-15/PB-16). Lists every upcoming interview across
// every vacancy the caller owns, grouped by date, with a cancel action. This
// is the page the sidebar's existing 'interviews' nav entry points to.

import { AuthService } from '../services/authService.js';
import { InterviewService } from '../services/interviewService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'interviews',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('interviews-page');
const loadingEl = $('interviews-loading');
const emptyEl = $('interviews-empty');
const errorEl = $('interviews-error');
const groupsEl = $('interview-groups');
const alert = createAlert($('interviews-alert'));
const cancelModal = createModal($('cancel-interview-modal'));

let pendingCancel = null;
let cancelling = false;

function formatDateHeading(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function buildInterviewRow(interview) {
  const li = document.createElement('li');
  li.className = 'interview-row';

  const main = document.createElement('div');
  main.className = 'interview-row__main';

  const time = document.createElement('span');
  time.className = 'interview-row__time';
  time.textContent = `${interview.start_time} – ${interview.end_time}`;

  const details = document.createElement('div');
  details.className = 'interview-row__details';

  const candidate = document.createElement('a');
  candidate.className = 'interview-row__candidate';
  candidate.textContent = interview.candidate_name || 'Applicant';
  candidate.href = withHashParam('applicant-review.html', 'id', interview.application_id);

  const meta = document.createElement('span');
  meta.className = 'interview-row__meta';
  const interviewerNames = (interview.interviewers || [])
    .map((i) => i.full_name || 'Interviewer')
    .join(', ');
  meta.textContent = [interview.vacancy_title, interview.stage_name, interviewerNames]
    .filter(Boolean)
    .join('  ·  ');

  details.append(candidate, meta);
  main.append(time, details);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'button button--ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => openCancelModal(interview));

  li.append(main, cancelBtn);
  return li;
}

function buildDateGroup(date, interviews) {
  const section = document.createElement('section');
  section.className = 'card interview-group';

  const heading = document.createElement('h3');
  heading.className = 'interview-group__date';
  heading.textContent = formatDateHeading(date);

  const list = document.createElement('ul');
  list.className = 'interview-group__list';
  list.append(...interviews.map(buildInterviewRow));

  section.append(heading, list);
  return section;
}

function groupByDate(interviews) {
  const map = new Map();
  for (const interview of interviews) {
    if (!map.has(interview.scheduled_date)) map.set(interview.scheduled_date, []);
    map.get(interview.scheduled_date).push(interview);
  }
  return map;
}

function renderInterviews(interviews) {
  loadingEl.hidden = true;
  errorEl.hidden = true;

  if (interviews.length === 0) {
    groupsEl.replaceChildren();
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  const grouped = groupByDate(interviews);
  groupsEl.replaceChildren(
    ...[...grouped.entries()].map(([date, dateInterviews]) => buildDateGroup(date, dateInterviews))
  );
}

function openCancelModal(interview) {
  pendingCancel = interview;
  $('cancel-interview-modal-body').textContent =
    `Cancel the interview with ${interview.candidate_name || 'this applicant'} on ` +
    `${formatDateHeading(interview.scheduled_date)} at ${interview.start_time}?`;
  cancelModal.open();
}

async function confirmCancel() {
  if (cancelling || !pendingCancel) return;
  cancelling = true;

  const confirmBtn = $('confirm-cancel-interview-btn');
  confirmBtn.disabled = true;
  confirmBtn.setAttribute('aria-busy', 'true');
  confirmBtn.querySelector('[data-label]').textContent = 'Cancelling…';

  try {
    const { ok, status, body } = await InterviewService.cancel(pendingCancel.id);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    cancelModal.close();

    if (ok) {
      alert.success('Interview cancelled.');
      await loadInterviews({ silent: true });
    } else if (status === 409) {
      alert.error(body?.error?.message || 'This interview has already been cancelled.');
      await loadInterviews({ silent: true });
    } else {
      alert.error(body?.error?.message || 'Unable to cancel this interview. Please try again.');
    }
  } catch (err) {
    cancelModal.close();
    alert.error('Unable to cancel this interview. Please check your connection and try again.');
  } finally {
    cancelling = false;
    pendingCancel = null;
    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-busy', 'false');
    confirmBtn.querySelector('[data-label]').textContent = 'Cancel Interview';
  }
}

async function loadInterviews({ silent = false } = {}) {
  if (!silent) {
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;
  }

  try {
    const { ok, status, body } = await InterviewService.list();

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok) {
      loadingEl.hidden = true;
      emptyEl.hidden = true;
      errorEl.hidden = false;
      $('interviews-error-message').textContent =
        body?.error?.message || 'Please check your connection and try again.';
      return;
    }

    renderInterviews(body?.data?.interviews || []);
  } catch (err) {
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    errorEl.hidden = false;
  }
}

async function init() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });
  page.hidden = false;
  await loadInterviews();
}

function wireOnce() {
  $('interviews-retry').addEventListener('click', () => loadInterviews());
  $('confirm-cancel-interview-btn').addEventListener('click', confirmCancel);
}

wireOnce();
document.addEventListener('DOMContentLoaded', init);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    page.hidden = true;
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;
    alert.hide();
    init();
  }
});
