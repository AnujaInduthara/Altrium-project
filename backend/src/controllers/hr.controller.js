const { successResponse } = require('../utils/response');

// GET /api/hr/me — returns the authenticated user's HR profile.
// Only reachable after authenticateUser + requireHR have passed.
function getMe(req, res) {
  const { id, email, role } = req.profile;
  return successResponse(res, { id, email, role });
}

module.exports = { getMe };
