// Authentication service layer. Wraps Supabase Auth and the backend HR
// authorization check. No DOM access here — page controllers own the UI.

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

  // Calls the backend, which verifies the token and checks the profiles
  // table for the HR role. The frontend never decides authorization itself.
  async fetchHRProfile(accessToken) {
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/hr/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  },

  // For the login page: if already signed in, skip straight to the dashboard.
  async redirectIfAuthenticated(targetPage) {
    const session = await this.getSession();
    if (session) {
      window.location.replace(targetPage);
    }
  },

  // For the dashboard page: requires both a Supabase session AND a
  // server-verified HR profile. Returns null after redirecting away.
  async requireHRSession(loginPage) {
    const session = await this.getSession();
    if (!session) {
      window.location.replace(loginPage);
      return null;
    }

    const { ok, body } = await this.fetchHRProfile(session.access_token);
    if (!ok) {
      await this.signOut();
      window.location.replace(loginPage);
      return null;
    }

    return { session, profile: body.data };
  },
};
