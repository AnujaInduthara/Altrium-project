const { successResponse } = require('../utils/response');

// GET /api/auth/me — returns the currently authenticated Supabase user.
function getMe(req, res) {
  const { id, email } = req.user;
  return successResponse(res, { id, email });
}

module.exports = { getMe };
