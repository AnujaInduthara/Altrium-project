// Public, browser-safe configuration. The Supabase anon key is designed to
// be exposed to the client — access is enforced by RLS, not by keeping this
// secret. Never put the service-role key here.

const SUPABASE_ANON_KEY = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkcnJ6enl2c3hkZ2xqaHVibGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDEwNjYsImV4cCI6MjEwMzM3NzA2Nn0',
  'zssgbNHF9ZCSEXZxynIlqUEQZFAWfkCHtXdyzO5HqK4',
].join('.');

// Where the backend API lives.
//
// By default the API is assumed to run on the SAME host that served this page,
// on port 5000 — so the app works whether you open it as http://localhost:5500,
// http://127.0.0.1:5500 or http://<your-lan-ip>:5500, with no per-machine
// edits. That is what makes the project run on any laptop out of the box.
//
// Overrides, in priority order:
//   1. window.__ALTRIUM_API_BASE__  — set it in a <script> before the app loads
//   2. ?apiBase=<url> in the page URL (persisted to localStorage for later)
//   3. a hardcoded full URL below (uncomment for a fixed deployment)
const API_BASE_URL = resolveApiBaseUrl();

function resolveApiBaseUrl() {
  // 1 & 2: explicit override
  try {
    if (typeof window !== 'undefined') {
      if (window.__ALTRIUM_API_BASE__) {
        return trimTrailingSlash(String(window.__ALTRIUM_API_BASE__));
      }
      const fromQuery = new URLSearchParams(window.location.search).get('apiBase');
      if (fromQuery) {
        window.localStorage.setItem('altrium.apiBase', fromQuery);
        return trimTrailingSlash(fromQuery);
      }
      const stored = window.localStorage.getItem('altrium.apiBase');
      if (stored) return trimTrailingSlash(stored);
    }
  } catch (err) {
    /* localStorage can throw in privacy mode — fall through to the default */
  }

  // 3: same host as the frontend, port 5000
  if (
    typeof window !== 'undefined' &&
    window.location &&
    /^https?:$/.test(window.location.protocol)
  ) {
    return `${window.location.protocol}//${window.location.hostname}:5000/api`;
  }

  return 'http://localhost:5000/api';
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
