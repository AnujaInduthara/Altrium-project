// Employee dashboard controller: a minimal landing page for the 'employee'
// role (loginPage.js/entryPage.js route them here after sign-in). Step 4.1
// adds assigned-interview sections here — this deliberately stays minimal
// until then rather than stubbing sections that don't exist yet.

import { AuthService } from '../services/authService.js';
import { mountAppShell } from '../components/AppShell.js';

const LOGIN_PAGE = 'login.html';
const ALLOWED_ROLES = ['employee'];

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: '',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

async function renderDashboard() {
  const content = document.getElementById('dashboard-content');

  const result = await AuthService.requireSession(LOGIN_PAGE, ALLOWED_ROLES);
  if (!result) return; // already redirected to login

  document.getElementById('user-email').textContent = result.profile.email;
  shell.setUser({ email: result.profile.email, role: result.profile.role });
  content.hidden = false;
}

document.addEventListener('DOMContentLoaded', renderDashboard);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    document.getElementById('dashboard-content').hidden = true;
    renderDashboard();
  }
});
