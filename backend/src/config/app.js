require('dotenv').config();

// Known deployed frontend origin — a safe last-resort default (mirrors
// cors.js's DEPLOYED_FRONTEND_ORIGINS) so a production host that forgot to
// set APP_URL/FRONTEND_URL still points real links at the live site instead
// of a local dev address. This matters most for candidateAccount.service.js's
// invite link: it's built from a background job with no request/Origin to
// fall back on, so this constant is the only thing standing between a
// misconfigured deploy and a candidate invite email linking to localhost.
const DEPLOYED_FRONTEND_URL = 'https://resilient-khapse-fd139a.netlify.app';

// Public base URL where the static frontend is served. The published-vacancy
// application link falls back to this when a request carries no Origin header.
// Priority: APP_URL, then FRONTEND_URL (same origin in the usual local
// setup), then the known deployed frontend above. Set APP_URL or
// FRONTEND_URL in backend/.env — as backend/.env.example already does for
// local development (http://127.0.0.1:5500) — to override for any other
// deployment.
const APP_URL = (
  process.env.APP_URL ||
  process.env.FRONTEND_URL ||
  DEPLOYED_FRONTEND_URL
).replace(/\/+$/, '');

// The stable public application link for a published vacancy.
//
// `baseUrl` is normally the Origin of the HR user's browser (passed through
// from the API request) so the copied link points at whatever host they are
// actually using — localhost, 127.0.0.1, or a LAN IP — with no configuration.
// It falls back to APP_URL for requests without an Origin header.
//
// The token goes in the URL hash (not the query string) so it survives the
// `apply.html` -> `apply` redirect that "clean URL" static servers perform,
// which would otherwise strip a `?token=...`.
function buildPublicApplyUrl(publicToken, baseUrl) {
  const base = (baseUrl || APP_URL).replace(/\/+$/, '');
  return `${base}/apply.html#token=${encodeURIComponent(publicToken)}`;
}

module.exports = { APP_URL, buildPublicApplyUrl };
