// Authentication service layer. Wraps Supabase Auth and the backend's
// role-based authorization check. No DOM access here — page controllers own
// the UI.

import { APP_CONFIG } from '../config.js';
import { supabaseClient } from '../lib/supabaseClient.js';

export const AuthService = {
  async getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  },

  async signIn(email, password) {
    return supabaseClient.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    await supabaseClient.auth.signOut();
  },

  // Calls the backend, which verifies the token and returns the caller's
  // application profile (role, department, ...). Any authenticated, active
  // user gets a profile back here — role-specific access is enforced by the
  // role-gated endpoints the app calls afterwards, not by this call.
  async fetchProfile(accessToken) {
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  },

  // Requires a Supabase session AND a server-verified, active profile whose
  // role is one of `allowedRoles`. Returns null after redirecting to
  // loginPage (no session, no profile, inactive account, or wrong role).
  async requireSession(loginPage, allowedRoles) {
    const session = await this.getSession();
    if (!session) {
      window.location.replace(loginPage);
      return null;
    }

    const { ok, body } = await this.fetchProfile(session.access_token);
    if (!ok || !allowedRoles.includes(body?.data?.role)) {
      await this.signOut();
      window.location.replace(loginPage);
      return null;
    }

    return { session, profile: body.data };
  },

  // Thin wrapper over requireSession so every existing HR page (dashboard,
  // vacancies, ai-screening, ...) is untouched.
  async requireHRSession(loginPage) {
    return this.requireSession(loginPage, ['hr']);
  },
};
