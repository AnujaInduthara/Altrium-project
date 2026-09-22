// PB-15/PB-16 scheduling API. Wraps /api/interview-stages/:stageId/schedule,
// /api/interviews/:id/cancel and /api/interviews. Same bearer-token / result
// shape as every other authenticated service. No DOM access.

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

export const InterviewService = {
  // Schedules an interview for one configured stage. end_time is derived
  // server-side from the stage's own duration — never sent here.
  async schedule(stageId, { scheduled_date, start_time, interviewer_ids }) {
    const response = await fetch(`${apiBase}/interview-stages/${encodeURIComponent(stageId)}/schedule`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ scheduled_date, start_time, interviewer_ids }),
    });
    return toResult(response);
  },

  async cancel(interviewId) {
    const response = await fetch(`${apiBase}/interviews/${encodeURIComponent(interviewId)}/cancel`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    return toResult(response);
  },

  // list({ vacancy_id, from, to }) — omit vacancy_id for every vacancy the
  // caller owns.
  async list({ vacancy_id, from, to } = {}) {
    const params = new URLSearchParams();
    if (vacancy_id) params.set('vacancy_id', vacancy_id);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    const response = await fetch(`${apiBase}/interviews${qs ? `?${qs}` : ''}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
