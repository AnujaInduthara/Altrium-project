const { supabaseAdmin } = require('../config/supabase');
const interviewService = require('./interview.service');
const { validateEvaluationInput, computeOverallRating, RATING_FIELDS } = require('../utils/evaluationValidation');

// A typed, HTTP-aware error the controller translates straight to a
// response — mirrors InterviewError in interview.service.js.
class EvaluationError extends Error {
  constructor(code, status, message, fields) {
    super(message);
    this.name = 'EvaluationError';
    this.isEvaluationError = true;
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

const EVALUATION_FIELDS = [
  'id',
  'interview_id',
  'interviewer_profile_id',
  'technical_rating',
  'problem_solving_rating',
  'communication_rating',
  'role_knowledge_rating',
  'overall_rating',
  'comments',
  'submitted_at',
].join(', ');

// Raw fields evaluation.service.js needs off the interview itself — separate
// from interview.service.js's interviewer-facing projection, since this is
// an internal read (status/timing checks, the parent stage id), never
// returned to a client as-is.
async function loadInterviewCore(interviewId) {
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .select('id, candidate_stage_id, status, scheduled_date, start_time')
    .eq('id', interviewId)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to load this interview', error);
  if (!data) {
    throw new interviewService.InterviewError('INTERVIEW_NOT_FOUND', 404, 'This interview could not be found.');
  }
  return data;
}

function hasStarted(interview, nowIso) {
  const startsAt = new Date(`${interview.scheduled_date}T${interview.start_time}`);
  return !Number.isNaN(startsAt.getTime()) && startsAt.getTime() <= new Date(nowIso).getTime();
}

// After a successful insert, flips the interview (and its parent stage) to
// 'completed' once every assigned, non-cancelled interviewer has submitted.
// Both updates are conditional on the current status (guarded on
// 'scheduled'), so a concurrent cancel or an already-completed interview is
// never clobbered.
async function maybeCompleteInterview(interview) {
  const [assigned, submitted] = await Promise.all([
    supabaseAdmin
      .from('interview_interviewers')
      .select('id', { count: 'exact', head: true })
      .eq('interview_id', interview.id)
      .is('cancelled_at', null),
    supabaseAdmin
      .from('interview_evaluations')
      .select('id', { count: 'exact', head: true })
      .eq('interview_id', interview.id),
  ]);

  if (assigned.error) throw wrapDbError('Failed to check assigned interviewers', assigned.error);
  if (submitted.error) throw wrapDbError('Failed to check submitted evaluations', submitted.error);

  const assignedCount = assigned.count ?? 0;
  const submittedCount = submitted.count ?? 0;
  if (assignedCount === 0 || submittedCount < assignedCount) return;

  const { error: interviewUpdateError } = await supabaseAdmin
    .from('interviews')
    .update({ status: 'completed' })
    .eq('id', interview.id)
    .eq('status', 'scheduled');
  if (interviewUpdateError) throw wrapDbError('Failed to complete interview', interviewUpdateError);

  const { error: stageUpdateError } = await supabaseAdmin
    .from('candidate_interview_stages')
    .update({ status: 'completed' })
    .eq('id', interview.candidate_stage_id)
    .eq('status', 'scheduled');
  if (stageUpdateError) throw wrapDbError('Failed to complete interview stage', stageUpdateError);
}

// PB-19 — the interviewer submits their structured evaluation. Reuses Step
// 4.1's assignment check for the "not assigned -> 404" gate, then applies
// its own refusals: the interview hasn't started yet, it's been cancelled,
// or this interviewer already submitted (the unique constraint is the real
// guarantee behind that last one — this is only a friendlier error before
// the round trip fails).
async function submit({ interviewId, profileId, input }) {
  await interviewService.assertAssignedInterviewer({ interviewId, profileId });

  const interview = await loadInterviewCore(interviewId);

  if (interview.status === 'cancelled') {
    throw new EvaluationError('INTERVIEW_CANCELLED', 409, 'This interview has been cancelled.');
  }

  if (!hasStarted(interview, new Date().toISOString())) {
    throw new EvaluationError(
      'INTERVIEW_NOT_STARTED',
      409,
      "This interview hasn't started yet. You can submit your evaluation once it has."
    );
  }

  const { valid, errors, value } = validateEvaluationInput(input);
  if (!valid) {
    throw new EvaluationError(
      'VALIDATION_ERROR',
      400,
      'Please check your ratings and try again.',
      errors
    );
  }

  const overall_rating = computeOverallRating(RATING_FIELDS.map((field) => value[field]));

  const { data: evaluation, error } = await supabaseAdmin
    .from('interview_evaluations')
    .insert({
      interview_id: interviewId,
      interviewer_profile_id: profileId,
      technical_rating: value.technical_rating,
      problem_solving_rating: value.problem_solving_rating,
      communication_rating: value.communication_rating,
      role_knowledge_rating: value.role_knowledge_rating,
      overall_rating,
      comments: value.comments || null,
    })
    .select(EVALUATION_FIELDS)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new EvaluationError(
        'EVALUATION_EXISTS',
        409,
        'You have already submitted an evaluation for this interview.'
      );
    }
    throw wrapDbError('Failed to submit evaluation', error);
  }

  await maybeCompleteInterview(interview);

  return evaluation;
}

// The caller's OWN evaluation for this interview only — never any other
// interviewer's. Null if they haven't submitted yet.
async function getForInterview({ interviewId, profileId }) {
  await interviewService.assertAssignedInterviewer({ interviewId, profileId });

  const { data, error } = await supabaseAdmin
    .from('interview_evaluations')
    .select(EVALUATION_FIELDS)
    .eq('interview_id', interviewId)
    .eq('interviewer_profile_id', profileId)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to load your evaluation', error);
  return data || null;
}

module.exports = { submit, getForInterview, EvaluationError };
