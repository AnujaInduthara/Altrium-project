// Public, browser-safe configuration. The Supabase anon key is designed to
// be exposed to the client — access is enforced by RLS, not by keeping this
// secret. Never put the service-role key here.

const SUPABASE_ANON_KEY = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkcnJ6enl2c3hkZ2xqaHVibGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDEwNjYsImV4cCI6MjEwMzM3NzA2Nn0',
  'zssgbNHF9ZCSEXZxynIlqUEQZFAWfkCHtXdyzO5HqK4',
].join('.');

// The deployed backend. Used automatically whenever the site is served from a
// non-local hostname (e.g. the Netlify domain). Override per-deployment with
// window.__ALTRIUM_API_BASE__ or ?apiBase= (see below).
const PRODUCTION_API_BASE_URL = 'https://altrium-project.onrender.com/api';

// Where the backend API lives.
//
// When the page is served locally (localhost / 127.0.0.1 / a private-LAN IP)
// the API is assumed to run on the SAME host, port 5000 — so the app works
// whether you open it as http://localhost:5500, http://127.0.0.1:5500 or
// http://<your-lan-ip>:5500, with no per-machine edits. When the page is
// served from anywhere else, PRODUCTION_API_BASE_URL above is used.
//
// Overrides, in priority order:
//   1. window.__ALTRIUM_API_BASE__  — set it in a <script> before the app loads
//   2. ?apiBase=<url> in the page URL (persisted to localStorage for later).
//      Use ?apiBase=  (empty), ?apiBase=reset or ?apiBase=default to CLEAR a
//      previously-remembered override and go back to the default below.
//   3. a hardcoded full URL below (uncomment for a fixed deployment)
const API_BASE_URL = resolveApiBaseUrl();

function resolveApiBaseUrl() {
  const resolved = normalizeApiBase(pickRawApiBase());
  try {
    // Make it obvious in DevTools which backend the app is talking to — a stale
    // remembered ?apiBase= is the usual cause of "Resource not found." errors.
    console.info(`[Altrium] API base: ${resolved}`);
  } catch (err) {
    /* no console — ignore */
  }
  return resolved;
}

function pickRawApiBase() {
  // 1 & 2: explicit override
  try {
    if (typeof window !== 'undefined') {
      if (window.__ALTRIUM_API_BASE__) {
        return String(window.__ALTRIUM_API_BASE__);
      }
      const params = new URLSearchParams(window.location.search);
      if (params.has('apiBase')) {
        const fromQuery = params.get('apiBase').trim();
        // An empty / "reset" / "default" value forgets a stuck override.
        if (!fromQuery || /^(reset|default)$/i.test(fromQuery)) {
          window.localStorage.removeItem('altrium.apiBase');
        } else {
          window.localStorage.setItem('altrium.apiBase', fromQuery);
          return fromQuery;
        }
      }
      const stored = window.localStorage.getItem('altrium.apiBase');
      if (stored) return stored;
    }
  } catch (err) {
    /* localStorage can throw in privacy mode — fall through to the default */
  }

  // 3: no explicit override — decide from where the page is being served.
  if (
    typeof window !== 'undefined' &&
    window.location &&
    /^https?:$/.test(window.location.protocol)
  ) {
    // Local dev: talk to the backend on the same host, port 5000.
    if (isLocalHostname(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    // Deployed (Netlify, a custom domain, …): use the hosted backend.
    return PRODUCTION_API_BASE_URL;
  }

  return 'http://localhost:5000/api';
}

// True for localhost, loopback and RFC-1918 private-LAN addresses — i.e. the
// app is being run from a laptop rather than a public deployment.
function isLocalHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    /^10(?:\.\d{1,3}){3}$/.test(hostname) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(hostname)
  );
}

// Trim trailing slashes and, if the URL has no path at all, add the `/api`
// mount point — "http://host:5000" is a common mistake that otherwise 404s
// every request as "Resource not found.".
function normalizeApiBase(value) {
  const trimmed = trimTrailingSlash(String(value || '').trim());
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') {
      return `${trimTrailingSlash(url.origin)}/api`;
    }
  } catch (err) {
    /* not an absolute URL — leave it as-is */
  }
  return trimmed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

export const APP_CONFIG = {
  SUPABASE_URL: 'https://adrrzzyvsxdgljhubldb.supabase.co',
  SUPABASE_ANON_KEY,
  API_BASE_URL,

  // Max CV upload size shown to applicants and enforced client-side (PB-03).
  // The backend re-enforces this — keep it in sync with CV_MAX_BYTES there
  // (backend/src/config/applicationOptions.js) and the storage bucket limit.
  MAX_CV_MB: 5,
};
