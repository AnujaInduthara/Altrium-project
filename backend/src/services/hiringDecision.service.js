const { supabaseAdmin } = require('../config/supabase');
const { canTransition } = require('../utils/applicationStatus');

// A typed, HTTP-aware error the controller translates straight to a
// response — mirrors the *Error classes in the other services. `details`
// carries structured extras (e.g. which stages are outstanding) the same way
// InterviewError.fields does for validation errors.
class HiringDecisionError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.name = 'HiringDecisionError';
    this.isHiringDecisionError = true;
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

const REASON_MAX = 2000;

// Best-effort cleanup: a decision row that was inserted but then couldn't be
// matched to the application's guarded status update (a concurrent change
// beat us to it). Mirrors deleteInterviewQuietly in interview.service.js —
// storage/Postgres writes aren't one transaction here either, so this is
// compensation, not a rollback: failure is logged and swallowed so the
// caller still gets a clean, accurate conflict rather than a 500.
async function deleteDecisionQuietly(decisionId) {
  try {
    const { error } = await supabaseAdmin.from('hiring_decisions').delete().eq('id', decisionId);
    if (error) console.error('Orphaned hiring decision cleanup failed:', decisionId, error.message);
  } catch (err) {
    console.error('Orphaned hiring decision cleanup threw:', decisionId, err.message);
  }
}

// PB-21 — the Hiring Manager's final Hire/Reject decision. One per
// application, ever (the UNIQUE(application_id) constraint is the real
// guarantee; the 23505 handling below only turns it into a friendly 409).
//
//   applicationId        : the candidate's application
//   profileId             : the deciding Hiring Manager's own profile id
//                           (hiring_decisions.hiring_manager_profile_id)
//   authUserId            : the deciding user's auth id (applications'
//                           status_updated_by, which references auth.users)
//   decision              : 'hired' | 'rejected'
//   reason                : optional free text, required when any stage is
//                           still incomplete
//   acknowledgeIncomplete : must be exactly `true` to decide with an
//                           incomplete stage still outstanding
async function decide({ applicationId, profileId, authUserId, decision, reason, acknowledgeIncomplete }) {
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (trimmedReason.length > REASON_MAX) {
    throw new HiringDecisionError(
      'VALIDATION_ERROR',
      400,
      `Reason must be ${REASON_MAX} characters or fewer.`
    );
  }

  const { data: process, error: processError } = await supabaseAdmin
    .from('candidate_interview_processes')
    .select('id, vacancy_id, status')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (processError) {
    if (processError.code === '22P02') {
      throw new HiringDecisionError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
    }
    throw wrapDbError('Failed to load interview process', processError);
  }
  if (!process) {
    throw new HiringDecisionError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
  }

  const { data: application, error: applicationError } = await supabaseAdmin
    .from('applications')
    .select('id, status')
    .eq('id', applicationId)
    .maybeSingle();

  if (applicationError) throw wrapDbError('Failed to load application', applicationError);
  if (!application) {
    throw new HiringDecisionError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
  }

  // Checked BEFORE the status-transition check below: once a decision has
  // been made, application.status is already 'hired'/'rejected' and would
  // otherwise fail that check too — but the accurate, expected response for
  // a second decision is specifically 409 DECISION_EXISTS, not a generic
  // "not selected" conflict. This pre-check races harmlessly against a
  // concurrent decision; the UNIQUE(application_id) constraint (via the
  // insert's 23505 handling below) is the actual guarantee either way.
  const { data: existingDecision, error: existingDecisionError } = await supabaseAdmin
    .from('hiring_decisions')
    .select('id')
    .eq('application_id', applicationId)
    .maybeSingle();
  if (existingDecisionError) throw wrapDbError('Failed to check for an existing decision', existingDecisionError);
  if (existingDecision) {
    throw new HiringDecisionError(
      'DECISION_EXISTS',
      409,
      'A hiring decision has already been recorded for this candidate.'
    );
  }

  if (!canTransition(application.status, decision)) {
    throw new HiringDecisionError(
      'INVALID_APPLICATION_STATUS',
      409,
      'This candidate must be selected before a hiring decision can be made.'
    );
  }

  const { data: stages, error: stagesError } = await supabaseAdmin
    .from('candidate_interview_stages')
    .select('stage_name, status')
    .eq('process_id', process.id);
  if (stagesError) throw wrapDbError('Failed to load interview stages', stagesError);

  const outstanding = (stages || []).filter((s) => s.status !== 'completed' && s.status !== 'skipped');
  if (outstanding.length > 0 && !(acknowledgeIncomplete === true && trimmedReason.length > 0)) {
    throw new HiringDecisionError(
      'STAGES_INCOMPLETE',
      409,
      'One or more interview stages are not yet completed. Acknowledge this and provide a reason to decide anyway.',
      { outstanding_stages: outstanding.map((s) => ({ stage_name: s.stage_name, status: s.status })) }
    );
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('hiring_decisions')
    .insert({
      application_id: applicationId,
      vacancy_id: process.vacancy_id,
      hiring_manager_profile_id: profileId,
      decision,
      reason: trimmedReason || null,
    })
    .select('id, application_id, vacancy_id, hiring_manager_profile_id, decision, reason, decided_at')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      throw new HiringDecisionError(
        'DECISION_EXISTS',
        409,
        'A hiring decision has already been recorded for this candidate.'
      );
    }
    throw wrapDbError('Failed to record hiring decision', insertError);
  }

  const now = new Date().toISOString();
  const { data: updatedApplication, error: updateError } = await supabaseAdmin
    .from('applications')
    .update({
      status: decision,
      status_updated_at: now,
      status_updated_by: authUserId,
    })
    .eq('id', applicationId)
    .eq('status', application.status)
    .select('id, status')
    .maybeSingle();

  if (updateError) {
    await deleteDecisionQuietly(inserted.id);
    throw wrapDbError('Failed to update application status', updateError);
  }
  if (!updatedApplication) {
    // A concurrent change moved the application out from under us between our
    // read and this guarded write — the decision row must not outlive the
    // status change it was supposed to cause. Never let the two disagree.
    await deleteDecisionQuietly(inserted.id);
    throw new HiringDecisionError(
      'INVALID_APPLICATION_STATUS',
      409,
      "This candidate's status changed before the decision could be recorded. Please refresh and try again."
    );
  }

  // Best-effort sync — the decision + application status above are the real
  // source of truth. Guarded so a concurrently-cancelled process isn't
  // resurrected.
  await supabaseAdmin
    .from('candidate_interview_processes')
    .update({ status: 'completed' })
    .eq('id', process.id)
    .neq('status', 'cancelled');

  return inserted;
}

module.exports = { decide, HiringDecisionError };
