// Dashboard page controller: mounts the shared app shell, enforces the
// protected route, and wires sign-out.

import { AuthService } from '../services/authService.js';
import { mountAppShell } from '../components/AppShell.js';

const LOGIN_PAGE = 'login.html';

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'dashboard',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

async function renderDashboard() {
  const content = document.getElementById('dashboard-content');

  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected to login

  document.getElementById('user-email').textContent = result.profile.email;
  shell.setUser({ email: result.profile.email });
  content.hidden = false;
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
