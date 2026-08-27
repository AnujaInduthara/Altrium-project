// Entry point (index.html): route to the dashboard or the login page based on
// whether there is an existing Supabase session.

import { AuthService } from '../services/authService.js';

AuthService.getSession().then((session) => {
  window.location.replace(session ? 'dashboard.html' : 'login.html');
});
