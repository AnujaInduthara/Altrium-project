// HR application-review API. Wraps the backend endpoints for listing the
// applications submitted to a vacancy and getting a short-lived CV link.
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

export const ApplicationService = {
  // Applications for one of the caller's own vacancies, newest first.
  async listForVacancy(vacancyId) {
    const response = await fetch(
      `${apiBase}/vacancies/${encodeURIComponent(vacancyId)}/applications`,
      { headers: await authHeaders() }
    );
    return toResult(response);
  },

  // Short-lived signed URL for an application's CV (owner-checked server-side).
  async getCvLink(applicationId) {
    const response = await fetch(
      `${apiBase}/applications/${encodeURIComponent(applicationId)}/cv`,
      { headers: await authHeaders() }
    );
    return toResult(response);
  },

  // PB-05: the AI screening result for one application (owner-checked).
  async getScreening(applicationId) {
    const response = await fetch(
      `${apiBase}/applications/${encodeURIComponent(applicationId)}/screening`,
      { headers: await authHeaders() }
    );
    return toResult(response);
  },

  // PB-05: HR-authorized (re)run of one application's screening — failed,
  // still-pending, or a completed one to re-run.
  async retryScreening(applicationId) {
    const response = await fetch(
      `${apiBase}/applications/${encodeURIComponent(applicationId)}/screening/retry`,
      { method: 'POST', headers: await authHeaders() }
    );
    return toResult(response);
  },

  // PB-05: bulk (re)run for a vacancy — queues every application whose screening
  // has not completed (pending / failed / not started).
  async runPendingScreenings(vacancyId) {
    const response = await fetch(
      `${apiBase}/vacancies/${encodeURIComponent(vacancyId)}/screenings/run-pending`,
      { method: 'POST', headers: await authHeaders() }
    );
    return toResult(response);
  },
};
