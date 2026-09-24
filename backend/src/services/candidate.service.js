const { supabaseAdmin } = require('../config/supabase');

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

// Everything a candidate may see about their own interview(s), explicitly
// constructed field-by-field — mirrors notificationTemplates.js's allow-list
// pattern, never a spread of the raw row, so a column added to `interviews`
// or `applications` later (an internal note, an AI score, ...) can never
// leak here by accident. Scoped entirely by `profileId`, which the caller
// takes from the authenticated request's own profile (see
// candidate.controller.js) — never a client-supplied id.
async function listMyInterviews(profileId) {
  const { data: applications, error: applicationsError } = await supabaseAdmin
    .from('applications')
    .select('id')
    .eq('candidate_profile_id', profileId);
  if (applicationsError) throw wrapDbError('Failed to load your applications', applicationsError);

  const applicationIds = (applications || []).map((a) => a.id);
  if (applicationIds.length === 0) return [];

  const { data: interviews, error: interviewsError } = await supabaseAdmin
    .from('interviews')
    .select(
      `id, scheduled_date, start_time, end_time, status,
       candidate_interview_stages(stage_name),
       job_vacancies(job_title)`
    )
    .in('application_id', applicationIds)
    .order('scheduled_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (interviewsError) throw wrapDbError('Failed to load your interviews', interviewsError);

  return (interviews || []).map((row) => ({
    job_title: row.job_vacancies?.job_title || null,
    stage_name: row.candidate_interview_stages?.stage_name || null,
    scheduled_date: row.scheduled_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
  }));
}

module.exports = { listMyInterviews };
