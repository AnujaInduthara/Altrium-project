// PB-23/PB-24 — recruitment reporting API. Wraps /api/reports/pipeline and
// /api/reports/recruitment. Same bearer-token / result shape as every other
// authenticated service (except downloadRecruitmentCsv, which returns a Blob
// instead of a JSON body). No DOM access.

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

function buildParams({ from, to, vacancy_id } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (vacancy_id) params.set('vacancy_id', vacancy_id);
  return params;
}

const apiBase = APP_CONFIG.API_BASE_URL;

export const ReportingService = {
  // getPipeline({ from, to, vacancy_id }) — every filter is optional; the
  // server defaults the date range to the last 90 days. Scoped server-side:
  // 'hr' sees only their own vacancies, 'management' sees everything.
  async getPipeline(filters = {}) {
    const qs = buildParams(filters).toString();
    const response = await fetch(`${apiBase}/reports/pipeline${qs ? `?${qs}` : ''}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },

  // Period totals + a per-vacancy breakdown (PB-24). Same filters/scoping as
  // getPipeline.
  async getRecruitmentReport(filters = {}) {
    const qs = buildParams(filters).toString();
    const response = await fetch(`${apiBase}/reports/recruitment${qs ? `?${qs}` : ''}`, {
      headers: await authHeaders(),
    });
    return toResult(response);
  },

  // Same report as CSV. Needs the bearer token (so a plain <a href> download
  // can't be used) — fetches the file as a Blob for the caller to save via a
  // temporary object URL. Returns { ok, status, blob, filename } on success,
  // or { ok: false, status, body } (parsed as JSON) on failure.
  async downloadRecruitmentCsv(filters = {}) {
    const params = buildParams(filters);
    params.set('format', 'csv');
    const response = await fetch(`${apiBase}/reports/recruitment?${params.toString()}`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, status: response.status, body };
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"; ]+)"?/);
    const filename = match ? match[1] : 'recruitment-report.csv';
    const blob = await response.blob();
    return { ok: true, status: response.status, blob, filename };
  },
};
