require('dotenv').config();

// Public base URL where the static frontend is served. The published-vacancy
// application link falls back to this when a request carries no Origin header.
// Falls back to FRONTEND_URL (same origin in the usual local setup) and finally
// to a sensible local default.
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || 'http://127.0.0.1:5500')
  .replace(/\/+$/, '');

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
