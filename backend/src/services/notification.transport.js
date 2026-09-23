const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const mailer = require('../config/mailer');

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

// The single seam every notification goes through. Always persists the row
// first (it's what powers the in-app bell — the source of truth), then, for
// an email-addressed recipient, sends the email via the SMTP transport
// configured in config/mailer.js. A send failure is logged (with no PII —
// just the type and a recipient hash) but never thrown: the in-app
// notification already succeeded, and email here is best-effort on top of it.
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
    if (mailer.configured) {
      try {
        await mailer.transporter.sendMail({
          from: mailer.fromAddress,
          to: notification.recipient_email,
          subject: notification.title,
          text: notification.body,
        });
      } catch (sendError) {
        console.error(
          `[notification] failed to email "${notification.type}" to recipient ${hashRecipient(notification.recipient_email)}:`,
          sendError.message
        );
      }
    } else {
      console.log(
        `[notification] email not configured — would email "${notification.type}" to recipient ${hashRecipient(notification.recipient_email)}`
      );
    }
  }

  return data;
}

module.exports = { deliver };
