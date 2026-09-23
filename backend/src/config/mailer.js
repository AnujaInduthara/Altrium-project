require('dotenv').config();
const nodemailer = require('nodemailer');

const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD, EMAIL_FROM } = process.env;

const configured = Boolean(EMAIL_HOST && EMAIL_USER && EMAIL_PASSWORD);

if (!configured) {
  console.warn(
    'Email is not configured. Set EMAIL_HOST, EMAIL_USER and EMAIL_PASSWORD in backend/.env — ' +
      'notifications will still be recorded in-app, but no email will be sent (see notification.transport.js).'
  );
}

// Left null when unconfigured so an incomplete .env never touches nodemailer
// at require-time — mirrors supabase.js's placeholder-client approach, except
// here the "placeholder" is simply "don't send" rather than a fake client.
const transporter = configured
  ? nodemailer.createTransport({
      host: EMAIL_HOST,
      port: Number(EMAIL_PORT) || 587,
      secure: Number(EMAIL_PORT) === 465,
      auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
    })
  : null;

const fromAddress = EMAIL_FROM || EMAIL_USER;

module.exports = { transporter, configured, fromAddress };
