const { successResponse, errorResponse } = require('../utils/response');
const evaluationService = require('../services/evaluation.service');

function handleError(res, err, label) {
  if (err && (err.isEvaluationError || err.isInterviewError)) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// POST /api/interviews/:id/evaluation — PB-19. Assignment-checked (404 if not
// assigned, reusing Step 4.1's check); 409 if not started yet, cancelled, or
// already submitted.
async function submitEvaluation(req, res) {
  try {
    const evaluation = await evaluationService.submit({
      interviewId: req.params.id,
      profileId: req.profile.id,
      input: req.body || {},
    });
    return successResponse(res, evaluation, 201);
  } catch (err) {
    // Field-level rating/comment errors ride alongside the usual { code,
    // message } shape — same pattern as scheduling.controller.js's
    // VALIDATION_ERROR handling.
    if (err && err.isEvaluationError && err.code === 'VALIDATION_ERROR' && err.fields) {
      return res.status(400).json({
        success: false,
        error: { code: err.code, message: err.message, fields: err.fields },
      });
    }
    return handleError(res, err, 'submitEvaluation');
  }
}

// GET /api/interviews/:id/evaluation — the caller's OWN evaluation only, or
// null if they haven't submitted yet.
async function getEvaluation(req, res) {
  try {
    const evaluation = await evaluationService.getForInterview({
      interviewId: req.params.id,
      profileId: req.profile.id,
    });
    return successResponse(res, evaluation);
  } catch (err) {
    return handleError(res, err, 'getEvaluation');
  }
}

module.exports = { submitEvaluation, getEvaluation };
