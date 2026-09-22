const test = require('node:test');
const assert = require('node:assert/strict');

const { validateScheduleInput, fitsWithinAvailability } = require('../src/utils/interviewScheduling');

const TODAY = '2026-06-15';
const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';

function input(overrides = {}) {
  return {
    scheduled_date: TODAY,
    start_time: '09:00',
    durationMinutes: 60,
    interviewer_ids: [ID_A],
    required_interviewers: 1,
    todayIso: TODAY,
    ...overrides,
  };
}

// --- validateScheduleInput -------------------------------------------------

test('accepts well-formed input and derives end_time from start + duration', () => {
  const { valid, errors, value } = validateScheduleInput(input());
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.equal(value.start_time, '09:00');
  assert.equal(value.end_time, '10:00');
  assert.deepEqual(value.interviewer_ids, [ID_A]);
});

test('accepts a date of today (not strictly future)', () => {
  const { valid } = validateScheduleInput(input({ scheduled_date: TODAY }));
  assert.equal(valid, true);
});

test('rejects a past date', () => {
  const { valid, errors } = validateScheduleInput(input({ scheduled_date: '2026-06-14' }));
  assert.equal(valid, false);
  assert.match(errors.scheduled_date, /past/i);
});

test('rejects a malformed date', () => {
  const { valid, errors } = validateScheduleInput(input({ scheduled_date: 'not-a-date' }));
  assert.equal(valid, false);
  assert.match(errors.scheduled_date, /valid date/i);
});

test('rejects a malformed start time', () => {
  const { valid, errors } = validateScheduleInput(input({ start_time: '9am' }));
  assert.equal(valid, false);
  assert.match(errors.start_time, /valid start time/i);
});

test('rejects a start time off the 5-minute boundary', () => {
  const { valid, errors } = validateScheduleInput(input({ start_time: '09:02' }));
  assert.equal(valid, false);
  assert.match(errors.start_time, /5-minute/i);
});

test('rejects a start time that would push the interview past midnight', () => {
  const { valid, errors } = validateScheduleInput(
    input({ start_time: '23:30', durationMinutes: 60 })
  );
  assert.equal(valid, false);
  assert.match(errors.start_time, /midnight/i);
});

test('rejects duplicate interviewer ids', () => {
  const { valid, errors } = validateScheduleInput(
    input({ interviewer_ids: [ID_A, ID_A], required_interviewers: 2 })
  );
  assert.equal(valid, false);
  assert.match(errors.interviewer_ids, /only be chosen once/i);
});

test('rejects an invalid interviewer id', () => {
  const { valid, errors } = validateScheduleInput(input({ interviewer_ids: ['not-a-uuid'] }));
  assert.equal(valid, false);
  assert.match(errors.interviewer_ids, /valid id/i);
});

test('rejects an empty interviewer list', () => {
  const { valid, errors } = validateScheduleInput(input({ interviewer_ids: [] }));
  assert.equal(valid, false);
  assert.match(errors.interviewer_ids, /at least one/i);
});

test('rejects the wrong number of interviewers for the stage', () => {
  const { valid, errors } = validateScheduleInput(
    input({ interviewer_ids: [ID_A], required_interviewers: 2 })
  );
  assert.equal(valid, false);
  assert.match(errors.interviewer_ids, /exactly 2 interviewers/i);
});

test('accepts the exact required number of distinct interviewers', () => {
  const { valid, value } = validateScheduleInput(
    input({ interviewer_ids: [ID_A, ID_B], required_interviewers: 2 })
  );
  assert.equal(valid, true);
  assert.deepEqual(value.interviewer_ids, [ID_A, ID_B]);
});

// --- fitsWithinAvailability --------------------------------------------

test('an exact fit is accepted', () => {
  const fits = fitsWithinAvailability(
    { start_time: '09:00', end_time: '10:00' },
    [{ slot_date: TODAY, start_time: '09:00', end_time: '10:00' }]
  );
  assert.equal(fits, true);
});

test('a window fully inside a larger slot is accepted', () => {
  const fits = fitsWithinAvailability(
    { start_time: '09:30', end_time: '10:00' },
    [{ slot_date: TODAY, start_time: '09:00', end_time: '11:00' }]
  );
  assert.equal(fits, true);
});

test('a window overhanging the start of the slot is rejected', () => {
  const fits = fitsWithinAvailability(
    { start_time: '08:30', end_time: '09:30' },
    [{ slot_date: TODAY, start_time: '09:00', end_time: '10:00' }]
  );
  assert.equal(fits, false);
});

test('a window overhanging the end of the slot is rejected', () => {
  const fits = fitsWithinAvailability(
    { start_time: '09:30', end_time: '10:30' },
    [{ slot_date: TODAY, start_time: '09:00', end_time: '10:00' }]
  );
  assert.equal(fits, false);
});

test('a window spanning two adjacent free slots is rejected', () => {
  const fits = fitsWithinAvailability(
    { start_time: '09:30', end_time: '10:30' },
    [
      { slot_date: TODAY, start_time: '09:00', end_time: '10:00' },
      { slot_date: TODAY, start_time: '10:00', end_time: '11:00' },
    ]
  );
  assert.equal(fits, false);
});

test('a matching window on a different date is not offered', () => {
  const fits = fitsWithinAvailability(
    { slot_date: TODAY, start_time: '09:00', end_time: '10:00' },
    [{ slot_date: '2026-06-16', start_time: '09:00', end_time: '10:00' }]
  );
  assert.equal(fits, false);
});

test('an empty free-slots list never fits', () => {
  assert.equal(fitsWithinAvailability({ start_time: '09:00', end_time: '10:00' }, []), false);
});
