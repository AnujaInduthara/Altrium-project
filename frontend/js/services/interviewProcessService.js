// Interview process API (PB-09..PB-12). Wraps the backend
// /api/applications/:id/interview-process endpoints and attaches the current
// Supabase access token. No DOM access — page controllers own the UI.

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

function base(applicationId) {
  return `${APP_CONFIG.API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/interview-process`;
}

export const InterviewProcessService = {
  // { process: null } when the candidate doesn't have one yet.
  async get(applicationId) {
    const response = await fetch(base(applicationId), { headers: await authHeaders() });
    return toResult(response);
  },

  // Creates the process and copies the matching default stages.
  async create(applicationId, { interview_level }) {
    const response = await fetch(base(applicationId), {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ interview_level }),
    });
    return toResult(response);
  },

  // Full replacement of the ordered stage list in one call.
  async replaceStages(applicationId, { stages }) {
    const response = await fetch(`${base(applicationId)}/stages`, {
      method: 'PUT',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ stages }),
    });
    return toResult(response);
  },

  async cancel(applicationId) {
    const response = await fetch(base(applicationId), {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
