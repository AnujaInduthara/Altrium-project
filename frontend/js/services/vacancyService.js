// Vacancy API service. Wraps the backend /api/vacancies endpoints and attaches
// the current Supabase access token. No DOM access — page controllers own UI.

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

const base = `${APP_CONFIG.API_BASE_URL}/vacancies`;

export const VacancyService = {
  // payload: the eight vacancy fields. `status` / `created_by` are set by the
  // backend and must not be sent.
  async create(payload) {
    const response = await fetch(base, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return toResult(response);
  },

  async list() {
    const response = await fetch(base, { headers: await authHeaders() });
    return toResult(response);
  },

  async get(id) {
    const response = await fetch(`${base}/${encodeURIComponent(id)}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },

  // DRAFT -> PUBLISHED. No request body: the endpoint itself is the action.
  async publish(id) {
    const response = await fetch(`${base}/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
