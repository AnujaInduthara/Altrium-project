// Candidate-facing API. Wraps the caller's own scheduled interview(s).
// Attaches the current Supabase access token. No DOM access.

import { APP_CONFIG } from '../config.js';
import { supabaseClient } from '../lib/supabaseClient.js';

async function authHeaders(extra = {}) {
  const { data } = await supabaseClient.auth.getSession();
  const token = data.session?.access_token;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function toResult(response) {
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const apiBase = APP_CONFIG.API_BASE_URL;

export const CandidateService = {
  // The caller's own scheduled interview(s) — never another candidate's.
  async listMyInterviews() {
    const response = await fetch(`${apiBase}/candidate/interviews`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
