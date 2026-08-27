require('dotenv').config();

// Public base URL where the static frontend is served. The published-vacancy
// application link is built from this. Falls back to FRONTEND_URL (same origin
// in the usual local setup) and finally to a sensible local default.
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || 'http://127.0.0.1:5500')
  .replace(/\/+$/, '');

// The stable public application link for a published vacancy. PB-03 will make
// this page collect applications; for now it resolves the vacancy by token.
//
// The token goes in the URL hash (not the query string) so it survives the
// `apply.html` -> `apply` redirect that "clean URL" static servers perform,
// which would otherwise strip a `?token=...`.
function buildPublicApplyUrl(publicToken) {
  return `${APP_URL}/apply.html#token=${encodeURIComponent(publicToken)}`;
}

module.exports = { APP_URL, buildPublicApplyUrl };
