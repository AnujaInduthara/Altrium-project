const { supabaseAdmin } = require('../config/supabase');
const interviewProcessService = require('./interviewProcess.service');
const availabilityService = require('./availability.service');
const vacancyService = require('./vacancy.service');
const notificationService = require('./notification.service');
const { validateScheduleInput, fitsWithinAvailability } = require('../utils/interviewScheduling');
const { toInterviewerView, filterByScope } = require('../utils/interviewerView');

const INTERVIEW_FIELDS = [
  'id',
  'candidate_stage_id',
  'application_id',
  'vacancy_id',
  'scheduled_date',
  'start_time',
  'end_time',
  'status',
  'scheduled_by',
  'created_at',
  'updated_at',
].join(', ');

class InterviewError extends Error {
  constructor(code, status, message, fields) {
    super(message);
    this.name = 'InterviewError';
    this.isInterviewError = true;
    this.code = code;
    this.status = status;
    if (fields) this.fields = fields;
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

// Best-effort compensation if the interviewer join insert fails after the
// interview row was already created — mirrors deleteCvQuietly in
// application.service.js. Storage/Postgres writes aren't one transaction
// here either, so this is cleanup, not a rollback: failure is logged and
// swallowed so the caller still gets a clean typed error.
async function deleteInterviewQuietly(interviewId) {
  try {
    const { error } = await supabaseAdmin.from('interviews').delete().eq('id', interviewId);
    if (error) console.error('Orphaned interview cleanup failed:', interviewId, error.message);
  } catch (err) {
    console.error('Orphaned interview cleanup threw:', interviewId, err.message);
  }
}

// PB-15/PB-16: turn a chosen interviewer set + time into a booked interview.
// The database is the final guard against double booking (the exclusion
// constraint in sql/012_create_interviews.sql); everything here exists only
// to produce a friendly error before that round trip, and to keep
// candidate_interview_stages.status in sync.
async function schedule({ stageId, input, authUserId }) {
  const { stage, process } = await interviewProcessService.resolveOwnedStage(stageId, authUserId);

  const { valid, errors, value } = validateScheduleInput({
    scheduled_date: input.scheduled_date,
    start_time: input.start_time,
    durationMinutes: stage.duration_minutes,
    interviewer_ids: input.interviewer_ids,
    required_interviewers: stage.required_interviewers,
    todayIso: todayIsoUtc(),
  });

  if (!valid) {
    throw new InterviewError(
      'VALIDATION_ERROR',
      400,
      'Please check the scheduling details and try again.',
      errors
    );
  }

  if (stage.status !== 'pending') {
    throw new InterviewError(
      'STAGE_ALREADY_SCHEDULED',
      409,
      'This stage already has an interview scheduled.'
    );
  }

  // Recompute qualification + CURRENT free slots server-side, scoped to just
  // this one date — the request body supplies choices, never facts. Reuses
  // the exact Step 3.2 logic (same ownership chain, same pure helpers) rather
  // than re-deriving it, so there is one definition of "is this interviewer
  // actually free right now".
  const { interviewers } = await availabilityService.findAvailableInterviewers({
    stageId,
    authUserId,
    from: value.scheduled_date,
    to: value.scheduled_date,
  });
  const qualifiedById = new Map(interviewers.map((i) => [i.profile_id, i]));

  const window = { slot_date: value.scheduled_date, start_time: value.start_time, end_time: value.end_time };
  for (const interviewerId of value.interviewer_ids) {
    const candidate = qualifiedById.get(interviewerId);
    if (!candidate || !fitsWithinAvailability(window, candidate.free_slots)) {
      throw new InterviewError(
        'INTERVIEWER_UNAVAILABLE',
        409,
        'One or more chosen interviewers are no longer available for this time. Please search again.'
      );
    }
  }

  const { data: interview, error: interviewError } = await supabaseAdmin
    .from('interviews')
    .insert({
      candidate_stage_id: stageId,
      application_id: process.application_id,
      vacancy_id: process.vacancy_id,
      scheduled_date: value.scheduled_date,
      start_time: value.start_time,
      end_time: value.end_time,
      status: 'scheduled',
      scheduled_by: authUserId,
    })
    .select(INTERVIEW_FIELDS)
    .single();

  if (interviewError) {
    // UNIQUE(candidate_stage_id) is the idempotency guard — a second
    // schedule request for the same stage becomes a typed 409, not a second
    // booking.
    if (interviewError.code === '23505') {
      throw new InterviewError(
        'STAGE_ALREADY_SCHEDULED',
        409,
        'This stage already has an interview scheduled.'
      );
    }
    throw wrapDbError('Failed to schedule interview', interviewError);
  }

  const joinRows = value.interviewer_ids.map((profileId) => ({
    interview_id: interview.id,
    profile_id: profileId,
    scheduled_date: value.scheduled_date,
    start_time: value.start_time,
    end_time: value.end_time,
  }));

  const { error: joinError } = await supabaseAdmin.from('interview_interviewers').insert(joinRows);

  if (joinError) {
    await deleteInterviewQuietly(interview.id);

    // 23P01 = exclusion_violation — the GiST exclusion constraint is the
    // real guarantee (the pre-check above is only a friendly-error attempt);
    // this is what fires when two concurrent requests race for the same
    // interviewer/time and this one loses.
    if (joinError.code === '23P01') {
      throw new InterviewError(
        'INTERVIEWER_UNAVAILABLE',
        409,
        'One or more chosen interviewers were booked elsewhere at the same moment. Please search again.'
      );
    }
    throw wrapDbError('Failed to assign interviewers', joinError);
  }

  // Conditional so a concurrently-cancelled/edited stage isn't clobbered.
  // Best-effort sync: the interview + join rows above are the actual source
  // of truth for the booking itself.
  await supabaseAdmin
    .from('candidate_interview_stages')
    .update({ status: 'scheduled' })
    .eq('id', stageId)
    .eq('status', 'pending');

  // PB-17: notify the candidate + interviewer(s) after the response would
  // already be on its way — a notification failure must never turn this
  // successful booking into an error.
  notificationService.dispatchInBackground(() => notificationService.notifyInterviewScheduled(interview.id));

  return interview;
}

// Loads one interview and confirms the caller owns its vacancy. An unknown
// interview, or one under another HR user's vacancy, is reported identically
// (404), never 403.
async function resolveOwnedInterview(interviewId, authUserId) {
  const { data: interview, error } = await supabaseAdmin
    .from('interviews')
    .select(INTERVIEW_FIELDS)
    .eq('id', interviewId)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') {
      throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
    }
    throw wrapDbError('Failed to load interview', error);
  }
  if (!interview) {
    throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
  }

  try {
    const vacancy = await vacancyService.getVacancyForUser(interview.vacancy_id, authUserId);
    if (!vacancy) {
      throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
    }
  } catch (err) {
    if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
      throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
    }
    throw err;
  }

  return interview;
}

// Cancels a scheduled interview: frees the interviewer(s)' time (stamping
// cancelled_at, which the partial exclusion constraint excludes from overlap
// checks) and returns the stage to 'pending'.
async function cancel({ interviewId, authUserId }) {
  const interview = await resolveOwnedInterview(interviewId, authUserId);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('interviews')
    .update({ status: 'cancelled' })
    .eq('id', interview.id)
    .eq('status', 'scheduled')
    .select(INTERVIEW_FIELDS)
    .maybeSingle();

  if (updateError) throw wrapDbError('Failed to cancel interview', updateError);
  if (!updated) {
    throw new InterviewError('INTERVIEW_ALREADY_CANCELLED', 409, 'This interview has already been cancelled.');
  }

  const { error: joinError } = await supabaseAdmin
    .from('interview_interviewers')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('interview_id', updated.id)
    .is('cancelled_at', null);
  if (joinError) throw wrapDbError('Failed to free interviewer time', joinError);

  await supabaseAdmin
    .from('candidate_interview_stages')
    .update({ status: 'pending' })
    .eq('id', updated.candidate_stage_id)
    .eq('status', 'scheduled');

  notificationService.dispatchInBackground(() => notificationService.notifyInterviewCancelled(updated.id));

  return updated;
}

function mapInterviewRow(row) {
  return {
    id: row.id,
    candidate_stage_id: row.candidate_stage_id,
    scheduled_date: row.scheduled_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    application_id: row.application_id,
    vacancy_id: row.vacancy_id,
    candidate_name: row.applications?.full_name || null,
    vacancy_title: row.job_vacancies?.job_title || null,
    stage_name: row.candidate_interview_stages?.stage_name || null,
    interviewers: (row.interview_interviewers || [])
      .filter((ii) => !ii.cancelled_at)
      .map((ii) => ({ profile_id: ii.profile_id, full_name: ii.profiles?.full_name || null })),
  };
}

async function listInterviewsForVacancyIds(vacancyIds, { from, to } = {}) {
  if (!vacancyIds || vacancyIds.length === 0) return [];

  let query = supabaseAdmin
    .from('interviews')
    .select(
      `id, candidate_stage_id, scheduled_date, start_time, end_time, status, application_id, vacancy_id,
       candidate_interview_stages(stage_name),
       applications(full_name),
       job_vacancies(job_title),
       interview_interviewers(profile_id, cancelled_at, profiles(full_name))`
    )
    .in('vacancy_id', vacancyIds)
    .eq('status', 'scheduled')
    .order('scheduled_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (from) query = query.gte('scheduled_date', from);
  if (to) query = query.lte('scheduled_date', to);

  const { data, error } = await query;
  if (error) throw wrapDbError('Failed to list interviews', error);

  return (data || []).map(mapInterviewRow);
}

// HR's Interviews page: every upcoming (status='scheduled') interview across
// every vacancy the caller owns, newest-first by date/time.
async function listUpcomingForHr(authUserId, { from, to } = {}) {
  const vacancies = await vacancyService.listVacanciesForUser(authUserId);
  return listInterviewsForVacancyIds(
    vacancies.map((v) => v.id),
    { from, to }
  );
}

// Scoped to one vacancy the caller owns — 404 otherwise (never 403, which
// would confirm the vacancy exists).
async function listForVacancy(vacancyId, authUserId) {
  try {
    const vacancy = await vacancyService.getVacancyForUser(vacancyId, authUserId);
    if (!vacancy) {
      throw new InterviewError('VACANCY_NOT_FOUND', 404, 'This vacancy could not be found.');
    }
  } catch (err) {
    if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
      throw new InterviewError('VACANCY_NOT_FOUND', 404, 'This vacancy could not be found.');
    }
    throw err;
  }
  return listInterviewsForVacancyIds([vacancyId], {});
}

// ---------------------------------------------------------------------------
// PB-18 — the interviewer's own view of interviews they're assigned to.
// Interviewers are ordinary employees on their existing account; access is
// assignment-checked here, never role-checked beyond "authenticated employee"
// (that part is the route's job). Not assigned -> 404, never 403. Neither
// query joins application_screenings — an interviewer must never receive any
// AI screening field, any other candidate, any other interviewer's
// evaluation, or any HR note.
// ---------------------------------------------------------------------------

const INTERVIEWER_JOIN_SELECT = `
  interviews!inner(
    id,
    status,
    scheduled_date,
    start_time,
    end_time,
    candidate_interview_stages(stage_name),
    job_vacancies(job_title, department),
    applications(full_name)
  )
`;

// scope 'upcoming' | 'past' — see utils/interviewerView.js for the split.
async function listForInterviewer({ profileId, scope }) {
  const { data, error } = await supabaseAdmin
    .from('interview_interviewers')
    .select(INTERVIEWER_JOIN_SELECT)
    .eq('profile_id', profileId)
    .is('cancelled_at', null);

  if (error) throw wrapDbError('Failed to list your interviews', error);

  const views = (data || [])
    .map((row) => row.interviews)
    .filter(Boolean)
    .map(toInterviewerView);

  return filterByScope(views, scope, todayIsoUtc());
}

// Confirms a non-cancelled interview_interviewers row exists for
// (interviewId, profileId); throws the typed not-found error otherwise
// (never 403). This is THE assignment check for the interviewer's own view
// (Step 4.1) — PB-19's evaluation.service.js reuses it as-is for its own
// "not assigned -> 404" gate before applying its own, evaluation-specific
// refusals (not started / cancelled / already submitted).
async function assertAssignedInterviewer({ interviewId, profileId }) {
  const { data: joinRow, error: joinError } = await supabaseAdmin
    .from('interview_interviewers')
    .select('id')
    .eq('interview_id', interviewId)
    .eq('profile_id', profileId)
    .is('cancelled_at', null)
    .maybeSingle();

  if (joinError) {
    if (joinError.code === '22P02') {
      throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
    }
    throw wrapDbError('Failed to load this interview', joinError);
  }
  if (!joinRow) {
    throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
  }
}

// The same projection as listForInterviewer, plus what the interviewer needs
// to prepare: the candidate's email/phone and the vacancy's job description
// and requirements. Throws the typed not-found error (never 403) unless the
// caller is an assigned, non-cancelled interviewer on this interview.
async function getForInterviewer({ interviewId, profileId }) {
  await assertAssignedInterviewer({ interviewId, profileId });

  const { data: interview, error } = await supabaseAdmin
    .from('interviews')
    .select(
      `id, application_id, status, scheduled_date, start_time, end_time,
       candidate_interview_stages(stage_name),
       job_vacancies(job_title, department, job_description, job_requirements),
       applications(full_name, email, phone)`
    )
    .eq('id', interviewId)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to load this interview', error);
  if (!interview) {
    throw new InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
  }

  return {
    ...toInterviewerView(interview),
    // Not a screening/HR field — just the id the CV endpoint needs, and the
    // interviewer's own assignment already grants them CV access to it.
    application_id: interview.application_id,
    candidate_email: interview.applications?.email ?? null,
    candidate_phone: interview.applications?.phone ?? null,
    job_description: interview.job_vacancies?.job_description ?? null,
    job_requirements: interview.job_vacancies?.job_requirements ?? [],
  };
}

// Used by application.controller.js's CV endpoint to extend HR's existing
// signed-URL access to an assigned, non-cancelled interviewer of that
// application. Fetches the caller's own (small) set of active assignments
// rather than filtering server-side on a nested column, since the exact
// PostgREST syntax for filtering an !inner-joined column varies by version.
async function isAssignedInterviewer({ applicationId, profileId }) {
  const { data, error } = await supabaseAdmin
    .from('interview_interviewers')
    .select('interviews!inner(application_id)')
    .eq('profile_id', profileId)
    .is('cancelled_at', null);

  if (error) throw wrapDbError('Failed to check interviewer assignment', error);
  return (data || []).some((row) => row.interviews?.application_id === applicationId);
}

module.exports = {
  schedule,
  cancel,
  listUpcomingForHr,
  listForVacancy,
  listForInterviewer,
  getForInterviewer,
  isAssignedInterviewer,
  assertAssignedInterviewer,
  InterviewError,
};
