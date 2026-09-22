// Pure PB-17 notification content builders. No DB access.
//
// The CANDIDATE templates are a privacy boundary: each one is built by
// EXPLICITLY constructing the allowed output object from named `ctx`
// properties — never by copying `ctx` and deleting disallowed fields. That
// means any extra data a caller accidentally includes on `ctx` (an AI score,
// an internal id, another candidate's name, an HR note, ...) is simply never
// read, so it can never leak into the title, body or payload no matter what
// ends up on `ctx`.

const NOTIFICATION_TYPES = Object.freeze({
  INTERVIEW_SCHEDULED_CANDIDATE: 'interview_scheduled_candidate',
  INTERVIEW_SCHEDULED_INTERVIEWER: 'interview_scheduled_interviewer',
  INTERVIEW_CANCELLED_CANDIDATE: 'interview_cancelled_candidate',
  INTERVIEW_CANCELLED_INTERVIEWER: 'interview_cancelled_interviewer',
});

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ctx: { vacancyTitle, stageName, scheduledDate, startTime, durationMinutes }
// The candidate payload may contain ONLY: job title, stage name, date, start
// time and duration. Never an AI score, rank, recommendation, skills,
// screening summary, interviewer names/comments, HR notes, other candidates,
// or any internal id.
function buildInterviewScheduledForCandidate(ctx = {}) {
  const dateLabel = formatDate(ctx.scheduledDate);
  return {
    type: NOTIFICATION_TYPES.INTERVIEW_SCHEDULED_CANDIDATE,
    title: 'Your interview has been scheduled',
    body: `Your ${ctx.stageName || 'interview'} for ${ctx.vacancyTitle || 'the role'} is scheduled for ${dateLabel} at ${ctx.startTime}.`,
    payload: {
      job_title: ctx.vacancyTitle || null,
      stage_name: ctx.stageName || null,
      scheduled_date: ctx.scheduledDate || null,
      start_time: ctx.startTime || null,
      duration_minutes: ctx.durationMinutes ?? null,
    },
  };
}

function buildInterviewCancelledForCandidate(ctx = {}) {
  const dateLabel = formatDate(ctx.scheduledDate);
  return {
    type: NOTIFICATION_TYPES.INTERVIEW_CANCELLED_CANDIDATE,
    title: 'Your interview has been cancelled',
    body: `Your ${ctx.stageName || 'interview'} for ${ctx.vacancyTitle || 'the role'} scheduled for ${dateLabel} at ${ctx.startTime} has been cancelled.`,
    payload: {
      job_title: ctx.vacancyTitle || null,
      stage_name: ctx.stageName || null,
      scheduled_date: ctx.scheduledDate || null,
      start_time: ctx.startTime || null,
      duration_minutes: ctx.durationMinutes ?? null,
    },
  };
}

// ctx additionally carries { candidateName, interviewerName } — interviewers
// are HR/employee accounts that already see candidate names elsewhere (e.g.
// the Interviews list), so this is not a privacy boundary the way the
// candidate templates are. It still never includes an AI score, rank,
// recommendation, HR note or any other candidate — those simply aren't part
// of `ctx` in the first place (see notification.service.js's context loader).
function buildInterviewScheduledForInterviewer(ctx = {}) {
  const dateLabel = formatDate(ctx.scheduledDate);
  return {
    type: NOTIFICATION_TYPES.INTERVIEW_SCHEDULED_INTERVIEWER,
    title: 'New interview assigned',
    body: `You're scheduled to conduct the ${ctx.stageName || 'interview'} for ${ctx.candidateName || 'a candidate'} (${ctx.vacancyTitle || 'role'}) on ${dateLabel} at ${ctx.startTime}.`,
    payload: {
      candidate_name: ctx.candidateName || null,
      job_title: ctx.vacancyTitle || null,
      stage_name: ctx.stageName || null,
      scheduled_date: ctx.scheduledDate || null,
      start_time: ctx.startTime || null,
      duration_minutes: ctx.durationMinutes ?? null,
    },
  };
}

function buildInterviewCancelledForInterviewer(ctx = {}) {
  const dateLabel = formatDate(ctx.scheduledDate);
  return {
    type: NOTIFICATION_TYPES.INTERVIEW_CANCELLED_INTERVIEWER,
    title: 'Interview cancelled',
    body: `The ${ctx.stageName || 'interview'} for ${ctx.candidateName || 'a candidate'} (${ctx.vacancyTitle || 'role'}) on ${dateLabel} at ${ctx.startTime} has been cancelled.`,
    payload: {
      candidate_name: ctx.candidateName || null,
      job_title: ctx.vacancyTitle || null,
      stage_name: ctx.stageName || null,
      scheduled_date: ctx.scheduledDate || null,
      start_time: ctx.startTime || null,
      duration_minutes: ctx.durationMinutes ?? null,
    },
  };
}

module.exports = {
  NOTIFICATION_TYPES,
  buildInterviewScheduledForCandidate,
  buildInterviewCancelledForCandidate,
  buildInterviewScheduledForInterviewer,
  buildInterviewCancelledForInterviewer,
};
