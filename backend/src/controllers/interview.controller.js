const { successResponse, errorResponse } = require('../utils/response');
const interviewService = require('../services/interview.service');

function handleError(res, err, label) {
  if (err && err.isInterviewError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/interviews?vacancy_id=&from=&to= — HR only. Without vacancy_id,
// lists every upcoming interview across every vacancy the caller owns.
async function listInterviews(req, res) {
  try {
    const vacancyId = typeof req.query.vacancy_id === 'string' ? req.query.vacancy_id : undefined;
    const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from) ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' && DATE_RE.test(req.query.to) ? req.query.to : undefined;

    const interviews = vacancyId
      ? await interviewService.listForVacancy(vacancyId, req.user.id)
      : await interviewService.listUpcomingForHr(req.user.id, { from, to });

    return successResponse(res, { interviews });
  } catch (err) {
    return handleError(res, err, 'listInterviews');
  }
}

// POST /api/interviews/:id/cancel — HR only, owner-checked.
async function cancelInterview(req, res) {
  try {
    const interview = await interviewService.cancel({
      interviewId: req.params.id,
      authUserId: req.user.id,
    });
    return successResponse(res, interview);
  } catch (err) {
    return handleError(res, err, 'cancelInterview');
  }
}

module.exports = { listInterviews, cancelInterview };
