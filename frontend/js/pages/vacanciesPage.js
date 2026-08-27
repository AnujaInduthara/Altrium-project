// Job Vacancies page controller: mounts the app shell, enforces the HR-only
// route, and lists the current HR user's vacancies (newest first). This is a
// minimal view whose main job is to lead into the Create New Vacancy flow.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createAlert } from '../components/Alert.js';
import { withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'vacancies',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const page = document.getElementById('vacancies-page');
const loadingEl = document.getElementById('vacancies-loading');
const emptyEl = document.getElementById('vacancies-empty');
const listEl = document.getElementById('vacancies-list');
const alert = createAlert(document.getElementById('vacancies-alert'));

const STATUS_LABELS = { draft: 'Draft', published: 'Published', closed: 'Closed' };

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Build one list item entirely with DOM APIs + textContent so vacancy text
// (title, department, ...) is never interpreted as HTML.
function renderVacancy(vacancy) {
  const li = document.createElement('li');

  const card = document.createElement('a');
  card.className = 'card vacancy-card';
  card.href = withHashParam('vacancy.html', 'id', vacancy.id);

  const main = document.createElement('div');
  main.className = 'vacancy-card__main';

  const title = document.createElement('h2');
  title.className = 'vacancy-card__title';
  title.textContent = vacancy.job_title;

  const meta = document.createElement('p');
  meta.className = 'vacancy-card__meta';
  meta.textContent = [
    vacancy.department,
    vacancy.location,
    vacancy.employment_type,
    vacancy.experience_level,
    `${vacancy.number_of_positions} position${vacancy.number_of_positions === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  main.append(title, meta);

  const aside = document.createElement('div');
  aside.className = 'vacancy-card__aside';

  const statusKey = String(vacancy.status || '').toLowerCase();
  const badge = document.createElement('span');
  badge.className = `badge badge--${statusKey || 'draft'}`;
  badge.textContent = STATUS_LABELS[statusKey] || vacancy.status || 'Draft';

  const created = document.createElement('span');
  created.className = 'vacancy-card__date';
  created.textContent = vacancy.created_at ? `Created ${formatDate(vacancy.created_at)}` : '';

  aside.append(badge, created);

  // Explicit call-to-action so it's obvious the card opens the vacancy (where
  // a draft can be published).
  const cta = document.createElement('span');
  cta.className = 'vacancy-card__cta';
  cta.textContent = statusKey === 'draft' ? 'Open & publish →' : 'View →';

  card.append(main, aside, cta);
  li.append(card);
  return li;
}

function showList(vacancies) {
  listEl.replaceChildren(...vacancies.map(renderVacancy));
  loadingEl.hidden = true;
  emptyEl.hidden = true;
  listEl.hidden = false;
}

function showEmpty() {
  loadingEl.hidden = true;
  listEl.hidden = true;
  emptyEl.hidden = false;
}

async function loadVacancies() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });
  page.hidden = false;

  try {
    const { ok, status, body } = await VacancyService.list();

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!ok) {
      loadingEl.hidden = true;
      alert.error(body?.error?.message || 'Unable to load vacancies. Please try again later.');
      return;
    }

    const vacancies = (body && body.data && body.data.vacancies) || [];
    if (vacancies.length === 0) {
      showEmpty();
    } else {
      showList(vacancies);
    }
  } catch (err) {
    loadingEl.hidden = true;
    alert.error('Unable to load vacancies. Please check your connection and try again.');
  }
}

document.addEventListener('DOMContentLoaded', loadVacancies);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    page.hidden = true;
    loadingEl.hidden = false;
    listEl.hidden = true;
    emptyEl.hidden = true;
    alert.hide();
    loadVacancies();
  }
});
