// Pure PB-15/PB-16 scheduling validation — no DB access.

const { toMinutes, toTimeString } = require('./timeSlots');

const TIME_STEP_MINUTES = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTES_PER_DAY = 24 * 60;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// { scheduled_date, start_time, durationMinutes, interviewer_ids,
//   required_interviewers, todayIso } -> { valid, errors, value }
//
// `durationMinutes` and `required_interviewers` come from the stage's own
// requirements (server-resolved, not client input) — this function derives
// end_time from start_time + durationMinutes rather than accepting an
// end_time from the request body, so a client can never submit a booking
// shorter/longer than what the stage actually requires.
function validateScheduleInput({
  scheduled_date,
  start_time,
  durationMinutes,
  interviewer_ids,
  required_interviewers,
  todayIso,
} = {}) {
  const errors = {};

  const date = typeof scheduled_date === 'string' ? scheduled_date.trim() : '';
  if (!DATE_RE.test(date)) {
    errors.scheduled_date = 'Enter a valid date (YYYY-MM-DD).';
  } else if (typeof todayIso === 'string' && DATE_RE.test(todayIso) && date < todayIso) {
    errors.scheduled_date = 'The date cannot be in the past.';
  }

  const startMinutes = toMinutes(start_time);
  if (startMinutes === null) {
    errors.start_time = 'Enter a valid start time (HH:MM).';
  } else if (startMinutes % TIME_STEP_MINUTES !== 0) {
    errors.start_time = `Start time must be on a ${TIME_STEP_MINUTES}-minute boundary.`;
  }

  let endTime = null;
  if (!errors.start_time) {
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      errors.start_time = 'A valid stage duration is required.';
    } else {
      const endMinutes = startMinutes + durationMinutes;
      if (endMinutes > MINUTES_PER_DAY) {
        errors.start_time = 'This time would run past midnight — choose an earlier start time.';
      } else {
        endTime = toTimeString(endMinutes);
      }
    }
  }

  const ids = [];
  if (!Array.isArray(interviewer_ids) || interviewer_ids.length === 0) {
    errors.interviewer_ids = 'Choose at least one interviewer.';
  } else {
    const seen = new Set();
    for (const raw of interviewer_ids) {
      if (!isUuid(raw)) {
        errors.interviewer_ids = 'Each interviewer must be identified by a valid id.';
        break;
      }
      if (seen.has(raw)) {
        errors.interviewer_ids = 'Each interviewer can only be chosen once.';
        break;
      }
      seen.add(raw);
      ids.push(raw);
    }
    if (
      !errors.interviewer_ids &&
      Number.isInteger(required_interviewers) &&
      ids.length !== required_interviewers
    ) {
      errors.interviewer_ids = `This stage requires exactly ${required_interviewers} interviewer${
        required_interviewers === 1 ? '' : 's'
      }.`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      scheduled_date: date,
      start_time: errors.start_time ? null : toTimeString(startMinutes),
      end_time: endTime,
      interviewer_ids: errors.interviewer_ids ? [] : ids,
    },
  };
}

// window: { start_time, end_time } (HH:MM), optionally { slot_date }.
// freeSlots: [{ slot_date, start_time, end_time }]. True only if the window
// is FULLY inside ONE free slot — a window spanning two adjacent free slots
// (even with no gap between them) is never accepted, since each is a
// separate published availability row and only one is being checked at a time.
function fitsWithinAvailability(window, freeSlots) {
  const windowStart = toMinutes(window.start_time);
  const windowEnd = toMinutes(window.end_time);
  if (windowStart === null || windowEnd === null) return false;

  return (freeSlots || []).some((slot) => {
    if (window.slot_date && slot.slot_date && window.slot_date !== slot.slot_date) return false;
    const slotStart = toMinutes(slot.start_time);
    const slotEnd = toMinutes(slot.end_time);
    if (slotStart === null || slotEnd === null) return false;
    return slotStart <= windowStart && windowEnd <= slotEnd;
  });
}

module.exports = { validateScheduleInput, fitsWithinAvailability };
