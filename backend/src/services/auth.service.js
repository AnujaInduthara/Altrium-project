const { supabaseAdmin } = require('../config/supabase');

// Verifies a Supabase access token against the Auth server and returns the
// authenticated user, or null if the token is missing/invalid/expired.
async function verifyAccessToken(token) {
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }
  return data.user;
}

// Looks up the application-level profile (and HR role) for an authenticated
// Supabase user. Uses the service-role client so this works regardless of RLS.
async function getProfileByAuthUserId(authUserId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, auth_user_id, email, role')
    .eq('auth_user_id', authUserId)
    .single();

  if (error || !data) {
    return null;
  }
  return data;
}

module.exports = { verifyAccessToken, getProfileByAuthUserId };
