// Public, browser-safe configuration. The Supabase anon key is designed to
// be exposed to the client — access is enforced by RLS, not by keeping this
// secret. Never put the service-role key here.

const SUPABASE_ANON_KEY = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkcnJ6enl2c3hkZ2xqaHVibGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDEwNjYsImV4cCI6MjEwMzM3NzA2Nn0',
  'zssgbNHF9ZCSEXZxynIlqUEQZFAWfkCHtXdyzO5HqK4',
].join('.');

export const APP_CONFIG = {
  SUPABASE_URL: 'https://adrrzzyvsxdgljhubldb.supabase.co',
  SUPABASE_ANON_KEY,
  API_BASE_URL: 'http://localhost:5000/api',

  // Max CV upload size shown to applicants and enforced client-side (PB-03).
  // The backend re-enforces this — keep it in sync with CV_MAX_BYTES there
  // (backend/src/config/applicationOptions.js) and the storage bucket limit.
  MAX_CV_MB: 5,
};
