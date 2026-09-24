// Candidate "set your password" page. Reached only via the one-time invite
// link candidateAccount.service.js emails after an applicant is selected for
// interview. Supabase's client (default detectSessionInUrl: true) parses the
// link's #access_token=...&type=invite hash into a session automatically, so
// by the time this script runs there is either already a session or the link
// was invalid/expired/already used — there is no separate "verify token" step.
//
// Deliberately does NOT use AuthService.requireSession: that helper signs the
// caller out and redirects to login.html on any failure, which is the wrong
// UX for an expired invite link (the person has no password yet to sign in
// with). Instead this page shows its own "invalid link" state.

import { supabaseClient } from '../lib/supabaseClient.js';
import { createPasswordField } from '../components/PasswordField.js';
import { createAlert } from '../components/Alert.js';
import { validateSetPasswordForm } from '../utils/validators.js';

const HOME_PAGE = 'my-interviews.html';

const $ = (id) => document.getElementById(id);

const els = {
  loading: $('set-password-loading'),
  invalid: $('set-password-invalid'),
  formWrap: $('set-password-form-wrap'),
};

function showOnly(...visible) {
  const all = [els.loading, els.invalid, els.formWrap];
  for (const el of all) el.hidden = !visible.includes(el);
}

function initForm() {
  const form = $('set-password-form');
  const password = createPasswordField(document.querySelector('[data-field="password"]'));
  const confirm = createPasswordField(document.querySelector('[data-field="confirm"]'));
  const alert = createAlert($('form-alert'));

  const submitBtn = $('submit-btn');
  const submitLabel = submitBtn.querySelector('[data-label]');

  let submitting = false;

  function setLoading(loading) {
    submitting = loading;
    submitBtn.disabled = loading;
    submitBtn.setAttribute('aria-busy', String(loading));
    submitLabel.textContent = loading ? 'Setting password…' : 'Set password';
  }

  function showFieldErrors(errors) {
    password.clearError();
    confirm.clearError();
    if (errors.password) password.setError(errors.password);
    if (errors.confirm) confirm.setError(errors.confirm);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    alert.hide();
    const values = { password: password.rawValue, confirm: confirm.rawValue };

    const errors = validateSetPasswordForm(values);
    showFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const { error } = await supabaseClient.auth.updateUser({ password: values.password });
      if (error) {
        alert.error(error.message || 'Unable to set your password. Please try again.');
        setLoading(false);
        return;
      }
      window.location.replace(HOME_PAGE);
    } catch (err) {
      alert.error('Unable to connect to the server. Please check your connection and try again.');
      setLoading(false);
    }
  });
}

async function init() {
  showOnly(els.loading);

  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    showOnly(els.invalid);
    return;
  }

  initForm();
  showOnly(els.formWrap);
}

document.addEventListener('DOMContentLoaded', init);
