// Dashboard page controller: mounts the shared app shell, enforces the
// protected route, wires sign-out, and shows the recruitment summary cards
// (PB-23) reusing the same /api/reports/pipeline endpoint as the Reports page.

import { AuthService } from '../services/authService.js';
import { ReportingService } from '../services/reportingService.js';
import { mountAppShell } from '../components/AppShell.js';

const LOGIN_PAGE = 'login.html';

const CARD_DEFS = [
  { key: 'open_vacancies', label: 'Open Vacancies' },
  { key: 'applications', label: 'Applications' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
];

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'dashboard',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

function buildCard({ label, value }) {
  const card = document.createElement('div');
  card.className = 'card reports-card';

  const labelEl = document.createElement('span');
  labelEl.className = 'reports-card__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'reports-card__value';
  valueEl.textContent = String(value);

  card.append(labelEl, valueEl);
  return card;
}

async function loadOverview() {
  const loadingEl = document.getElementById('dashboard-overview-loading');
  const emptyEl = document.getElementById('dashboard-overview-empty');
  const cardsEl = document.getElementById('dashboard-overview-cards');

  try {
    const { ok, status, body } = await ReportingService.getPipeline({});

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    loadingEl.hidden = true;

    if (!ok) {
      emptyEl.hidden = false;
      emptyEl.textContent = body?.error?.message || 'Unable to load your recruitment numbers right now.';
      return;
    }

    // Zero data still renders as real cards ("Applications: 0", ...) rather
    // than a vague empty state — every number is honest, never hidden.
    const cards = body?.data?.cards || {};
    cardsEl.replaceChildren(...CARD_DEFS.map((def) => buildCard({ label: def.label, value: cards[def.key] ?? 0 })));
    cardsEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = 'Unable to load your recruitment numbers. Please check your connection and try again.';
  }
}

async function renderDashboard() {
  const content = document.getElementById('dashboard-content');

  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected to login

  document.getElementById('user-email').textContent = result.profile.email;
  shell.setUser({ email: result.profile.email });
  content.hidden = false;

  await loadOverview();
}

document.addEventListener('DOMContentLoaded', renderDashboard);

// Re-check auth when the page is restored from the back/forward cache, so a
// logged-out user can't hit "back" into a cached dashboard view.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    document.getElementById('dashboard-content').hidden = true;
    renderDashboard();
  }
});
