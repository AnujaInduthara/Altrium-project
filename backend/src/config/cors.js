require('dotenv').config();

const { APP_URL } = require('./app');

// ---------------------------------------------------------------------------
// Which browser origins may call this API.
//
// The goal is "clone it, run it, it works" on any laptop — without editing a
// hard-coded LAN IP. So we allow:
//
//   1. Any origin explicitly configured for this deployment, via
//      FRONTEND_URL / APP_URL / CORS_ORIGINS (each may be a comma-separated
//      list of full origins, e.g. "https://recruit.example.com").
//   2. Any localhost / loopback origin on any port.
//   3. Any private-LAN IPv4 origin on any port
//      (10.x.x.x, 172.16-31.x.x, 192.168.x.x) — this covers the static
//      frontend being served from the machine's own network address, and
//      being opened from another device on the same network.
//
// Set CORS_ALLOW_ANY=true to skip 2 & 3 and reflect every origin (only do this
// behind a trusted proxy that already restricts access). Set nothing for the
// normal local-development / small-deployment case.
// ---------------------------------------------------------------------------

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Known deployed frontend origin(s). Kept here as a safe default so production
// keeps working even if CORS_ORIGINS is not set in the host's environment.
// Add custom domains / other sites via CORS_ORIGINS.
const DEPLOYED_FRONTEND_ORIGINS = ['https://resilient-khapse-fd139a.netlify.app'];

const configuredOrigins = new Set([
  APP_URL,
  ...DEPLOYED_FRONTEND_ORIGINS,
  ...splitList(process.env.FRONTEND_URL),
  ...splitList(process.env.APP_URL),
  ...splitList(process.env.CORS_ORIGINS),
]);

// Netlify preview / branch deploys for the site above, e.g.
// https://deploy-preview-12--resilient-khapse-fd139a.netlify.app
const NETLIFY_PREVIEW_RE =
  /^https:\/\/[a-z0-9-]+--resilient-khapse-fd139a\.netlify\.app$/;

const ALLOW_ANY = String(process.env.CORS_ALLOW_ANY).toLowerCase() === 'true';

// localhost, 127.0.0.0/8, [::1], and RFC-1918 private IPv4 ranges, any port.
const LOCAL_ORIGIN_RE = new RegExp(
  '^https?://(' +
    'localhost|' +
    '127(?:\\.\\d{1,3}){3}|' +
    '\\[::1\\]|' +
    '10(?:\\.\\d{1,3}){3}|' +
    '192\\.168(?:\\.\\d{1,3}){2}|' +
    '172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2}' +
    ')(?::\\d+)?$'
);

function isAllowedOrigin(origin) {
  // No Origin header: same-origin navigation, curl, server-to-server. Nothing
  // for CORS to protect — allow it.
  if (!origin) return true;
  if (ALLOW_ANY) return true;

  const normalized = origin.replace(/\/+$/, '');
  if (configuredOrigins.has(normalized)) return true;
  if (NETLIFY_PREVIEW_RE.test(normalized)) return true;
  return LOCAL_ORIGIN_RE.test(normalized);
}

module.exports = { isAllowedOrigin, LOCAL_ORIGIN_RE };
