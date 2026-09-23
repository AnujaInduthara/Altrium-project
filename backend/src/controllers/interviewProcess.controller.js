const { successResponse, errorResponse } = require('../utils/response');
const interviewProcessService = require('../services/interviewProcess.service');
const { validateInterviewLevel, validateStageList } = require('../utils/interviewStageValidation');

function handleError(res, err, label) {
  if (err && err.isInterviewProcessError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// POST /api/applications/:id/interview-process — PB-09/PB-10. HR only,
// owner-checked. Body: { interview_level }.
async function createInterviewProcess(req, res) {
  const { valid, errors, value: interviewLevel } = validateInterviewLevel(
    req.body && req.body.interview_level
  );
  if (!valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: errors.interview_level,
        fields: errors,
      },
    });
  }

  try {
    const result = await interviewProcessService.createProcess({
      applicationId: req.params.id,
      interviewLevel,
      authUserId: req.user.id,
    });
    return successResponse(res, result, 201);
  } catch (err) {
    return handleError(res, err, 'createInterviewProcess');
  }
}

// GET /api/applications/:id/interview-process — PB-10. HR only, owner-checked.
async function getInterviewProcess(req, res) {
  try {
    const result = await interviewProcessService.getProcess({
      applicationId: req.params.id,
      authUserId: req.user.id,
    });
    return successResponse(res, result);
  } catch (err) {
    return handleError(res, err, 'getInterviewProcess');
  }
}

// PUT /api/applications/:id/interview-process/stages — PB-11/PB-12. HR only,
// owner-checked. Body: { stages: [...] }. Full replacement of the ordered
// stage list.
async function replaceInterviewStages(req, res) {
  const { valid, errors, value: stages } = validateStageList(req.body && req.body.stages);
  if (!valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the stage list and try again.',
        fields: errors,
      },
    });
  }

  try {
    const result = await interviewProcessService.replaceStages({
      applicationId: req.params.id,
      stages,
      authUserId: req.user.id,
    });
    return successResponse(res, result);
  } catch (err) {
    return handleError(res, err, 'replaceInterviewStages');
  }
}

// DELETE /api/applications/:id/interview-process — HR only, owner-checked.
// Cancels a process that has no scheduled/completed stages.
async function cancelInterviewProcess(req, res) {
  try {
    const process = await interviewProcessService.cancelProcess({
      applicationId: req.params.id,
      authUserId: req.user.id,
    });
    return successResponse(res, { process });
  } catch (err) {
    return handleError(res, err, 'cancelInterviewProcess');
  }
}

module.exports = {
  createInterviewProcess,
  getInterviewProcess,
  replaceInterviewStages,
  cancelInterviewProcess,
};
