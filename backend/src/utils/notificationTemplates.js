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
  HIRING_DECISION_HR: 'hiring_decision_hr',
  HIRING_DECISION_CANDIDATE: 'hiring_decision_candidate',
  CANDIDATE_SELECTED: 'candidate_selected',
  CANDIDATE_ACCOUNT_INVITE: 'candidate_account_invite',
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

// ---------------------------------------------------------------------------
// Candidate selected for interview (application status -> 'selected'), sent
// before any specific interview slot exists — buildInterviewScheduledForCandidate
// above follows up with the date/time once one is booked.
// ---------------------------------------------------------------------------

// ctx: { vacancyTitle }. Same privacy boundary as the other candidate
// templates: only the job title, nothing else.
function buildCandidateSelected(ctx = {}) {
  return {
    type: NOTIFICATION_TYPES.CANDIDATE_SELECTED,
    title: "You've been selected for an interview",
    body: `Good news! You've been selected to move forward for the ${ctx.vacancyTitle || 'role'} position. We'll be in touch soon with interview details.`,
    payload: {
      job_title: ctx.vacancyTitle || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Candidate account invite — sent once, the first time an applicant's
// selection provisions them a portal account (candidateAccount.service.js).
// ---------------------------------------------------------------------------

// ctx: { vacancyTitle, setPasswordUrl }. Same privacy boundary as every other
// candidate template: only these two named ctx fields are ever read. The URL
// is a one-time, self-service link to the candidate's OWN account, not
// information about the hiring process, so it's the only candidate payload
// that legitimately carries a link — it still never carries anything else
// (no AI score, no rank, no HR note, no other candidate, no internal id).
function buildCandidateAccountInvite(ctx = {}) {
  return {
    type: NOTIFICATION_TYPES.CANDIDATE_ACCOUNT_INVITE,
    title: 'Set up your Altrium account',
    body:
      `Create your Altrium account to track your interview for the ${ctx.vacancyTitle || 'role'} position. ` +
      `Set your password here: ${ctx.setPasswordUrl || ''}`,
    payload: {
      job_title: ctx.vacancyTitle || null,
    },
  };
}

// ---------------------------------------------------------------------------
// PB-22 — the final hiring decision.
// ---------------------------------------------------------------------------

// ctx: { candidateName, vacancyTitle, decision, decidedAt, decidedByName }.
// HR already sees everything about their own vacancy's candidates elsewhere
// (screening, interviewer feedback, ...), so this is not a privacy boundary
// the way the candidate template below is — it may also carry who decided
// and when.
function buildDecisionForHr(ctx = {}) {
  const hired = ctx.decision === 'hired';
  return {
    type: NOTIFICATION_TYPES.HIRING_DECISION_HR,
    title: hired ? 'Candidate hired' : 'Candidate not selected',
    body: hired
      ? `${ctx.candidateName || 'The candidate'} has been selected for ${ctx.vacancyTitle || 'the role'}.`
      : `${ctx.candidateName || 'The candidate'} was not selected for ${ctx.vacancyTitle || 'the role'}.`,
    payload: {
      candidate_name: ctx.candidateName || null,
      job_title: ctx.vacancyTitle || null,
      decision: ctx.decision || null,
      decided_at: ctx.decidedAt || null,
      decided_by_name: ctx.decidedByName || null,
    },
  };
}

// ctx additionally carries `decision` and (in production) never anything
// else — see notification.service.js's context loader, which deliberately
// never selects an AI score, rank, interviewer feedback, HR note, the
// decision's own reason text, or any internal id. This builder is a HARD
// privacy boundary regardless: it explicitly constructs the allowed output
// from named `ctx` properties (vacancyTitle, decision) and reads nothing
// else off `ctx`, so anything extra a caller accidentally attaches — even
// the polluted context this file's test throws at it — is simply never read
// and can never leak into the title, body or payload.
function buildDecisionForCandidate(ctx = {}) {
  const hired = ctx.decision === 'hired';
  return {
    type: NOTIFICATION_TYPES.HIRING_DECISION_CANDIDATE,
    title: hired ? 'Congratulations!' : 'Thank you for your time',
    body: hired
      ? `Congratulations! You have been selected for the ${ctx.vacancyTitle || 'role'} position.`
      : `Thank you for your interest in the ${ctx.vacancyTitle || 'role'} position. We have decided to move forward with another candidate.`,
    payload: {
      job_title: ctx.vacancyTitle || null,
      decision: ctx.decision || null,
    },
  };
}

module.exports = {
  NOTIFICATION_TYPES,
  buildInterviewScheduledForCandidate,
  buildInterviewCancelledForCandidate,
  buildInterviewScheduledForInterviewer,
  buildInterviewCancelledForInterviewer,
  buildCandidateSelected,
  buildCandidateAccountInvite,
  buildDecisionForHr,
  buildDecisionForCandidate,
};
