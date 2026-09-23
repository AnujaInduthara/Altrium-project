require('dotenv').config();

const { RESEND_API_KEY, EMAIL_FROM } = process.env;

const configured = Boolean(RESEND_API_KEY);

if (!configured) {
  console.warn(
    'Email is not configured. Set RESEND_API_KEY (and optionally EMAIL_FROM) in backend/.env — ' +
      'notifications will still be recorded in-app, but no email will be sent (see notification.transport.js).'
  );
}

const fromAddress = EMAIL_FROM || 'onboarding@resend.dev';

// Resend's HTTP API, not SMTP: most PaaS hosts (Render included) block
// outbound SMTP ports (25/465/587) as an anti-abuse measure, so a
// nodemailer/SMTP transport times out in production even with correct
// credentials — HTTPS is never blocked, so the send has to go over that.
async function send({ to, subject, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddress, to, subject, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }

  return response.json();
}

module.exports = { send, configured, fromAddress };
