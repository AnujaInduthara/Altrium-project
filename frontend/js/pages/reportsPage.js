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

function buildTableCell(value) {
  const td = document.createElement('td');
  td.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  return td;
}

function buildReportTableRow(row) {
  const tr = document.createElement('tr');
  tr.append(
    buildTableCell(row.job_title),
    buildTableCell(row.department),
    buildTableCell(row.applications),
    buildTableCell(row.ai_shortlisted),
    buildTableCell(row.hr_selected),
    buildTableCell(row.interviews_completed),
    buildTableCell(row.hired),
    buildTableCell(row.rejected)
  );
  return tr;
}

function renderReportTable({ totals, by_vacancy } = {}) {
  const rows = by_vacancy || [];
  $('reports-table-body').replaceChildren(...rows.map(buildReportTableRow));
  $('reports-table-empty').hidden = rows.length > 0;

  $('reports-table-totals').replaceChildren(
    buildTableCell('Total'),
    buildTableCell(''),
    buildTableCell(totals?.applications ?? 0),
    buildTableCell(totals?.ai_shortlisted ?? 0),
    buildTableCell(totals?.hr_selected ?? 0),
    buildTableCell(totals?.interviews_completed ?? 0),
    buildTableCell(totals?.hired ?? 0),
    buildTableCell(totals?.rejected ?? 0)
  );
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
    const [pipelineResult, reportResult] = await Promise.all([
      ReportingService.getPipeline(filters),
      ReportingService.getRecruitmentReport(filters),
    ]);

    if (pipelineResult.status === 401 || reportResult.status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    loadingEl.hidden = true;

    if (!pipelineResult.ok) {
      errorEl.hidden = false;
      $('reports-error-message').textContent =
        pipelineResult.body?.error?.message || 'Please check your connection and try again.';
      return;
    }

    const { range, funnel, cards } = pipelineResult.body?.data || {};
    if (range) {
      $('reports-from').value = range.from || '';
      $('reports-to').value = range.to || '';
    }
    renderCards(cards);
    renderFunnel(funnel);
    renderReportTable(reportResult.ok ? reportResult.body?.data : {});
    contentEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    $('reports-error-message').textContent = 'Please check your connection and try again.';
  }
}

async function downloadCsv() {
  const button = $('reports-download-csv');
  const label = button.querySelector('[data-label]');
  const original = label.textContent;
  button.disabled = true;
  label.textContent = 'Preparing…';

  try {
    const result = await ReportingService.downloadRecruitmentCsv(currentFilters());

    if (result.status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!result.ok) {
      alert.error(result.body?.error?.message || 'Unable to download the report. Please try again.');
      return;
    }

    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    alert.hide();
  } catch (err) {
    alert.error('Unable to download the report. Please check your connection and try again.');
  } finally {
    button.disabled = false;
    label.textContent = original;
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
$('reports-download-csv').addEventListener('click', downloadCsv);

document.addEventListener('DOMContentLoaded', init);
