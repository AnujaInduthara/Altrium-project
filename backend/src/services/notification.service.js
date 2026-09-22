const { supabaseAdmin } = require('../config/supabase');
const transport = require('./notification.transport');
const {
  buildInterviewScheduledForCandidate,
  buildInterviewCancelledForCandidate,
  buildInterviewScheduledForInterviewer,
  buildInterviewCancelledForInterviewer,
} = require('../utils/notificationTemplates');

const FIELDS = ['id', 'type', 'title', 'body', 'payload', 'read_at', 'created_at'].join(', ');

class NotificationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'NotificationError';
    this.isNotificationError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

// Runs `fn` after the current tick and swallows + logs any error, so
// notification work can never turn a successful request into a failure —
// mirrors screenApplicationInBackground in screening/screeningService.js.
function dispatchInBackground(fn) {
  setImmediate(() => {
    fn().catch((err) => {
      console.error('Background notification dispatch failed:', err.message);
    });
  });
}

// Delivers each notification independently — one bad row (e.g. a delivery
// failure for the candidate) must never stop the others from going out.
async function createMany(notifications) {
  const results = [];
  for (const notification of notifications) {
    try {
      results.push(await transport.deliver(notification));
    } catch (err) {
      console.error('Failed to deliver notification:', notification.type, err.message);
    }
  }
  return results;
}

// Everything the PB-17 templates need for one interview, in one query. Deliberately
// minimal — it never selects an AI score, rank, HR note or any other
// candidate's data, so there is nothing for a template to leak even by
// accident (see notificationTemplates.js's header comment).
async function loadInterviewNotificationContext(interviewId) {
  const { data, error } = await supabaseAdmin
    .from('interviews')
    .select(
      `id, scheduled_date, start_time, end_time,
       candidate_interview_stages(stage_name, duration_minutes),
       applications(full_name, email),
       job_vacancies(job_title),
       interview_interviewers(profile_id, profiles(full_name))`
    )
    .eq('id', interviewId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load interview notification context:', interviewId, error.message);
    return null;
  }
  if (!data) return null;

  return {
    candidateName: data.applications?.full_name || null,
    candidateEmail: data.applications?.email || null,
    vacancyTitle: data.job_vacancies?.job_title || null,
    stageName: data.candidate_interview_stages?.stage_name || null,
    durationMinutes: data.candidate_interview_stages?.duration_minutes ?? null,
    scheduledDate: data.scheduled_date,
    startTime: data.start_time,
    endTime: data.end_time,
    interviewers: (data.interview_interviewers || []).map((ii) => ({
      profileId: ii.profile_id,
      fullName: ii.profiles?.full_name || null,
    })),
  };
}

async function dispatchInterviewNotifications(interviewId, { candidateBuilder, interviewerBuilder }) {
  const ctx = await loadInterviewNotificationContext(interviewId);
  if (!ctx) return; // interview vanished between scheduling and dispatch — nothing to notify

  const notifications = [{ recipient_email: ctx.candidateEmail, ...candidateBuilder(ctx) }];

  for (const interviewer of ctx.interviewers) {
    notifications.push({
      recipient_profile_id: interviewer.profileId,
      ...interviewerBuilder({ ...ctx, interviewerName: interviewer.fullName }),
    });
  }

  await createMany(notifications);
}

// Called (via dispatchInBackground) after a successful schedule — one
// candidate notification + one per assigned interviewer.
async function notifyInterviewScheduled(interviewId) {
  await dispatchInterviewNotifications(interviewId, {
    candidateBuilder: buildInterviewScheduledForCandidate,
    interviewerBuilder: buildInterviewScheduledForInterviewer,
  });
}

// Called (via dispatchInBackground) after a successful cancel.
async function notifyInterviewCancelled(interviewId) {
  await dispatchInterviewNotifications(interviewId, {
    candidateBuilder: buildInterviewCancelledForCandidate,
    interviewerBuilder: buildInterviewCancelledForInterviewer,
  });
}

// The caller's own notifications, newest first.
async function listForProfile(profileId, { unreadOnly = false, limit = 20 } = {}) {
  let query = supabaseAdmin
    .from('notifications')
    .select(FIELDS)
    .eq('recipient_profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) query = query.is('read_at', null);

  const { data, error } = await query;
  if (error) throw wrapDbError('Failed to list notifications', error);
  return data || [];
}

async function unreadCountForProfile(profileId) {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_profile_id', profileId)
    .is('read_at', null);

  if (error) throw wrapDbError('Failed to count unread notifications', error);
  return count || 0;
}

// Scoped by recipient_profile_id in the WHERE clause so one profile can
// never mark another's notification read. Idempotent: marking an
// already-read notification read again is a success, not an error.
async function markRead(profileId, id) {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('recipient_profile_id', profileId)
    .is('read_at', null)
    .select(FIELDS)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') {
      throw new NotificationError('NOTIFICATION_NOT_FOUND', 404, 'This notification could not be found.');
    }
    throw wrapDbError('Failed to mark notification read', error);
  }
  if (data) return data;

  // No row matched the read_at IS NULL guard — re-check ownership (still
  // scoped to profileId) to tell "already read" (success) apart from
  // "someone else's / doesn't exist" (404), without leaking existence.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('notifications')
    .select(FIELDS)
    .eq('id', id)
    .eq('recipient_profile_id', profileId)
    .maybeSingle();

  if (existingError) throw wrapDbError('Failed to load notification', existingError);
  if (!existing) {
    throw new NotificationError('NOTIFICATION_NOT_FOUND', 404, 'This notification could not be found.');
  }
  return existing;
}

module.exports = {
  createMany,
  listForProfile,
  unreadCountForProfile,
  markRead,
  notifyInterviewScheduled,
  notifyInterviewCancelled,
  dispatchInBackground,
  NotificationError,
};
