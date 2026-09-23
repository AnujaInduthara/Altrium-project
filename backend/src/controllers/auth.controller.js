const { successResponse, errorResponse } = require('../utils/response');
const { getProfileByAuthUserId } = require('../services/auth.service');

// GET /api/auth/me — the authenticated user's application profile (role,
// department, ...). Any authenticated, active user may call this; it's what
// role-aware frontend routing (AuthService.requireSession) checks after
// sign-in, before any role-specific page loads. An authenticated Supabase
// user with no profile row, or an inactive one, is reported the same way a
// role-specific route reports FORBIDDEN — the profiles table is the single
// source of truth for who may use the app past sign-in.
async function getMe(req, res) {
  const profile = await getProfileByAuthUserId(req.user.id);
  if (!profile || profile.is_active === false) {
    return errorResponse(res, 403, 'FORBIDDEN', 'This account is not authorized to access the app.');
  }

  const { id, email, role, full_name, department, job_position, seniority_level, is_active } =
    profile;
  return successResponse(res, {
    id,
    email,
    role,
    full_name,
    department,
    job_position,
    seniority_level,
    is_active,
  });
}

module.exports = { getMe };
