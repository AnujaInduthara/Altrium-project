const { supabaseAdmin } = require('../config/supabase');
const employeeService = require('./employee.service');
const interviewProcessService = require('./interviewProcess.service');
const { filterQualifiedEmployees, buildFreeSlots } = require('../utils/interviewerMatching');
const { toMinutes, overlaps } = require('../utils/timeSlots');

const FIELDS = ['id', 'profile_id', 'slot_date', 'start_time', 'end_time', 'created_at', 'updated_at'].join(
  ', '
);

const DEFAULT_RANGE_DAYS = 60;

class AvailabilityError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'AvailabilityError';
    this.isAvailabilityError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The caller's own slots, bounded by [from, to] (inclusive, ISO dates).
// Defaults to today..+60 days when neither is given.
async function listMine(profileId, { from, to } = {}) {
  const today = todayIsoUtc();
  const rangeStart = from || today;
  const rangeEnd = to || addDaysIso(today, DEFAULT_RANGE_DAYS);

  const { data, error } = await supabaseAdmin
    .from('interview_availability')
    .select(FIELDS)
    .eq('profile_id', profileId)
    .gte('slot_date', rangeStart)
    .lte('slot_date', rangeEnd)
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) throw wrapDbError('Failed to list availability', error);
  return data || [];
}

// `value` must already be validated (see utils/timeSlots.js's
// validateSlotInput) — the controller does that before calling this.
async function create(profileId, value) {
  const { data, error } = await supabaseAdmin
    .from('interview_availability')
    .insert({
      profile_id: profileId,
      slot_date: value.slot_date,
      start_time: value.start_time,
      end_time: value.end_time,
    })
    .select(FIELDS)
    .single();

  if (error) {
    // 23P01 = exclusion_violation — the GiST exclusion constraint in
    // sql/011_create_interview_availability.sql is the real guarantee; this
    // only turns its rejection into a friendly, typed 409.
    if (error.code === '23P01') {
      throw new AvailabilityError(
        'SLOT_OVERLAP',
        409,
        'This slot overlaps one you already have on this date.'
      );
    }
    throw wrapDbError('Failed to create availability slot', error);
  }

  return data;
}

// Step 3.3: a slot has a booked interview if the employee has a
// non-cancelled interview_interviewers row on the same date whose window
// overlaps it. Looks the slot up by id (not by caller) — the ownership check
// belongs to remove(), which must run it BEFORE this, never after (see the
// comment there).
async function hasBookedInterviews(slotId) {
  const { data: slot, error } = await supabaseAdmin
    .from('interview_availability')
    .select('profile_id, slot_date, start_time, end_time')
    .eq('id', slotId)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return false; // invalid id -> caller's own lookup already 404s
    throw wrapDbError('Failed to check for booked interviews', error);
  }
  if (!slot) return false;

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('interview_interviewers')
    .select('start_time, end_time')
    .eq('profile_id', slot.profile_id)
    .eq('scheduled_date', slot.slot_date)
    .is('cancelled_at', null);

  if (bookingsError) throw wrapDbError('Failed to check for booked interviews', bookingsError);

  const slotRange = { start: toMinutes(slot.start_time), end: toMinutes(slot.end_time) };
  return (bookings || []).some((b) =>
    overlaps(slotRange, { start: toMinutes(b.start_time), end: toMinutes(b.end_time) })
  );
}

// Scoped by profile_id in the WHERE clause so one employee can never delete
// another's slot — an id that exists but belongs to someone else is reported
// identically to an unknown id (404), never a 403 that would confirm it
// exists. Ownership is confirmed FIRST, before the booking check: checking
// hasBookedInterviews(id) on a slot that turns out to belong to someone else
// would otherwise leak, via a 409 instead of a 404, that some slot with that
// id exists and has a booking.
async function remove(profileId, id) {
  const { data: slot, error: slotError } = await supabaseAdmin
    .from('interview_availability')
    .select('id')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (slotError) {
    if (slotError.code === '22P02') {
      throw new AvailabilityError('SLOT_NOT_FOUND', 404, 'This availability slot could not be found.');
    }
    throw wrapDbError('Failed to load availability slot', slotError);
  }
  if (!slot) {
    throw new AvailabilityError('SLOT_NOT_FOUND', 404, 'This availability slot could not be found.');
  }

  const booked = await hasBookedInterviews(id);
  if (booked) {
    throw new AvailabilityError(
      'SLOT_HAS_INTERVIEWS',
      409,
      'This slot has a booked interview and cannot be removed.'
    );
  }

  const { data, error } = await supabaseAdmin
    .from('interview_availability')
    .delete()
    .eq('id', id)
    .eq('profile_id', profileId)
    .select('id')
    .maybeSingle();

  if (error) throw wrapDbError('Failed to delete availability slot', error);
  if (!data) {
    // Rare: raced with a concurrent delete between the check above and here.
    throw new AvailabilityError('SLOT_NOT_FOUND', 404, 'This availability slot could not be found.');
  }

  return { id: data.id };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

// Grace-period safety net: sql/012_create_interviews.sql (Step 3.3) creates
// these tables, but this code can run before that migration has actually
// been applied to a given database. PGRST205 ("table not found in schema
// cache") is Supabase's exact error for that — treated here as "no
// bookings", so this query starts returning real data the moment the
// migration is applied, with no code change needed. Any other error is a
// genuine failure and still propagates.
async function loadBookedInterviews(profileIds, from, to) {
  const { data, error } = await supabaseAdmin
    .from('interview_interviewers')
    .select('profile_id, interviews!inner(scheduled_date, start_time, end_time, status)')
    .in('profile_id', profileIds)
    .eq('interviews.status', 'scheduled')
    .gte('interviews.scheduled_date', from)
    .lte('interviews.scheduled_date', to);

  if (error) {
    if (error.code === 'PGRST205') return [];
    throw wrapDbError('Failed to load booked interviews', error);
  }

  return (data || []).map((row) => ({
    profile_id: row.profile_id,
    scheduled_date: row.interviews.scheduled_date,
    start_time: row.interviews.start_time,
    end_time: row.interviews.end_time,
  }));
}

// PB-14: for one configured stage, which qualifying employees are genuinely
// free — marked availability minus already-booked interviews. Owner-checked
// through stage -> process -> vacancy via interviewProcessService's shared
// resolver; an unknown stage or one under another HR user's vacancy is
// reported identically (404), never 403.
async function findAvailableInterviewers({ stageId, authUserId, from, to }) {
  const { stage } = await interviewProcessService.resolveOwnedStage(stageId, authUserId);

  const requirements = {
    department: stage.department,
    minimum_seniority: stage.minimum_seniority,
    required_interviewers: stage.required_interviewers,
    duration_minutes: stage.duration_minutes,
  };

  const allEmployees = await employeeService.listEmployees({});
  const qualified = filterQualifiedEmployees(allEmployees, {
    department: stage.department,
    minimumSeniority: stage.minimum_seniority,
  });

  if (qualified.length === 0) {
    return { requirements, interviewers: [] };
  }

  const profileIds = qualified.map((employee) => employee.id);

  // Two queries total, regardless of how many employees qualify: one for
  // availability, one for bookings. No N+1.
  const [{ data: availabilityRows, error: availabilityError }, bookings] = await Promise.all([
    supabaseAdmin
      .from('interview_availability')
      .select('profile_id, slot_date, start_time, end_time')
      .in('profile_id', profileIds)
      .gte('slot_date', from)
      .lte('slot_date', to),
    loadBookedInterviews(profileIds, from, to),
  ]);

  if (availabilityError) throw wrapDbError('Failed to load availability for matching', availabilityError);

  const availabilityByProfile = groupBy(availabilityRows || [], 'profile_id');
  const bookingsByProfile = groupBy(bookings, 'profile_id');

  const interviewers = qualified.map((employee) => ({
    profile_id: employee.id,
    full_name: employee.full_name,
    job_position: employee.job_position,
    department: employee.department,
    seniority_level: employee.seniority_level,
    free_slots: buildFreeSlots({
      availability: availabilityByProfile.get(employee.id) || [],
      bookings: bookingsByProfile.get(employee.id) || [],
      durationMinutes: stage.duration_minutes,
    }),
  }));

  return { requirements, interviewers };
}

module.exports = {
  listMine,
  create,
  remove,
  hasBookedInterviews,
  findAvailableInterviewers,
  AvailabilityError,
};
