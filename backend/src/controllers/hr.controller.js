const { successResponse } = require('../utils/response');

// GET /api/hr/me — returns the authenticated user's HR profile.
// Only reachable after authenticateUser + requireHR have passed.
function getMe(req, res) {
  const { id, email, role, full_name, department, job_position, seniority_level, is_active } =
    req.profile;
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
