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

// Must run after authenticateUser. Confirms the authenticated user has an HR
// profile before allowing access to HR-only routes.
async function requireHR(req, res, next) {
  const profile = await getProfileByAuthUserId(req.user.id);

  if (!profile || profile.role !== 'hr') {
    return errorResponse(res, 403, 'FORBIDDEN', 'You are not authorized to access the HR portal.');
  }

  req.profile = profile;
  next();
}

module.exports = { authenticateUser, requireHR };
