const test = require('node:test');
const assert = require('node:assert/strict');

const { toMinutes, toTimeString, validateSlotInput, overlaps, subtractIntervals } = require(
  '../src/utils/timeSlots'
);

// --- toMinutes / toTimeString ------------------------------------------

test('toMinutes parses HH:MM correctly', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('09:05'), 545);
  assert.equal(toMinutes('23:59'), 1439);
  assert.equal(toMinutes('12:30'), 750);
});

test('toMinutes rejects malformed input', () => {
  for (const raw of ['24:00', '9:05', '09:5', '09:60', 'abc', '', null, undefined, 42]) {
    assert.equal(toMinutes(raw), null);
  }
});

// Postgres `time` columns round-trip through PostgREST/supabase-js as
// "HH:MM:SS" (e.g. interview_availability.start_time), not the "HH:MM" every
// client form sends. Discovered end-to-end via backend/scripts/seed.js: a
// stricter regex here silently zeroed every DB-sourced availability/booking
// time, so buildFreeSlots() always reported zero free slots and scheduling
// always failed with "interviewer unavailable" — never caught by unit tests
// because they only ever used hand-written "HH:MM" fixtures.
test('toMinutes also accepts the DB round-trip format HH:MM:SS', () => {
  assert.equal(toMinutes('00:00:00'), 0);
  assert.equal(toMinutes('09:05:00'), 545);
  assert.equal(toMinutes('23:59:59'), 1439);
});

test('toMinutes also accepts fractional seconds', () => {
  assert.equal(toMinutes('09:05:00.123456'), 545);
});

test('toMinutes still rejects an out-of-range seconds component', () => {
  assert.equal(toMinutes('09:05:60'), null);
});

test('toTimeString formats minutes with zero-padding', () => {
  assert.equal(toTimeString(0), '00:00');
  assert.equal(toTimeString(545), '09:05');
  assert.equal(toTimeString(1439), '23:59');
});

test('toTimeString rejects out-of-range or non-integer input', () => {
  for (const raw of [-1, 1440, 1.5, NaN, null, undefined, 'x']) {
    assert.equal(toTimeString(raw), null);
  }
});

test('toMinutes/toTimeString round-trip for every 5-minute boundary in a day', () => {
  for (let m = 0; m < 1440; m += 5) {
    assert.equal(toMinutes(toTimeString(m)), m);
  }
});

// --- validateSlotInput ---------------------------------------------------

const TODAY = '2026-06-15';

function slot(overrides = {}) {
  return {
    slot_date: TODAY,
    start_time: '09:00',
    end_time: '10:00',
    todayIso: TODAY,
    ...overrides,
  };
}

test('accepts a well-formed, future slot', () => {
  const { valid, errors, value } = validateSlotInput(slot());
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { slot_date: TODAY, start_time: '09:00', end_time: '10:00' });
});

test('accepts a slot dated today (not strictly future)', () => {
  const { valid } = validateSlotInput(slot({ slot_date: TODAY }));
  assert.equal(valid, true);
});

test('rejects a malformed date', () => {
  for (const slot_date of ['15-06-2026', '2026/06/15', 'tomorrow', '', undefined]) {
    const { valid, errors } = validateSlotInput(slot({ slot_date }));
    assert.equal(valid, false);
    assert.match(errors.slot_date, /valid date/i);
  }
});

test('rejects a past date', () => {
  const { valid, errors } = validateSlotInput(slot({ slot_date: '2026-06-14' }));
  assert.equal(valid, false);
  assert.match(errors.slot_date, /past/i);
});

test('rejects a malformed start or end time', () => {
  for (const start_time of ['9:00', '25:00', '09:60', 'noon', '']) {
    const { valid, errors } = validateSlotInput(slot({ start_time }));
    assert.equal(valid, false);
    assert.match(errors.start_time, /valid start time/i);
  }
  for (const end_time of ['9:00', '25:00', '09:60', 'noon', '']) {
    const { valid, errors } = validateSlotInput(slot({ end_time }));
    assert.equal(valid, false);
    assert.match(errors.end_time, /valid end time/i);
  }
});

test('rejects times off the 5-minute boundary', () => {
  const start = validateSlotInput(slot({ start_time: '09:02' }));
  assert.equal(start.valid, false);
  assert.match(start.errors.start_time, /5-minute/i);

  const end = validateSlotInput(slot({ end_time: '10:03' }));
  assert.equal(end.valid, false);
  assert.match(end.errors.end_time, /5-minute/i);
});

test('rejects end_time equal to or before start_time', () => {
  for (const end_time of ['09:00', '08:00']) {
    const { valid, errors } = validateSlotInput(slot({ end_time }));
    assert.equal(valid, false);
    assert.match(errors.end_time, /after start time/i);
  }
});

test('rejects a duration under 15 minutes', () => {
  const { valid, errors } = validateSlotInput(slot({ start_time: '09:00', end_time: '09:10' }));
  assert.equal(valid, false);
  assert.match(errors.end_time, /at least 15 minutes/i);
});

test('accepts a duration of exactly 15 minutes', () => {
  const { valid } = validateSlotInput(slot({ start_time: '09:00', end_time: '09:15' }));
  assert.equal(valid, true);
});

test('rejects a duration over 8 hours', () => {
  const { valid, errors } = validateSlotInput(slot({ start_time: '08:00', end_time: '16:05' }));
  assert.equal(valid, false);
  assert.match(errors.end_time, /8 hours/i);
});

test('accepts a duration of exactly 8 hours', () => {
  const { valid } = validateSlotInput(slot({ start_time: '08:00', end_time: '16:00' }));
  assert.equal(valid, true);
});

// --- overlaps ---------------------------------------------------------------

test('overlaps detects a genuine overlap', () => {
  assert.equal(overlaps({ start: 540, end: 600 }, { start: 570, end: 630 }), true);
});

test('overlaps detects full containment', () => {
  assert.equal(overlaps({ start: 540, end: 660 }, { start: 570, end: 600 }), true);
});

test('touching endpoints do NOT overlap', () => {
  // 10:00-11:00 and 11:00-12:00
  assert.equal(overlaps({ start: 600, end: 660 }, { start: 660, end: 720 }), false);
  assert.equal(overlaps({ start: 660, end: 720 }, { start: 600, end: 660 }), false);
});

test('overlaps is false for genuinely disjoint ranges', () => {
  assert.equal(overlaps({ start: 540, end: 600 }, { start: 700, end: 760 }), false);
});

// --- subtractIntervals -------------------------------------------------

test('no busy ranges: the whole slot is free', () => {
  const free = subtractIntervals({ start: 540, end: 600 }, []);
  assert.deepEqual(free, [{ start: 540, end: 600 }]);
});

test('a busy range in the middle leaves two remainders', () => {
  const free = subtractIntervals({ start: 540, end: 660 }, [{ start: 570, end: 600 }]);
  assert.deepEqual(free, [
    { start: 540, end: 570 },
    { start: 600, end: 660 },
  ]);
});

test('a busy range covering the whole slot leaves no remainder', () => {
  const free = subtractIntervals({ start: 540, end: 600 }, [{ start: 500, end: 700 }]);
  assert.deepEqual(free, []);
});

test('overlapping busy ranges are merged before subtracting', () => {
  const free = subtractIntervals({ start: 540, end: 720 }, [
    { start: 560, end: 600 },
    { start: 580, end: 620 }, // overlaps the first
  ]);
  assert.deepEqual(free, [
    { start: 540, end: 560 },
    { start: 620, end: 720 },
  ]);
});

test('adjacent (touching) busy ranges are merged into one gap', () => {
  const free = subtractIntervals({ start: 540, end: 720 }, [
    { start: 560, end: 600 },
    { start: 600, end: 620 },
  ]);
  assert.deepEqual(free, [
    { start: 540, end: 560 },
    { start: 620, end: 720 },
  ]);
});

test('busy ranges outside the slot are clipped/ignored', () => {
  const free = subtractIntervals({ start: 540, end: 600 }, [
    { start: 0, end: 540 }, // ends exactly at slot start — no overlap
    { start: 600, end: 1000 }, // starts exactly at slot end — no overlap
  ]);
  assert.deepEqual(free, [{ start: 540, end: 600 }]);
});

test('remainders shorter than the minimum duration are dropped', () => {
  const free = subtractIntervals(
    { start: 540, end: 660 },
    [{ start: 555, end: 600 }], // leaves a 15-min gap (540-555) and a 60-min gap (600-660)
    30
  );
  assert.deepEqual(free, [{ start: 600, end: 660 }]);
});

test('subtractIntervals with no minDuration keeps zero-length gaps out but keeps everything else', () => {
  const free = subtractIntervals({ start: 540, end: 600 }, [{ start: 550, end: 560 }]);
  assert.deepEqual(free, [
    { start: 540, end: 550 },
    { start: 560, end: 600 },
  ]);
});
