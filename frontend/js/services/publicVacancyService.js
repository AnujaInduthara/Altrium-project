// Public (unauthenticated) vacancy lookup, used by the /apply page. No token,
// no Supabase client — this is what an applicant's browser can see.

import { APP_CONFIG } from '../config.js';

export async function fetchPublicVacancy(token) {
  const response = await fetch(
    `${APP_CONFIG.API_BASE_URL}/public/vacancies/${encodeURIComponent(token)}`
  );
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}
