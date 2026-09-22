const { successResponse, errorResponse } = require('../utils/response');
const hiringDecisionService = require('../services/hiringDecision.service');

const DECISION_VALUES = ['hired', 'rejected'];

function handleError(res, err, label) {
  if (err && err.isHiringDecisionError) {
    if (err.details) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code, message: err.message, ...err.details },
      });
    }
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// POST /api/hiring/candidates/:applicationId/decision — hiring_manager only
// (never management — see the route). Body: { decision, reason?,
// acknowledge_incomplete? }.
async function decide(req, res) {
  try {
    const { decision, reason, acknowledge_incomplete } = req.body || {};

    if (typeof decision !== 'string' || !DECISION_VALUES.includes(decision)) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', `decision must be one of: ${DECISION_VALUES.join(', ')}.`);
    }

    const outcome = await hiringDecisionService.decide({
      applicationId: req.params.applicationId,
      profileId: req.profile.id,
      authUserId: req.user.id,
      decision,
      reason,
      acknowledgeIncomplete: acknowledge_incomplete === true,
    });

    return successResponse(res, outcome, 201);
  } catch (err) {
    return handleError(res, err, 'decide');
  }
}

module.exports = { decide };
