const test = require('node:test');
const assert = require('node:assert/strict');

const { filterQualifiedEmployees, buildFreeSlots } = require('../src/utils/interviewerMatching');

// --- filterQualifiedEmployees ---------------------------------------------

const EMPLOYEES = [
  { id: 'a', department: 'Engineering', seniority_level: 'senior' },
  { id: 'b', department: 'Engineering', seniority_level: 'mid' },
  { id: 'c', department: 'Product', seniority_level: 'lead' },
  { id: 'd', department: 'Engineering', seniority_level: null },
  { id: 'e', department: 'Engineering', seniority_level: 'archived-level' },
];

test('qualifies by department, excluding other departments', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { department: 'Engineering' });
  assert.deepEqual(
    result.map((e) => e.id),
    ['a', 'b', 'd', 'e']
  );
});

test('no department requirement matches every department', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { department: null });
  assert.deepEqual(
    result.map((e) => e.id),
    EMPLOYEES.map((e) => e.id)
  );
});

test('qualifies by minimum seniority at or above the bar', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { minimumSeniority: 'mid' });
  // a=senior (above), b=mid (at), c=lead (above) qualify; d=null and e=unknown excluded
  assert.deepEqual(
    result.map((e) => e.id),
    ['a', 'b', 'c']
  );
});

test('excludes an employee below the seniority bar', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { minimumSeniority: 'senior' });
  assert.deepEqual(
    result.map((e) => e.id),
    ['a', 'c']
  );
});

test('excludes an employee with unknown or missing seniority when a minimum is required (fail closed)', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { minimumSeniority: 'intern' });
  assert.ok(!result.some((e) => e.id === 'd'));
  assert.ok(!result.some((e) => e.id === 'e'));
});

test('no seniority requirement does not exclude an employee with unknown/missing seniority', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { department: 'Engineering', minimumSeniority: null });
  assert.deepEqual(
    result.map((e) => e.id),
    ['a', 'b', 'd', 'e']
  );
});

test('combines department and seniority requirements', () => {
  const result = filterQualifiedEmployees(EMPLOYEES, { department: 'Engineering', minimumSeniority: 'senior' });
  assert.deepEqual(
    result.map((e) => e.id),
    ['a']
  );
});

test('an empty/undefined employee list returns an empty result', () => {
  assert.deepEqual(filterQualifiedEmployees([], {}), []);
  assert.deepEqual(filterQualifiedEmployees(undefined, {}), []);
});

// --- buildFreeSlots ---------------------------------------------------------

test('no bookings: the whole availability window is free', () => {
  const free = buildFreeSlots({
    availability: [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '11:00' }],
    bookings: [],
    durationMinutes: 60,
  });
  assert.deepEqual(free, [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '11:00' }]);
});

test('a booking splitting a slot in two leaves two windows', () => {
  const free = buildFreeSlots({
    availability: [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '12:00' }],
    bookings: [{ scheduled_date: '2026-06-15', start_time: '10:00', end_time: '10:30' }],
    durationMinutes: 15,
  });
  assert.deepEqual(free, [
    { slot_date: '2026-06-15', start_time: '09:00', end_time: '10:00' },
    { slot_date: '2026-06-15', start_time: '10:30', end_time: '12:00' },
  ]);
});

test('a booking covering the whole slot leaves no window', () => {
  const free = buildFreeSlots({
    availability: [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '10:00' }],
    bookings: [{ scheduled_date: '2026-06-15', start_time: '08:30', end_time: '10:30' }],
    durationMinutes: 15,
  });
  assert.deepEqual(free, []);
});

test('several bookings on one date are all subtracted', () => {
  const free = buildFreeSlots({
    availability: [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '13:00' }],
    bookings: [
      { scheduled_date: '2026-06-15', start_time: '09:30', end_time: '10:00' },
      { scheduled_date: '2026-06-15', start_time: '11:00', end_time: '11:30' },
    ],
    durationMinutes: 15,
  });
  assert.deepEqual(free, [
    { slot_date: '2026-06-15', start_time: '09:00', end_time: '09:30' },
    { slot_date: '2026-06-15', start_time: '10:00', end_time: '11:00' },
    { slot_date: '2026-06-15', start_time: '11:30', end_time: '13:00' },
  ]);
});

test('a booking on a different date does not affect this date\'s slot', () => {
  const free = buildFreeSlots({
    availability: [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '10:00' }],
    bookings: [{ scheduled_date: '2026-06-16', start_time: '09:00', end_time: '10:00' }],
    durationMinutes: 15,
  });
  assert.deepEqual(free, [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '10:00' }]);
});

test('a 30-minute remaining gap is dropped for a 60-minute requirement', () => {
  const free = buildFreeSlots({
    availability: [{ slot_date: '2026-06-15', start_time: '09:00', end_time: '10:00' }],
    bookings: [{ scheduled_date: '2026-06-15', start_time: '09:00', end_time: '09:30' }],
    durationMinutes: 60,
  });
  assert.deepEqual(free, []);
});

test('results are sorted by date then start time across multiple availability rows', () => {
  const free = buildFreeSlots({
    availability: [
      { slot_date: '2026-06-16', start_time: '09:00', end_time: '10:00' },
      { slot_date: '2026-06-15', start_time: '14:00', end_time: '15:00' },
      { slot_date: '2026-06-15', start_time: '09:00', end_time: '10:00' },
    ],
    bookings: [],
    durationMinutes: 15,
  });
  assert.deepEqual(
    free.map((f) => `${f.slot_date} ${f.start_time}`),
    ['2026-06-15 09:00', '2026-06-15 14:00', '2026-06-16 09:00']
  );
});

test('an employee with no availability rows has an empty free_slots result', () => {
  const free = buildFreeSlots({ availability: [], bookings: [], durationMinutes: 60 });
  assert.deepEqual(free, []);
});
