// PB-20 — Hiring Manager pipeline API. Wraps /api/hiring/candidates. Same
// bearer-token / result shape as every other authenticated service. No DOM
// access.

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

export const HiringService = {
  // list({ vacancy_id, status }) — every candidate with an interview process,
  // ranked decision-pending-first, then by average interview rating, then AI
  // score. Omit either filter to see everyone.
  async list({ vacancy_id, status } = {}) {
    const params = new URLSearchParams();
    if (vacancy_id) params.set('vacancy_id', vacancy_id);
    if (status) params.set('status', status);
    const qs = params.toString();
    const response = await fetch(`${apiBase}/hiring/candidates${qs ? `?${qs}` : ''}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },

  // Full detail for one candidate: every stage, each interviewer's feedback,
  // and the AI screening summary.
  async getCandidate(applicationId) {
    const response = await fetch(`${apiBase}/hiring/candidates/${encodeURIComponent(applicationId)}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },

  // Short-lived signed URL for a candidate's CV (pipeline-membership checked
  // server-side). Pass { download: true } to force a "save as".
  async getCvLink(applicationId, { download = false } = {}) {
    const query = download ? '?download=1' : '';
    const response = await fetch(
      `${apiBase}/hiring/candidates/${encodeURIComponent(applicationId)}/cv${query}`,
      { headers: await authHeaders() }
    );
    return toResult(response);
  },

  // PB-21 — record the final Hire/Reject decision. One per candidate, ever —
  // a second call returns 409 DECISION_EXISTS. `acknowledge_incomplete` +
  // a non-blank `reason` are required when any interview stage isn't yet
  // completed/skipped, else the server returns 409 STAGES_INCOMPLETE.
  async decide(applicationId, { decision, reason, acknowledge_incomplete } = {}) {
    const response = await fetch(
      `${apiBase}/hiring/candidates/${encodeURIComponent(applicationId)}/decision`,
      {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ decision, reason, acknowledge_incomplete }),
      }
    );
    return toResult(response);
  },
};
