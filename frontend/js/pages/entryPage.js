// Entry point (index.html): route to this user's role-based home page, or the
// login page, based on whether there is an existing, valid session.

import { AuthService } from '../services/authService.js';

const LOGIN_PAGE = 'login.html';
const DEFAULT_HOME_PAGE = 'dashboard.html';

// Mirrors loginPage.js's ROLE_HOME_PAGES — see DEVELOPMENT_PLAN.md Step 2.1.
const ROLE_HOME_PAGES = {
  hr: 'dashboard.html',
  employee: 'employee-dashboard.html',
  hiring_manager: 'hiring-dashboard.html',
  management: 'reports.html',
};

async function route() {
  const session = await AuthService.getSession();
  if (!session) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  const { ok, body } = await AuthService.fetchProfile(session.access_token);
  if (!ok) {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
    return;
  }

  window.location.replace(ROLE_HOME_PAGES[body.data.role] || DEFAULT_HOME_PAGE);
}

route();
