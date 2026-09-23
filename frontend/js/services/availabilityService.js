// PB-13 availability API. Wraps the backend /api/availability endpoints and
// attaches the current Supabase access token. No DOM access — page
// controllers own the UI. Every call operates on the caller's own slots only.

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

const base = `${APP_CONFIG.API_BASE_URL}/availability`;

export const AvailabilityService = {
  async list({ from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    const response = await fetch(`${base}${qs ? `?${qs}` : ''}`, { headers: await authHeaders() });
    return toResult(response);
  },

  async create({ slot_date, start_time, end_time }) {
    const response = await fetch(base, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ slot_date, start_time, end_time }),
    });
    return toResult(response);
  },

  async remove(id) {
    const response = await fetch(`${base}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
