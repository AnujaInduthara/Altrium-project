// Public (unauthenticated) vacancy lookup + application submission, used by the
// /apply page. No token, no Supabase client — this is what an applicant's
// browser can see. All privileged work happens behind the backend.

import { APP_CONFIG } from '../config.js';

const publicBase = `${APP_CONFIG.API_BASE_URL}/public/vacancies`;

async function toResult(response) {
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

export async function fetchPublicVacancy(token) {
  const response = await fetch(`${publicBase}/${encodeURIComponent(token)}`);
  return toResult(response);
}

// formData: a FormData with full_name, email, phone, location and the `cv` file.
// The browser sets the multipart Content-Type (and boundary) itself.
export async function submitApplication(token, formData) {
  const response = await fetch(
    `${publicBase}/${encodeURIComponent(token)}/applications`,
    { method: 'POST', body: formData }
  );
  return toResult(response);
}
