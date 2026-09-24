const { successResponse, errorResponse } = require('../utils/response');
const candidateService = require('../services/candidate.service');

// GET /api/candidate/interviews — the caller's own scheduled interview(s),
// never another candidate's. Scoped via req.profile.id, set by
// requireRole('candidate') in auth.middleware.js.
async function listMyInterviews(req, res) {
  try {
    const interviews = await candidateService.listMyInterviews(req.profile.id);
    return successResponse(res, { interviews });
  } catch (err) {
    console.error('listMyInterviews failed:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
}

module.exports = { listMyInterviews };
