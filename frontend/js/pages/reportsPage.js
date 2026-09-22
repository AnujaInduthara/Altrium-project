// Reports page (PB-23) — the recruitment pipeline funnel + summary cards, for
// 'hr' (scoped to their own vacancies) and 'management' (everything). No
// charting library: bars are CSS-width divs driven by percentages already
// computed server-side; every figure is also rendered as text, plus a
// visually-hidden table equivalent for screen readers.

import { AuthService } from '../services/authService.js';
import { ReportingService } from '../services/reportingService.js';
import { VacancyService } from '../services/vacancyService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['hr', 'management'];

const CARD_DEFS = [
  { key: 'open_vacancies', label: 'Open Vacancies' },
  { key: 'applications', label: 'Applications' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
];

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'reports',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const $ = (id) => document.getElementById(id);

const page = $('reports-page');
const alert = createAlert($('reports-alert'));
const loadingEl = $('reports-loading');
const errorEl = $('reports-error');
const contentEl = $('reports-content');
const cardTemplate = $('reports-card-template');
const funnelRowTemplate = $('reports-funnel-row-template');
const vacancyField = $('reports-vacancy-field');
const vacancyFilter = $('reports-vacancy-filter');

function buildCard({ label, value }) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('[data-label]').textContent = label;
  node.querySelector('[data-value]').textContent = String(value);
  return node;
}

function renderCards(cards = {}) {
  $('reports-cards').replaceChildren(
    ...CARD_DEFS.map((def) => buildCard({ label: def.label, value: cards[def.key] ?? 0 }))
  );
}

function buildFunnelRow(row) {
  const node = funnelRowTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('[data-label]').textContent = row.label;
  node.querySelector('[data-count]').textContent = `${row.count} (${row.percentage}%)`;
  node.querySelector('[data-fill]').style.width = `${row.percentage}%`;
  return node;
}

function buildFunnelTableRow(row) {
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = row.label;
  const tdCount = document.createElement('td');
  tdCount.textContent = String(row.count);
  const tdPercentage = document.createElement('td');
  tdPercentage.textContent = `${row.percentage}%`;
  tr.append(th, tdCount, tdPercentage);
  return tr;
}

function renderFunnel(funnel = []) {
  $('reports-funnel').replaceChildren(...funnel.map(buildFunnelRow));
  $('reports-funnel-table-body').replaceChildren(...funnel.map(buildFunnelTableRow));
}

async function populateVacancyFilter() {
  try {
    const { ok, body } = await VacancyService.list();
    if (!ok) return;
    const vacancies = body?.data?.vacancies || [];
    for (const vacancy of vacancies) {
      const option = document.createElement('option');
      option.value = vacancy.id;
      option.textContent = vacancy.job_title;
      vacancyFilter.appendChild(option);
    }
    vacancyField.hidden = false;
  } catch (err) {
    // The vacancy filter is optional — leave it hidden if it can't be loaded.
  }
}

function currentFilters() {
  return {
    from: $('reports-from').value || undefined,
    to: $('reports-to').value || undefined,
    vacancy_id: vacancyFilter.value || undefined,
  };
}

async function loadReport(filters = currentFilters()) {
  loadingEl.hidden = false;
  errorEl.hidden = true;
  contentEl.hidden = true;
  alert.hide();

  try {
    const { ok, status, body } = await ReportingService.getPipeline(filters);

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    loadingEl.hidden = true;

    if (!ok) {
      errorEl.hidden = false;
      $('reports-error-message').textContent = body?.error?.message || 'Please check your connection and try again.';
      return;
    }

    const { range, funnel, cards } = body?.data || {};
    if (range) {
      $('reports-from').value = range.from || '';
      $('reports-to').value = range.to || '';
    }
    renderCards(cards);
    renderFunnel(funnel);
    contentEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    $('reports-error-message').textContent = 'Please check your connection and try again.';
  }
}

async function init() {
  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email, role: result.profile.role });
  page.hidden = false;

  // Management has no "list all vacancies" endpoint (vacancy listing stays
  // HR-owner-scoped elsewhere in the app) — the vacancy filter is only
  // offered where it can actually be populated.
  if (result.profile.role === 'hr') {
    await populateVacancyFilter();
  }

  // No filters on first load: the server resolves and returns the default
  // last-90-days range, which loadReport() then reflects into the inputs.
  await loadReport({});
}

$('reports-toolbar').addEventListener('submit', (event) => {
  event.preventDefault();
  loadReport();
});

$('reports-retry').addEventListener('click', () => loadReport());

document.addEventListener('DOMContentLoaded', init);
