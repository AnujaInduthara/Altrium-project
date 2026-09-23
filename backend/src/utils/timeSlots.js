// Pure time/interval helpers for PB-13 (availability) and PB-14 (matching).
// No imports, no Supabase, no Express, no Date-based "today" — the caller
// always supplies `todayIso` so this stays deterministic and testable without
// mocking the clock. All minute-range arguments/returns are plain
// { start, end } objects in minutes-since-midnight.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The optional `:SS[.ffffff]` suffix is NOT for client input (the HTML time
// input and every form on this site only ever sends "HH:MM") — it exists
// because Postgres `time` columns round-trip through PostgREST/supabase-js as
// "HH:MM:SS" (discovered end-to-end: interview_availability.start_time comes
// back as e.g. "09:00:00", not "09:00"). Without it, every DB-sourced time
// silently failed to parse, buildFreeSlots() in interviewerMatching.js always
// computed zero free slots, and interview scheduling always reported every
// interviewer as unavailable — this one line is why. toTimeString() always
// re-normalises back to plain "HH:MM" before anything is persisted or
// compared, so accepting seconds here is a pure input-parsing widening, not a
// validation loosening.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
const TIME_STEP_MINUTES = 5;
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 8 * 60;

// 'HH:MM' (or the DB's 'HH:MM:SS') -> minutes since midnight, or null if not
// a valid 24h time string.
function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const match = TIME_RE.exec(hhmm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// minutes since midnight -> 'HH:MM', or null for anything outside 0..1439.
function toTimeString(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60 - 1) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// { slot_date, start_time, end_time, todayIso } -> { valid, errors, value }.
// slot_date/todayIso are both 'YYYY-MM-DD' — compared as strings, which sorts
// identically to chronological order for that format, so this never has to
// parse a Date (and never has a timezone to get wrong).
function validateSlotInput({ slot_date, start_time, end_time, todayIso } = {}) {
  const errors = {};

  const date = typeof slot_date === 'string' ? slot_date.trim() : '';
  if (!DATE_RE.test(date)) {
    errors.slot_date = 'Enter a valid date (YYYY-MM-DD).';
  } else if (typeof todayIso === 'string' && DATE_RE.test(todayIso) && date < todayIso) {
    errors.slot_date = 'The date cannot be in the past.';
  }

  const startMinutes = toMinutes(start_time);
  if (startMinutes === null) {
    errors.start_time = 'Enter a valid start time (HH:MM).';
  } else if (startMinutes % TIME_STEP_MINUTES !== 0) {
    errors.start_time = `Start time must be on a ${TIME_STEP_MINUTES}-minute boundary.`;
  }

  const endMinutes = toMinutes(end_time);
  if (endMinutes === null) {
    errors.end_time = 'Enter a valid end time (HH:MM).';
  } else if (endMinutes % TIME_STEP_MINUTES !== 0) {
    errors.end_time = `End time must be on a ${TIME_STEP_MINUTES}-minute boundary.`;
  }

  if (!errors.start_time && !errors.end_time) {
    const duration = endMinutes - startMinutes;
    if (duration <= 0) {
      errors.end_time = 'End time must be after start time.';
    } else if (duration < MIN_DURATION_MINUTES) {
      errors.end_time = `A slot must be at least ${MIN_DURATION_MINUTES} minutes long.`;
    } else if (duration > MAX_DURATION_MINUTES) {
      errors.end_time = `A slot cannot be longer than ${MAX_DURATION_MINUTES / 60} hours.`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      slot_date: date,
      start_time: errors.start_time ? null : toTimeString(startMinutes),
      end_time: errors.end_time ? null : toTimeString(endMinutes),
    },
  };
}

// Two { start, end } minute ranges. Touching endpoints do NOT overlap:
// 10:00-11:00 and 11:00-12:00 are fine (strict inequalities on both sides).
function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

// The remaining free sub-ranges of `slot` after removing every range in
// `busyList` that intersects it, sorted, merged, and dropping any remainder
// shorter than `minDuration` minutes (default 0 = keep everything).
function subtractIntervals(slot, busyList, minDuration = 0) {
  const clipped = (busyList || [])
    .map((b) => ({ start: Math.max(b.start, slot.start), end: Math.min(b.end, slot.end) }))
    .filter((b) => b.start < b.end)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ start: b.start, end: b.end });
    }
  }

  const free = [];
  let cursor = slot.start;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < slot.end) free.push({ start: cursor, end: slot.end });

  return free.filter((f) => f.end - f.start >= minDuration);
}

module.exports = { toMinutes, toTimeString, validateSlotInput, overlaps, subtractIntervals };
