// PB-17 notification API. Wraps /api/notifications. Same bearer-token /
// result shape as every other authenticated service. No DOM access.

import { APP_CONFIG } from '../config.js';
import { supabaseClient } from '../lib/supabaseClient.js';

async function authHeaders(extra = {}) {
  const { data } = await supabaseClient.auth.getSession();
  const token = data.session?.access_token;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function toResult(response) {
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const apiBase = APP_CONFIG.API_BASE_URL;

export const NotificationService = {
  // list({ unreadOnly }) — the caller's own notifications, newest first.
  async list({ unreadOnly = false } = {}) {
    const qs = unreadOnly ? '?unread_only=1' : '';
    const response = await fetch(`${apiBase}/notifications${qs}`, { headers: await authHeaders() });
    return toResult(response);
  },

  async markRead(id) {
    const response = await fetch(`${apiBase}/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    return toResult(response);
  },
};
