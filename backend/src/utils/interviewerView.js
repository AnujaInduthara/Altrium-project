// PB-18 — pure helpers for the interviewer's own view of an interview.
//
// toInterviewerView() is a deliberate allow-list projection: it reads only
// the named fields off the row and builds a brand-new object, so a row that
// happens to carry AI screening fields, other candidates, other
// interviewers' evaluations or HR notes (e.g. from an overly broad query
// elsewhere) can never leak through by accident.

function toInterviewerView(row) {
  return {
    id: row.id,
    scheduled_date: row.scheduled_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    stage_name: row.candidate_interview_stages?.stage_name ?? null,
    job_title: row.job_vacancies?.job_title ?? null,
    department: row.job_vacancies?.department ?? null,
    candidate_name: row.applications?.full_name ?? null,
    evaluation_submitted: false,
  };
}

// 'upcoming' = still scheduled and not in the past; 'past' is everything
// else (completed, cancelled, no_show, or a scheduled date that's gone by).
// `todayIso` is passed in (rather than read from Date.now() here) so this
// stays a pure, deterministically testable function.
function isUpcoming(view, todayIso) {
  return view.status === 'scheduled' && view.scheduled_date >= todayIso;
}

function filterByScope(views, scope, todayIso) {
  if (scope === 'upcoming') {
    return views
      .filter((v) => isUpcoming(v, todayIso))
      .sort((a, b) => `${a.scheduled_date}T${a.start_time}`.localeCompare(`${b.scheduled_date}T${b.start_time}`));
  }
  return views
    .filter((v) => !isUpcoming(v, todayIso))
    .sort((a, b) => `${b.scheduled_date}T${b.start_time}`.localeCompare(`${a.scheduled_date}T${a.start_time}`));
}

module.exports = { toInterviewerView, filterByScope };
