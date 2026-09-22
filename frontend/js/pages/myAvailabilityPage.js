// My Availability page controller (PB-13). Mounts the app shell, allows any
// interviewer-eligible role (employee/hr/hiring_manager — not HR-only), and
// lets the signed-in employee publish/remove their own interview
// availability. HR's scheduling view of this data is Step 3.2, not here.

import { AuthService } from '../services/authService.js';
import { AvailabilityService } from '../services/availabilityService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { createModal } from '../components/Modal.js';

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['employee', 'hr', 'hiring_manager'];

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'my-availability',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('availability-page');
const loadingEl = $('availability-loading');
const emptyEl = $('availability-empty');
const errorEl = $('availability-error');
const groupsEl = $('availability-groups');
const alert = createAlert($('availability-alert'));
const removeModal = createModal($('remove-slot-modal'));

const form = $('availability-form');
const dateInput = $('slot_date');
const startInput = $('start_time');
const endInput = $('end_time');
const addBtn = $('add-slot-btn');

let submitting = false;
let removing = false;
let pendingRemove = null;

// --- helpers -------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

dateInput.min = todayIso();

function setFieldError(name, message) {
  const wrap = document.querySelector(`[data-field="${name}"]`);
  const errorEl2 = $(`${name}-error`);
  if (message) {
    wrap?.classList.add('is-invalid');
    if (errorEl2) errorEl2.textContent = message;
  } else {
    wrap?.classList.remove('is-invalid');
    if (errorEl2) errorEl2.textContent = '';
  }
}

function clearFieldErrors() {
  setFieldError('slot_date', '');
  setFieldError('start_time', '');
  setFieldError('end_time', '');
}

// Mirrors backend/src/utils/timeSlots.js's validateSlotInput — the server is
// the source of truth; this just gives immediate feedback before the round
// trip. type="date"/type="time" already constrain format and the 5-minute
// step, so this only checks what those inputs can't.
function validateClientSide({ slot_date, start_time, end_time }) {
  const errors = {};
  const today = todayIso();

  if (!slot_date) errors.slot_date = 'Enter a date.';
  else if (slot_date < today) errors.slot_date = 'The date cannot be in the past.';

  if (!start_time) errors.start_time = 'Enter a start time.';
  if (!end_time) errors.end_time = 'Enter an end time.';

  if (!errors.start_time && !errors.end_time) {
    const [sh, sm] = start_time.split(':').map(Number);
    const [eh, em] = end_time.split(':').map(Number);
    const duration = eh * 60 + em - (sh * 60 + sm);
    if (duration <= 0) errors.end_time = 'End time must be after start time.';
    else if (duration < 15) errors.end_time = 'A slot must be at least 15 minutes long.';
    else if (duration > 480) errors.end_time = 'A slot cannot be longer than 8 hours.';
  }

  return errors;
}

function formatDateHeading(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// --- rendering ----------------------------------------------------------

function buildSlotRow(slot) {
  const li = document.createElement('li');
  li.className = 'availability-slot';

  const time = document.createElement('span');
  time.className = 'availability-slot__time';
  time.textContent = `${slot.start_time} – ${slot.end_time}`;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-button';
  removeBtn.setAttribute('aria-label', `Remove availability ${slot.start_time} to ${slot.end_time}`);
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => openRemoveModal(slot));

  li.append(time, removeBtn);
  return li;
}

function buildDateGroup(date, slots) {
  const section = document.createElement('section');
  section.className = 'card availability-group';

  const heading = document.createElement('h3');
  heading.className = 'availability-group__date';
  heading.textContent = formatDateHeading(date);

  const list = document.createElement('ul');
  list.className = 'availability-group__list';
  list.append(...slots.map(buildSlotRow));

  section.append(heading, list);
  return section;
}

function groupByDate(slots) {
  const map = new Map();
  for (const slot of slots) {
    if (!map.has(slot.slot_date)) map.set(slot.slot_date, []);
    map.get(slot.slot_date).push(slot);
  }
  return map;
}

function renderSlots(slots) {
  loadingEl.hidden = true;
  errorEl.hidden = true;

  if (slots.length === 0) {
    groupsEl.replaceChildren();
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  const grouped = groupByDate(slots);
  groupsEl.replaceChildren(...[...grouped.entries()].map(([date, dateSlots]) => buildDateGroup(date, dateSlots)));
}

// --- add flow -----------------------------------------------------------

function setAddBtnBusy(busy) {
  submitting = busy;
  addBtn.disabled = busy;
  addBtn.setAttribute('aria-busy', String(busy));
  addBtn.querySelector('[data-label]').textContent = busy ? 'Adding…' : 'Add Availability';
}

async function handleSubmit(event) {
  event.preventDefault();
  if (submitting) return;

  alert.hide();
  clearFieldErrors();

  const values = {
    slot_date: dateInput.value,
    start_time: startInput.value,
    end_time: endInput.value,
  };

  const clientErrors = validateClientSide(values);
  if (Object.keys(clientErrors).length > 0) {
    Object.entries(clientErrors).forEach(([name, message]) => setFieldError(name, message));
    return;
  }

  setAddBtnBusy(true);

  try {
    const { ok, status, body } = await AvailabilityService.create(values);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (ok) {
      form.reset();
      dateInput.min = todayIso();
      alert.success('Availability added.');
      await loadSlots({ silent: true });
      return;
    }

    if (status === 400 && body?.error?.fields) {
      Object.entries(body.error.fields).forEach(([name, message]) => setFieldError(name, message));
      alert.error(body.error.message || 'Please check the slot details and try again.');
    } else if (status === 409) {
      alert.error(body?.error?.message || 'This slot overlaps one you already have on this date.');
    } else {
      alert.error(body?.error?.message || 'Unable to add availability. Please try again.');
    }
  } catch (err) {
    alert.error('Unable to add availability. Please check your connection and try again.');
  } finally {
    setAddBtnBusy(false);
  }
}

// --- remove flow ----------------------------------------------------------

function openRemoveModal(slot) {
  pendingRemove = slot;
  $('remove-slot-modal-body').textContent =
    `Remove your availability on ${formatDateHeading(slot.slot_date)} from ${slot.start_time} to ${slot.end_time}?`;
  removeModal.open();
}

async function confirmRemove() {
  if (removing || !pendingRemove) return;
  removing = true;

  const confirmBtn = $('confirm-remove-slot-btn');
  confirmBtn.disabled = true;
  confirmBtn.setAttribute('aria-busy', 'true');
  confirmBtn.querySelector('[data-label]').textContent = 'Removing…';

  try {
    const { ok, status, body } = await AvailabilityService.remove(pendingRemove.id);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    removeModal.close();

    if (ok) {
      alert.success('Availability removed.');
      await loadSlots({ silent: true });
    } else if (status === 409) {
      alert.error(body?.error?.message || 'This slot has a booked interview and cannot be removed.');
    } else if (status === 404) {
      alert.error('This slot could not be found. It may have already been removed.');
      await loadSlots({ silent: true });
    } else {
      alert.error(body?.error?.message || 'Unable to remove this slot. Please try again.');
    }
  } catch (err) {
    removeModal.close();
    alert.error('Unable to remove this slot. Please check your connection and try again.');
  } finally {
    removing = false;
    pendingRemove = null;
    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-busy', 'false');
    confirmBtn.querySelector('[data-label]').textContent = 'Remove';
  }
}

// --- data loading ----------------------------------------------------

async function loadSlots({ silent = false } = {}) {
  if (!silent) {
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;
  }

  try {
    const { ok, status, body } = await AvailabilityService.list();

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok) {
      loadingEl.hidden = true;
      emptyEl.hidden = true;
      errorEl.hidden = false;
      $('availability-error-message').textContent =
        body?.error?.message || 'Please check your connection and try again.';
      return;
    }

    renderSlots(body?.data?.slots || []);
  } catch (err) {
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    errorEl.hidden = false;
  }
}

async function init() {
  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email, role: result.profile.role });
  page.hidden = false;
  await loadSlots();
}

function wireOnce() {
  form.addEventListener('submit', handleSubmit);
  $('availability-retry').addEventListener('click', () => loadSlots());
  $('confirm-remove-slot-btn').addEventListener('click', confirmRemove);
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
