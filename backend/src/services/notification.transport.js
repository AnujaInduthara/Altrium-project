const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');

// Short, non-reversible identifier for a log line — never the recipient
// value itself.
function hashRecipient(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

// The single seam every notification goes through. Today: persist the row
// (always — it's what powers the in-app bell) and, for an email-addressed
// recipient, log an intent line carrying no PII (never the title/body/
// payload — just the type and a recipient hash, enough to trace delivery).
// An email provider (SES, Postmark, SendGrid, ...) plugs in here later by
// adding a real send call after the insert, without any call site changing.
async function deliver(notification) {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      recipient_profile_id: notification.recipient_profile_id || null,
      recipient_email: notification.recipient_email || null,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      payload: notification.payload || {},
    })
    .select('id')
    .single();

  if (error) throw wrapDbError('Failed to persist notification', error);

  if (notification.recipient_email) {
    console.log(
      `[notification] would email "${notification.type}" to recipient ${hashRecipient(notification.recipient_email)}`
    );
  }

  return data;
}

module.exports = { deliver };
