// Interview Setup page controller (PB-09..PB-12). Mounts the app shell,
// enforces the HR-only route, lets HR choose an interview level for a
// selected candidate, then add/remove/reorder/configure the stage list.
//
// This page only records REQUIREMENTS for each stage (department, minimum
// seniority, interviewer count, duration) — scheduling, interviewer
// assignment and availability are Phase 3, not here.

import { AuthService } from '../services/authService.js';
import { ApplicationService } from '../services/applicationService.js';
import { InterviewProcessService } from '../services/interviewProcessService.js';
import { InterviewService } from '../services/interviewService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';
import { readParam, withHashParam } from '../utils/urlParams.js';
import { APP_CONFIG } from '../config.js';
import { supabaseClient } from '../lib/supabaseClient.js';

const LOGIN_PAGE = 'login.html';

// Mirrors backend/src/config/vacancyOptions.js DEPARTMENTS and
// backend/src/config/seniority.js SENIORITY_LEVELS — do not invent new values.
const DEPARTMENTS = [
  'Engineering',
  'Product',
  'Design',
  'Finance',
  'Human Resources',
  'Marketing',
  'Sales',
  'Operations',
  'Customer Support',
  'Legal',
];

const SENIORITY_LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead'];
const SENIORITY_LABELS = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
};

const LEVEL_LABELS = {
  intern: 'Internship / Entry',
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

const LOCKED_STATUSES = ['scheduled', 'completed'];
const STAGE_LIST_MAX = 10;
const INTERVIEWER_SEARCH_DEFAULT_DAYS = 14;

// PB-14 (Step 3.2): GET /api/interview-stages/:stageId/available-interviewers.
// No dedicated service module for this one endpoint — inlined here, matching
// the same bearer-token pattern every service file uses.
async function fetchAvailableInterviewers(stageId, { from, to }) {
  const { data } = await supabaseClient.auth.getSession();
  const token = data.session?.access_token;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const response = await fetch(
    `${APP_CONFIG.API_BASE_URL}/interview-stages/${encodeURIComponent(stageId)}/available-interviewers?${params}`,
    { headers }
  );
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'interviews',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('setup-page');
const loadingEl = $('setup-loading');
const errorEl = $('setup-error');
const detailEl = $('setup-detail');
const alert = createAlert($('setup-alert'));
const scheduleModal = createModal($('schedule-modal'));
const cancelInterviewModal = createModal($('cancel-interview-modal'));

const levelCard = $('level-card');
const stagesCard = $('stages-card');
const saveBar = $('save-bar');
const stageListEl = $('stage-list');
const createBtn = $('create-process-btn');
const saveBtn = $('save-btn');
const discardBtn = $('discard-btn');
const saveBarStatus = $('save-bar-status');

const applicationId = readParam('id');

let candidateStatus = null;
let vacancyId = null;
let process = null;
let workingStages = [];
let dirty = false;
let saving = false;
let creating = false;
let scheduling = false;
let cancellingInterview = false;
let pendingSchedule = null;
let pendingCancelInterview = null;

// --- helpers --------------------------------------------------------------

function showError(title, message) {
  loadingEl.hidden = true;
  detailEl.hidden = true;
  if (title) $('setup-error-title').textContent = title;
  if (message) $('setup-error-message').textContent = message;
  errorEl.hidden = false;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toWorkingStage(s) {
  return {
    id: s.id,
    stage_id: s.stage_id,
    stage_name: s.stage_name,
    department: s.department,
    minimum_seniority: s.minimum_seniority,
    required_interviewers: s.required_interviewers,
    duration_minutes: s.duration_minutes,
    status: s.status,
  };
}

function markDirty() {
  dirty = true;
  updateSaveBar();
}

function updateSaveBar() {
  saveBarStatus.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  saveBarStatus.classList.toggle('save-bar__status--dirty', dirty);
  saveBtn.disabled = !dirty || saving;
  discardBtn.disabled = !dirty || saving;
}

function showLevelView() {
  levelCard.hidden = candidateStatus !== 'selected';
  stagesCard.hidden = true;
  saveBar.hidden = true;
}

function showStageView() {
  levelCard.hidden = true;
  stagesCard.hidden = false;
  saveBar.hidden = false;
  $('stages-level-subtitle').textContent = process
    ? `Level: ${LEVEL_LABELS[process.interview_level] || process.interview_level}`
    : '';
  updateSaveBar();
}

// --- stage row building (createElement/textContent only — no innerHTML) ---

function buildSelectField({ label, id, value, options }) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--plain field--select stage-row__field';

  const labelEl = document.createElement('label');
  labelEl.className = 'field__label';
  labelEl.textContent = label;
  labelEl.htmlFor = id;

  const control = document.createElement('div');
  control.className = 'field__control';

  const select = document.createElement('select');
  select.className = 'field__input';
  select.id = id;

  for (const [optValue, optLabel] of options) {
    const option = document.createElement('option');
    option.value = optValue;
    option.textContent = optLabel;
    if (optValue === (value || '')) option.selected = true;
    select.appendChild(option);
  }

  control.appendChild(select);
  wrap.append(labelEl, control);
  return { wrap, select };
}

function buildNumberField({ label, id, value, min, max }) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--plain stage-row__field';

  const labelEl = document.createElement('label');
  labelEl.className = 'field__label';
  labelEl.textContent = label;
  labelEl.htmlFor = id;

  const control = document.createElement('div');
  control.className = 'field__control';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'field__input';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.inputMode = 'numeric';
  input.value = String(value);

  control.appendChild(input);
  wrap.append(labelEl, control);
  return { wrap, input };
}

function buildStageRow(stage, index) {
  const locked = LOCKED_STATUSES.includes(stage.status);
  const aboveLocked = index > 0 && LOCKED_STATUSES.includes(workingStages[index - 1].status);
  const belowLocked =
    index < workingStages.length - 1 && LOCKED_STATUSES.includes(workingStages[index + 1].status);

  const li = document.createElement('li');
  li.className = 'stage-row';
  li.classList.toggle('stage-row--locked', locked);

  const header = document.createElement('div');
  header.className = 'stage-row__header';

  const indexEl = document.createElement('span');
  indexEl.className = 'stage-row__index';
  indexEl.textContent = String(index + 1);

  const nameWrap = document.createElement('div');
  nameWrap.className = 'field field--plain stage-row__name';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'field__label visually-hidden';
  nameLabel.textContent = `Stage ${index + 1} name`;
  nameLabel.htmlFor = `stage-name-${index}`;
  const nameControl = document.createElement('div');
  nameControl.className = 'field__control';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'field__input';
  nameInput.id = `stage-name-${index}`;
  nameInput.maxLength = 120;
  nameInput.placeholder = 'Stage name';
  nameInput.value = stage.stage_name || '';
  nameInput.addEventListener('input', () => {
    stage.stage_name = nameInput.value;
    markDirty();
  });
  nameControl.appendChild(nameInput);
  nameWrap.append(nameLabel, nameControl);

  const controls = document.createElement('div');
  controls.className = 'stage-row__controls';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'icon-button';
  upBtn.setAttribute('aria-label', `Move stage ${index + 1} up`);
  upBtn.textContent = '↑';
  upBtn.disabled = locked || index === 0 || aboveLocked;
  upBtn.addEventListener('click', () => moveStage(index, -1));

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'icon-button';
  downBtn.setAttribute('aria-label', `Move stage ${index + 1} down`);
  downBtn.textContent = '↓';
  downBtn.disabled = locked || index === workingStages.length - 1 || belowLocked;
  downBtn.addEventListener('click', () => moveStage(index, 1));

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-button';
  removeBtn.setAttribute('aria-label', `Remove stage ${index + 1}`);
  removeBtn.textContent = '✕';
  removeBtn.disabled = locked;
  removeBtn.addEventListener('click', () => removeStage(index));

  controls.append(upBtn, downBtn, removeBtn);
  header.append(indexEl, nameWrap, controls);
  li.appendChild(header);

  if (locked) {
    const note = document.createElement('p');
    note.className = 'stage-row__locked-note';

    if (stage.status === 'scheduled' && stage.interview) {
      const names = (stage.interview.interviewers || []).map((i) => i.full_name || 'Interviewer').join(', ');
      note.textContent =
        `Scheduled ${formatDateShort(stage.interview.scheduled_date)}, ` +
        `${stage.interview.start_time}–${stage.interview.end_time}` +
        (names ? ` with ${names}.` : '.');
      li.appendChild(note);

      const cancelInterviewBtn = document.createElement('button');
      cancelInterviewBtn.type = 'button';
      cancelInterviewBtn.className = 'button button--ghost';
      cancelInterviewBtn.textContent = 'Cancel interview';
      cancelInterviewBtn.addEventListener('click', () => openCancelInterviewModal(stage));
      li.appendChild(cancelInterviewBtn);
    } else {
      note.textContent =
        stage.status === 'completed'
          ? 'This stage has already been completed and cannot be removed or reordered.'
          : 'This stage has already been scheduled and cannot be removed or reordered.';
      li.appendChild(note);
    }
  }

  const fields = document.createElement('div');
  fields.className = 'stage-row__fields';

  const dept = buildSelectField({
    label: 'Department',
    id: `stage-department-${index}`,
    value: stage.department,
    options: [['', 'Any department'], ...DEPARTMENTS.map((d) => [d, d])],
  });
  dept.select.addEventListener('change', () => {
    stage.department = dept.select.value || null;
    markDirty();
  });

  const seniority = buildSelectField({
    label: 'Minimum seniority',
    id: `stage-seniority-${index}`,
    value: stage.minimum_seniority,
    options: [['', 'Any level'], ...SENIORITY_LEVELS.map((s) => [s, SENIORITY_LABELS[s]])],
  });
  seniority.select.addEventListener('change', () => {
    stage.minimum_seniority = seniority.select.value || null;
    markDirty();
  });

  const interviewers = buildNumberField({
    label: 'Interviewers',
    id: `stage-interviewers-${index}`,
    value: stage.required_interviewers,
    min: 1,
    max: 5,
  });
  interviewers.input.addEventListener('input', () => {
    const n = Number(interviewers.input.value);
    stage.required_interviewers = Number.isInteger(n) ? n : stage.required_interviewers;
    markDirty();
  });

  const duration = buildNumberField({
    label: 'Duration (minutes)',
    id: `stage-duration-${index}`,
    value: stage.duration_minutes,
    min: 15,
    max: 480,
  });
  duration.input.addEventListener('input', () => {
    const n = Number(duration.input.value);
    stage.duration_minutes = Number.isInteger(n) ? n : stage.duration_minutes;
    markDirty();
  });

  fields.append(dept.wrap, seniority.wrap, interviewers.wrap, duration.wrap);
  li.appendChild(fields);

  // "Find interviewers" only makes sense once the stage has been saved — an
  // unsaved (client-only) stage has no server id for the endpoint to look up.
  if (stage.id) {
    li.appendChild(buildInterviewersSection(stage, index));
  } else {
    const hint = document.createElement('p');
    hint.className = 'text-muted text-sm';
    hint.textContent = 'Save this stage to find matching interviewers.';
    li.appendChild(hint);
  }

  return li;
}

// --- PB-14: "Find interviewers" panel (Step 3.2, read-only) --------------

function buildDateInputField({ label, id, value }) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--plain interviewers-panel__field';

  const labelEl = document.createElement('label');
  labelEl.className = 'field__label';
  labelEl.textContent = label;
  labelEl.htmlFor = id;

  const control = document.createElement('div');
  control.className = 'field__control';

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'field__input';
  input.id = id;
  input.value = value;

  control.appendChild(input);
  wrap.append(labelEl, control);
  return { wrap, input };
}

function interviewerMeta(interviewer) {
  return [
    interviewer.job_position,
    interviewer.department,
    interviewer.seniority_level ? SENIORITY_LABELS[interviewer.seniority_level] || interviewer.seniority_level : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function formatDateShort(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function groupSlotsByDate(slots) {
  const map = new Map();
  for (const slot of slots) {
    if (!map.has(slot.slot_date)) map.set(slot.slot_date, []);
    map.get(slot.slot_date).push(slot);
  }
  return map;
}

function buildInterviewerCard(interviewer, stage) {
  const li = document.createElement('li');
  li.className = 'interviewer-card';

  const header = document.createElement('div');
  header.className = 'interviewer-card__header';

  const name = document.createElement('span');
  name.className = 'interviewer-card__name';
  name.textContent = interviewer.full_name || 'Employee';

  const meta = document.createElement('span');
  meta.className = 'interviewer-card__meta';
  meta.textContent = interviewerMeta(interviewer);

  header.append(name, meta);
  li.appendChild(header);

  const slots = interviewer.free_slots || [];
  if (slots.length === 0) {
    const note = document.createElement('p');
    note.className = 'text-muted text-sm';
    note.textContent = 'No free time in this range.';
    li.appendChild(note);
  } else {
    const list = document.createElement('ul');
    list.className = 'interviewer-card__slots';
    for (const [date, dateSlots] of groupSlotsByDate(slots)) {
      const item = document.createElement('li');
      const dateLabel = document.createElement('strong');
      dateLabel.textContent = formatDateShort(date);
      item.append(dateLabel, document.createTextNode(': '));

      dateSlots.forEach((slot, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'button button--ghost interviewer-card__slot-btn';
        btn.textContent = `${slot.start_time}–${slot.end_time}`;
        btn.title = `Schedule this stage with ${interviewer.full_name || 'this interviewer'} starting at ${slot.start_time}`;
        btn.addEventListener('click', () =>
          openScheduleModal({ stage, interviewer, slot: { ...slot, slot_date: date } })
        );
        item.appendChild(btn);
        if (i < dateSlots.length - 1) item.appendChild(document.createTextNode(' '));
      });

      list.appendChild(item);
    }
    li.appendChild(list);
  }

  return li;
}

function emptyMessage(text) {
  const p = document.createElement('p');
  p.className = 'text-muted interviewers-panel__empty';
  p.textContent = text;
  return p;
}

function renderInterviewerResults(container, data, stage) {
  const interviewers = (data && data.interviewers) || [];

  if (interviewers.length === 0) {
    container.replaceChildren(emptyMessage('No employees match these requirements.'));
    return;
  }

  const nodes = [];
  const anyFree = interviewers.some((i) => (i.free_slots || []).length > 0);
  if (!anyFree) {
    nodes.push(
      emptyMessage('Matching employees have no free time in this range — ask them to add availability.')
    );
  }

  const list = document.createElement('ul');
  list.className = 'interviewer-list';
  list.append(...interviewers.map((interviewer) => buildInterviewerCard(interviewer, stage)));
  nodes.push(list);

  container.replaceChildren(...nodes);
}

function buildInterviewersSection(stage, index) {
  const wrap = document.createElement('div');
  wrap.className = 'stage-row__interviewers';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'button button--ghost';
  toggleBtn.textContent = 'Find interviewers';

  const panel = document.createElement('div');
  panel.className = 'interviewers-panel';
  panel.hidden = true;

  const rangeRow = document.createElement('div');
  rangeRow.className = 'interviewers-panel__range';

  const from = todayIso();
  const to = addDaysIso(from, INTERVIEWER_SEARCH_DEFAULT_DAYS);
  const fromField = buildDateInputField({ label: 'From', id: `interviewers-from-${index}`, value: from });
  const toField = buildDateInputField({ label: 'To', id: `interviewers-to-${index}`, value: to });

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'button button--primary';
  searchBtn.textContent = 'Search';

  rangeRow.append(fromField.wrap, toField.wrap, searchBtn);

  const resultsEl = document.createElement('div');
  resultsEl.className = 'interviewers-panel__results';

  panel.append(rangeRow, resultsEl);

  let searching = false;
  async function search() {
    if (searching) return;
    searching = true;
    searchBtn.disabled = true;
    resultsEl.replaceChildren(emptyMessage('Searching…'));

    try {
      const { ok, status, body } = await fetchAvailableInterviewers(stage.id, {
        from: fromField.input.value || from,
        to: toField.input.value || to,
      });

      if (status === 401) {
        await AuthService.signOut();
        window.location.replace(LOGIN_PAGE);
        return;
      }

      if (!ok) {
        resultsEl.replaceChildren(
          emptyMessage(body?.error?.message || 'Unable to load interviewers. Please try again.')
        );
        return;
      }

      renderInterviewerResults(resultsEl, body.data, stage);
    } catch (err) {
      resultsEl.replaceChildren(
        emptyMessage('Unable to load interviewers. Please check your connection and try again.')
      );
    } finally {
      searching = false;
      searchBtn.disabled = false;
    }
  }

  let loaded = false;
  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggleBtn.textContent = panel.hidden ? 'Find interviewers' : 'Hide interviewers';
    if (!panel.hidden && !loaded) {
      loaded = true;
      search();
    }
  });
  searchBtn.addEventListener('click', search);

  wrap.append(toggleBtn, panel);
  return wrap;
}

// --- PB-15/16: scheduling / cancelling an interview -----------------------

function openScheduleModal({ stage, interviewer, slot }) {
  pendingSchedule = { stage, interviewer, slot };
  $('schedule-modal-body').textContent =
    `Schedule "${stage.stage_name}" with ${interviewer.full_name || 'this interviewer'} on ` +
    `${formatDateShort(slot.slot_date)} starting at ${slot.start_time} (${stage.duration_minutes} min)?`;
  scheduleModal.open();
}

function setScheduleButtonBusy(busy) {
  scheduling = busy;
  const btn = $('confirm-schedule-btn');
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
  btn.querySelector('[data-label]').textContent = busy ? 'Scheduling…' : 'Schedule Interview';
}

async function confirmSchedule() {
  if (scheduling || !pendingSchedule) return;
  const { stage, interviewer, slot } = pendingSchedule;
  setScheduleButtonBusy(true);

  try {
    const { ok, status, body } = await InterviewService.schedule(stage.id, {
      scheduled_date: slot.slot_date,
      start_time: slot.start_time,
      interviewer_ids: [interviewer.profile_id],
    });

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    scheduleModal.close();

    if (ok) {
      stage.status = 'scheduled';
      stage.interview = {
        id: body.data.id,
        scheduled_date: body.data.scheduled_date,
        start_time: body.data.start_time,
        end_time: body.data.end_time,
        interviewers: [{ profile_id: interviewer.profile_id, full_name: interviewer.full_name }],
      };
      renderStageList();
      alert.success('Interview scheduled.');
      return;
    }

    if (status === 409 && body?.error?.code === 'INTERVIEWER_UNAVAILABLE') {
      alert.error(
        body.error.message || 'This interviewer is no longer available for that time. Please search again.'
      );
    } else if (status === 409 && body?.error?.code === 'STAGE_ALREADY_SCHEDULED') {
      alert.error('This stage already has an interview scheduled. Reloading…');
      await reloadProcess();
    } else if (status === 400 && body?.error?.fields) {
      alert.error(body.error.message || 'Please check the scheduling details and try again.');
    } else {
      alert.error(body?.error?.message || 'Unable to schedule the interview. Please try again.');
    }
  } catch (err) {
    scheduleModal.close();
    alert.error('Unable to schedule the interview. Please check your connection and try again.');
  } finally {
    setScheduleButtonBusy(false);
    pendingSchedule = null;
  }
}

function openCancelInterviewModal(stage) {
  pendingCancelInterview = stage;
  $('cancel-interview-modal-body').textContent =
    `Cancel the interview for "${stage.stage_name}" on ` +
    `${formatDateShort(stage.interview.scheduled_date)} at ${stage.interview.start_time}?`;
  cancelInterviewModal.open();
}

function setCancelInterviewButtonBusy(busy) {
  cancellingInterview = busy;
  const btn = $('confirm-cancel-interview-btn');
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
  btn.querySelector('[data-label]').textContent = busy ? 'Cancelling…' : 'Cancel Interview';
}

async function confirmCancelInterview() {
  if (cancellingInterview || !pendingCancelInterview) return;
  const stage = pendingCancelInterview;
  setCancelInterviewButtonBusy(true);

  try {
    const { ok, status, body } = await InterviewService.cancel(stage.interview.id);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    cancelInterviewModal.close();

    if (ok) {
      stage.status = 'pending';
      stage.interview = null;
      renderStageList();
      alert.success('Interview cancelled.');
    } else if (status === 409) {
      alert.error(body?.error?.message || 'This interview has already been cancelled.');
      await reloadProcess();
    } else {
      alert.error(body?.error?.message || 'Unable to cancel this interview. Please try again.');
    }
  } catch (err) {
    cancelInterviewModal.close();
    alert.error('Unable to cancel this interview. Please check your connection and try again.');
  } finally {
    setCancelInterviewButtonBusy(false);
    pendingCancelInterview = null;
  }
}

// Attaches each scheduled stage's booked-interview details (for display +
// the cancel action) by matching interviews.candidate_stage_id back to the
// stage's own id. Best-effort: a failure here just means locked stages show
// their generic note instead of interview details — never fatal.
async function attachInterviewsToStages(stages) {
  if (!vacancyId) return;
  try {
    const { ok, body } = await InterviewService.list({ vacancy_id: vacancyId });
    if (!ok) return;
    const byStageId = new Map((body?.data?.interviews || []).map((iv) => [iv.candidate_stage_id, iv]));
    for (const stage of stages) {
      stage.interview = stage.id ? byStageId.get(stage.id) || null : null;
    }
  } catch (err) {
    // Non-fatal — see comment above.
  }
}

function renderStageList() {
  stageListEl.replaceChildren(...workingStages.map((stage, index) => buildStageRow(stage, index)));
  $('add-stage-btn').disabled = workingStages.length >= STAGE_LIST_MAX;
}

// --- structural edits -------------------------------------------------

function addStage() {
  if (workingStages.length >= STAGE_LIST_MAX) {
    alert.error(`You can have at most ${STAGE_LIST_MAX} stages.`);
    return;
  }
  workingStages.push({
    id: null,
    stage_id: null,
    stage_name: '',
    department: null,
    minimum_seniority: null,
    required_interviewers: 1,
    duration_minutes: 60,
    status: 'pending',
  });
  markDirty();
  renderStageList();
  const last = stageListEl.lastElementChild;
  const input = last && last.querySelector('input[type="text"]');
  if (input) input.focus();
}

function removeStage(index) {
  if (LOCKED_STATUSES.includes(workingStages[index].status)) return;
  workingStages.splice(index, 1);
  markDirty();
  renderStageList();
}

function moveStage(index, delta) {
  const stage = workingStages[index];
  if (LOCKED_STATUSES.includes(stage.status)) return;
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= workingStages.length) return;
  if (LOCKED_STATUSES.includes(workingStages[targetIndex].status)) return;
  [workingStages[index], workingStages[targetIndex]] = [workingStages[targetIndex], workingStages[index]];
  markDirty();
  renderStageList();
}

// --- server calls -------------------------------------------------------

async function reloadProcess() {
  try {
    const { ok, status, body } = await InterviewProcessService.get(applicationId);
    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }
    if (ok && body?.data?.process) {
      process = body.data.process;
      workingStages = (body.data.stages || []).map(toWorkingStage);
      dirty = false;
      await attachInterviewsToStages(workingStages);
      showStageView();
      renderStageList();
    } else {
      process = null;
      workingStages = [];
      dirty = false;
      showLevelView();
    }
  } catch (err) {
    alert.error('Unable to refresh the interview process. Please reload the page.');
  }
}

function setCreateButtonBusy(busy) {
  creating = busy;
  createBtn.disabled = busy || !document.querySelector('input[name="interview_level"]:checked');
  createBtn.setAttribute('aria-busy', String(busy));
  createBtn.querySelector('[data-label]').textContent = busy ? 'Creating…' : 'Create Interview Process';
}

async function handleCreateProcess() {
  if (creating) return;
  const selected = document.querySelector('input[name="interview_level"]:checked');
  if (!selected) return;

  setCreateButtonBusy(true);
  alert.hide();

  try {
    const { ok, status, body } = await InterviewProcessService.create(applicationId, {
      interview_level: selected.value,
    });

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok) {
      process = body.data.process;
      workingStages = (body.data.stages || []).map(toWorkingStage);
      dirty = false;
      showStageView();
      renderStageList();
      alert.success(`Interview process created at the ${LEVEL_LABELS[process.interview_level] || process.interview_level} level.`);
      return;
    }

    if (status === 409 && body?.error?.code === 'PROCESS_EXISTS') {
      alert.error('An interview process already exists for this candidate. Reloading…');
      await reloadProcess();
    } else if (status === 409 && body?.error?.code === 'CANDIDATE_NOT_SELECTED') {
      alert.error(body.error.message || 'This candidate must be selected before an interview process can be created.');
    } else {
      alert.error(body?.error?.message || 'Unable to create the interview process. Please try again.');
    }
  } catch (err) {
    alert.error('Unable to create the interview process. Please check your connection and try again.');
  } finally {
    setCreateButtonBusy(false);
  }
}

function setSaveButtonBusy(busy) {
  saving = busy;
  saveBtn.setAttribute('aria-busy', String(busy));
  saveBtn.querySelector('[data-label]').textContent = busy ? 'Saving…' : 'Save Changes';
  updateSaveBar();
}

async function handleSave() {
  if (saving || !dirty) return;

  const blankIndex = workingStages.findIndex((s) => !s.stage_name.trim());
  if (blankIndex !== -1) {
    alert.error(`Stage ${blankIndex + 1} needs a name before you can save.`);
    return;
  }
  if (workingStages.length === 0) {
    alert.error('Add at least one interview stage before saving.');
    return;
  }

  setSaveButtonBusy(true);
  alert.hide();

  const payload = workingStages.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    ...(s.stage_id ? { stage_id: s.stage_id } : {}),
    stage_name: s.stage_name.trim(),
    ...(s.department ? { department: s.department } : {}),
    ...(s.minimum_seniority ? { minimum_seniority: s.minimum_seniority } : {}),
    required_interviewers: s.required_interviewers,
    duration_minutes: s.duration_minutes,
  }));

  try {
    const { ok, status, body } = await InterviewProcessService.replaceStages(applicationId, {
      stages: payload,
    });

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok) {
      workingStages = (body.data.stages || []).map(toWorkingStage);
      dirty = false;
      await attachInterviewsToStages(workingStages);
      renderStageList();
      alert.success('Interview stages saved.');
      return;
    }

    if (status === 409 && body?.error?.code === 'STAGE_LOCKED') {
      alert.error(
        body.error.message ||
          'A stage has already been scheduled and could not be changed. The list has been refreshed.'
      );
      await reloadProcess();
    } else if (status === 404) {
      alert.error(body?.error?.message || 'This interview process could not be found.');
      await reloadProcess();
    } else {
      alert.error(body?.error?.message || 'Unable to save changes. Please try again.');
    }
  } catch (err) {
    alert.error('Unable to save changes. Please check your connection and try again.');
  } finally {
    setSaveButtonBusy(false);
  }
}

function handleDiscard() {
  if (!dirty || saving) return;
  alert.hide();
  reloadProcess();
}

// --- initial load ----------------------------------------------------

function renderHeader(application, vacancy) {
  $('setup-title').textContent = `Interview Setup — ${application.full_name || 'Applicant'}`;
  $('setup-subtitle').textContent = vacancy?.job_title ? `For ${vacancy.job_title}` : '';

  const backHref = vacancy?.id
    ? `applicant-review.html#id=${encodeURIComponent(applicationId)}&vacancy=${encodeURIComponent(vacancy.id)}`
    : withHashParam('applicant-review.html', 'id', applicationId);
  $('back-link').href = backHref;
}

async function load() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });
  page.hidden = false;

  if (!applicationId) {
    showError('Candidate not specified', 'No candidate was provided.');
    return;
  }

  try {
    const [reviewRes, processRes] = await Promise.all([
      ApplicationService.getReview(applicationId),
      InterviewProcessService.get(applicationId),
    ]);

    if (reviewRes.status === 401 || processRes.status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!reviewRes.ok) {
      if (reviewRes.status === 404) {
        showError(
          'This candidate could not be found.',
          'It may have been removed, or you may not have access to this vacancy.'
        );
      } else {
        showError('Something went wrong', reviewRes.body?.error?.message || 'Please try again later.');
      }
      return;
    }

    const { application, vacancy } = reviewRes.body.data;
    renderHeader(application, vacancy);

    candidateStatus = String(application.status || '').toLowerCase();
    vacancyId = vacancy?.id || null;
    $('not-selected-note').hidden = candidateStatus === 'selected';

    if (!processRes.ok) {
      showError('Unable to load the interview process', processRes.body?.error?.message || 'Please try again later.');
      return;
    }

    if (processRes.body?.data?.process) {
      process = processRes.body.data.process;
      workingStages = (processRes.body.data.stages || []).map(toWorkingStage);
      await attachInterviewsToStages(workingStages);
      showStageView();
      renderStageList();
    } else {
      process = null;
      showLevelView();
    }

    loadingEl.hidden = true;
    errorEl.hidden = true;
    detailEl.hidden = false;
  } catch (err) {
    showError('Unable to load this candidate', 'Please check your connection and try again.');
  }
}

function wireOnce() {
  document.querySelectorAll('input[name="interview_level"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      createBtn.disabled = false;
    });
  });
  createBtn.addEventListener('click', handleCreateProcess);
  $('add-stage-btn').addEventListener('click', addStage);
  saveBtn.addEventListener('click', handleSave);
  discardBtn.addEventListener('click', handleDiscard);
  $('confirm-schedule-btn').addEventListener('click', confirmSchedule);
  $('confirm-cancel-interview-btn').addEventListener('click', confirmCancelInterview);
}

wireOnce();
document.addEventListener('DOMContentLoaded', load);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    detailEl.hidden = true;
    errorEl.hidden = true;
    loadingEl.hidden = false;
    alert.hide();
    load();
  }
});
