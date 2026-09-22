// PB-23 — recruitment pipeline reporting API. Wraps /api/reports/pipeline.
// Same bearer-token / result shape as every other authenticated service. No
// DOM access.

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

export const ReportingService = {
  // getPipeline({ from, to, vacancy_id }) — every filter is optional; the
  // server defaults the date range to the last 90 days. Scoped server-side:
  // 'hr' sees only their own vacancies, 'management' sees everything.
  async getPipeline({ from, to, vacancy_id } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (vacancy_id) params.set('vacancy_id', vacancy_id);
    const qs = params.toString();
    const response = await fetch(`${apiBase}/reports/pipeline${qs ? `?${qs}` : ''}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
