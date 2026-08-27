// Single shared Supabase client. The UMD bundle is loaded from a <script> tag
// in each HTML page (it exposes `window.supabase`), so we read it off window
// rather than importing it here.

import { APP_CONFIG } from '../config.js';

if (!window.supabase) {
  throw new Error(
    'Supabase UMD bundle not found. Load it via <script> before any module script.'
  );
}

export const supabaseClient = window.supabase.createClient(
  APP_CONFIG.SUPABASE_URL,
  APP_CONFIG.SUPABASE_ANON_KEY
);
