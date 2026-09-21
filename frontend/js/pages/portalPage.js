// Public Applicant Portal controller (PB-02/PB-03). Lists currently
// published vacancies, unauthenticated, and links each one to the apply
// form. No Supabase, no auth, no app shell — mirrors applyPage.js.

import { fetchPublicVacancies } from '../services/publicVacancyService.js';
import { withHashParam } from '../utils/urlParams.js';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 300;
const FETCH_LIMIT = 50;

const els = {
  loading: $('portal-loading'),
  empty: $('portal-empty'),
  error: $('portal-error'),
  retry: $('portal-retry'),
  list: $('portal-list'),
  search: $('portal-search'),
  department: $('portal-department'),
};

let departmentOptionsPopulated = false;
let debounceTimer = null;
let requestSeq = 0;

function showOnly(...visible) {
  const all = [els.loading, els.empty, els.error, els.list];
  for (const el of all) el.hidden = !visible.includes(el);
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function populateDepartments(vacancies) {
  if (departmentOptionsPopulated) return;
  departmentOptionsPopulated = true;

  const departments = Array.from(
    new Set(vacancies.map((v) => v.department).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const fragment = document.createDocumentFragment();
  for (const department of departments) {
    const option = document.createElement('option');
    option.value = department;
    option.textContent = department;
    fragment.appendChild(option);
  }
  els.department.appendChild(fragment);
}

function renderCard(vacancy) {
  const li = document.createElement('li');

  const card = document.createElement('a');
  card.className = 'card portal-card';
  card.href = withHashParam('apply.html', 'token', vacancy.public_token);

  const title = document.createElement('h2');
  title.className = 'portal-card__title';
  title.textContent = vacancy.job_title;

  const positions = Number(vacancy.number_of_positions);
  const meta = document.createElement('p');
  meta.className = 'portal-card__meta';
  meta.textContent = [
    vacancy.department,
    vacancy.location,
    vacancy.employment_type,
    vacancy.experience_level,
    Number.isFinite(positions) && positions > 0
      ? `${positions} position${positions === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const footer = document.createElement('div');
  footer.className = 'portal-card__footer';

  const posted = document.createElement('span');
  posted.className = 'portal-card__date';
  posted.textContent = vacancy.published_at ? `Posted ${formatDate(vacancy.published_at)}` : '';

  const cta = document.createElement('span');
  cta.className = 'portal-card__cta';
  cta.textContent = 'View & apply →';

  footer.append(posted, cta);
  card.append(title, meta, footer);
  li.append(card);
  return li;
}

function renderList(vacancies) {
  els.list.replaceChildren(...vacancies.map(renderCard));
  showOnly(els.list);
}

function showEmpty() {
  showOnly(els.empty);
}

function showError() {
  showOnly(els.error);
}

async function loadVacancies() {
  const seq = ++requestSeq;
  showOnly(els.loading);

  const params = {
    q: els.search.value.trim(),
    department: els.department.value,
    limit: FETCH_LIMIT,
    offset: 0,
  };

  try {
    const { ok, body } = await fetchPublicVacancies(params);
    if (seq !== requestSeq) return; // a newer request has already superseded this one

    if (!ok || !body || !body.data) {
      showError();
      return;
    }

    const vacancies = body.data.vacancies || [];
    populateDepartments(vacancies);

    if (vacancies.length === 0) {
      showEmpty();
      return;
    }

    renderList(vacancies);
  } catch (err) {
    if (seq !== requestSeq) return;
    showError();
  }
}

function onFilterInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadVacancies, DEBOUNCE_MS);
}

function onDepartmentChange() {
  clearTimeout(debounceTimer);
  loadVacancies();
}

function wire() {
  els.search.addEventListener('input', onFilterInput);
  els.department.addEventListener('change', onDepartmentChange);
  els.retry.addEventListener('click', loadVacancies);
}

document.addEventListener('DOMContentLoaded', () => {
  wire();
  loadVacancies();
});
