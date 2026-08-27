// Public application page (PB-02 scope: resolve a published vacancy by its
// token and show it). No auth, no app shell. PB-03 will add the actual form.

import { fetchPublicVacancy } from '../services/publicVacancyService.js';
import { readParam } from '../utils/urlParams.js';

const $ = (id) => document.getElementById(id);

function showUnavailable() {
  $('apply-loading').hidden = true;
  $('apply-vacancy').hidden = true;
  $('apply-unavailable').hidden = false;
}

function render(vacancy) {
  document.title = `${vacancy.job_title} — Apply — Altrium`;
  $('apply-title').textContent = vacancy.job_title;
  $('apply-meta').textContent = [
    vacancy.department,
    vacancy.location,
    vacancy.employment_type,
    vacancy.experience_level,
    `${vacancy.number_of_positions} position${vacancy.number_of_positions === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join('  ·  ');
  $('apply-description').textContent = vacancy.job_description;

  const reqs = Array.isArray(vacancy.job_requirements) ? vacancy.job_requirements : [];
  $('apply-requirements').replaceChildren(
    ...reqs.map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    })
  );

  $('apply-loading').hidden = true;
  $('apply-unavailable').hidden = true;
  $('apply-vacancy').hidden = false;
}

async function init() {
  const token = readParam('token');
  if (!token) {
    showUnavailable();
    return;
  }

  try {
    const { ok, body } = await fetchPublicVacancy(token);
    if (ok && body?.data) {
      render(body.data);
    } else {
      showUnavailable();
    }
  } catch (err) {
    showUnavailable();
  }
}

document.addEventListener('DOMContentLoaded', init);
