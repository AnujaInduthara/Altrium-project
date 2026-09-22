const { verifyAccessToken, getProfileByAuthUserId } = require('../services/auth.service');
const { errorResponse } = require('../utils/response');

// Verifies the Authorization: Bearer <access_token> header against Supabase
// Auth and attaches the authenticated user to the request.
async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const user = await verifyAccessToken(token);
  if (!user) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'Invalid or expired session.');
  }

  req.user = user;
  next();
}

// Must run after authenticateUser. Confirms the authenticated user has a
// profile whose role is one of `allowedRoles`, and that the profile is
// active, before allowing access. Never trusts a client-supplied role — it
// only ever comes from the profiles table.
function requireRole(...allowedRoles) {
  return async function requireRoleMiddleware(req, res, next) {
    const profile = await getProfileByAuthUserId(req.user.id);

    if (!profile || !allowedRoles.includes(profile.role)) {
      return errorResponse(res, 403, 'FORBIDDEN', 'You are not authorized to access this resource.');
    }
    if (profile.is_active === false) {
      return errorResponse(res, 403, 'FORBIDDEN', 'This account is inactive.');
    }

    req.profile = profile;
    next();
  };
}

// Every existing HR route keeps working unchanged: requireHR is just
// requireRole('hr') under its original name.
const requireHR = requireRole('hr');

module.exports = { authenticateUser, requireHR, requireRole };
