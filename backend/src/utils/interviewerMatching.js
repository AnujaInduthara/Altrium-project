// Pure PB-14 matching logic — no DB access. Given data already fetched by
// availability.service.js, decides which employees qualify for a stage and
// exactly when each one is genuinely free (marked availability minus already
// booked interviews).

const { toMinutes, toTimeString, subtractIntervals } = require('./timeSlots');
const { meetsMinimumSeniority } = require('../config/seniority');

// `department`/`minimumSeniority` are the stage's requirements — either may
// be null/absent, meaning "no requirement" (matches everyone on that axis).
// An employee with an unknown/missing seniority_level is excluded whenever a
// minimum IS specified (meetsMinimumSeniority already fails closed); with no
// minimum specified, seniority is never checked at all.
function filterQualifiedEmployees(employees, { department, minimumSeniority } = {}) {
  return (employees || []).filter((employee) => {
    if (department && employee.department !== department) return false;
    if (minimumSeniority && !meetsMinimumSeniority(employee.seniority_level, minimumSeniority)) {
      return false;
    }
    return true;
  });
}

function groupByDate(rows, dateKey) {
  const map = new Map();
  for (const row of rows || []) {
    const date = row[dateKey];
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(row);
  }
  return map;
}

// For ONE employee: `availability` ({ slot_date, start_time, end_time }[])
// and `bookings` ({ scheduled_date, start_time, end_time }[], already booked
// interviews for that employee) -> the remaining windows of at least
// `durationMinutes`, sorted by date then start time.
function buildFreeSlots({ availability, bookings, durationMinutes }) {
  const availabilityByDate = groupByDate(availability, 'slot_date');
  const bookingsByDate = groupByDate(bookings, 'scheduled_date');

  const results = [];

  for (const [date, slots] of availabilityByDate) {
    const busy = (bookingsByDate.get(date) || []).map((b) => ({
      start: toMinutes(b.start_time),
      end: toMinutes(b.end_time),
    }));

    for (const row of slots) {
      const slot = { start: toMinutes(row.start_time), end: toMinutes(row.end_time) };
      const free = subtractIntervals(slot, busy, durationMinutes);
      for (const window of free) {
        results.push({
          slot_date: date,
          start_time: toTimeString(window.start),
          end_time: toTimeString(window.end),
        });
      }
    }
  }

  results.sort((a, b) => {
    if (a.slot_date !== b.slot_date) return a.slot_date < b.slot_date ? -1 : 1;
    if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
    return 0;
  });

  return results;
}

module.exports = { filterQualifiedEmployees, buildFreeSlots };
