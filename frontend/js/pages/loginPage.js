// Login page controller. Composes the reusable field / alert components and
// delegates all auth work to AuthService.

import { AuthService } from '../services/authService.js';
import { createTextField } from '../components/TextField.js';
import { createPasswordField } from '../components/PasswordField.js';
import { createAlert } from '../components/Alert.js';
import { validateLoginForm } from '../utils/validators.js';

const DEFAULT_HOME_PAGE = 'dashboard.html';

// Where each role lands after signing in. Sprint 2 builds the non-HR pages;
// linking to them now (rather than stubbing them) is deliberate — see
// DEVELOPMENT_PLAN.md Step 2.1.
const ROLE_HOME_PAGES = {
  hr: 'dashboard.html',
  employee: 'employee-dashboard.html',
  hiring_manager: 'hiring-dashboard.html',
  management: 'reports.html',
};

// Already signed in? Skip the form and go straight to this role's home page.
// Role-aware (not a flat redirect to dashboard.html) so a non-HR session
// doesn't bounce here -> dashboard.html -> requireSession failure -> here.
async function redirectIfSignedIn() {
  const session = await AuthService.getSession();
  if (!session) return;

  const { ok, body } = await AuthService.fetchProfile(session.access_token);
  if (ok) {
    window.location.replace(ROLE_HOME_PAGES[body.data.role] || DEFAULT_HOME_PAGE);
    return;
  }
  // Session exists but the profile is gone/inactive — clear it quietly so the
  // form below works instead of looping. No error shown; nothing was submitted.
  await AuthService.signOut();
}

function initLoginPage() {
  redirectIfSignedIn();

  const form = document.getElementById('login-form');
  const email = createTextField(document.querySelector('[data-field="email"]'));
  const password = createPasswordField(document.querySelector('[data-field="password"]'));
  const alert = createAlert(document.getElementById('form-alert'));

  const submitBtn = document.getElementById('submit-btn');
  const submitLabel = submitBtn.querySelector('[data-label]');

  let submitting = false;

  function setLoading(loading) {
    submitting = loading;
    submitBtn.disabled = loading;
    submitBtn.setAttribute('aria-busy', String(loading));
    submitLabel.textContent = loading ? 'Signing in…' : 'Login';
  }

  function showFieldErrors(errors) {
    email.clearError();
    password.clearError();
    if (errors.email) email.setError(errors.email);
    if (errors.password) password.setError(errors.password);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    alert.hide();
    const credentials = { email: email.value, password: password.rawValue };

    const errors = validateLoginForm(credentials);
    showFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const { data, error } = await AuthService.signIn(
        credentials.email,
        credentials.password
      );

      if (error || !data.session) {
        alert.error('Invalid email or password.');
        setLoading(false);
        return;
      }

      const { ok, status, body } = await AuthService.fetchProfile(
        data.session.access_token
      );

      if (ok) {
        window.location.replace(ROLE_HOME_PAGES[body.data.role] || DEFAULT_HOME_PAGE);
        return;
      }

      if (status === 403) {
        alert.error('You are not authorized to access this app.');
      } else if (status === 401) {
        alert.error('Invalid email or password.');
      } else {
        alert.error(body?.error?.message || 'Something went wrong. Please try again.');
      }

      await AuthService.signOut();
      setLoading(false);
    } catch (err) {
      alert.error(
        'Unable to connect to the server. Please check your connection and try again.'
      );
      setLoading(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', initLoginPage);
