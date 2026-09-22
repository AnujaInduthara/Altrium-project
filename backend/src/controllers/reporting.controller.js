const { successResponse, errorResponse } = require('../utils/response');
const reportingService = require('../services/reporting.service');
const { parseReportRange } = require('../utils/dateRange');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handleError(res, err, label) {
  if (err && err.isReportingError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// GET /api/reports/pipeline?from=&to=&vacancy_id= — 'management' sees every
// vacancy; 'hr' sees only their own (scoped inside the service).
async function getPipeline(req, res) {
  try {
    const vacancyId = typeof req.query.vacancy_id === 'string' ? req.query.vacancy_id.trim() : '';
    if (vacancyId && !UUID_RE.test(vacancyId)) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'vacancy_id must be a valid id.');
    }

    const { valid, errors, value } = parseReportRange({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    if (!valid) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', errors.to || errors.from || 'Invalid date range.');
    }

    const pipeline = await reportingService.getPipeline({
      from: value.from,
      to: value.to,
      vacancyId: vacancyId || undefined,
      requesterProfile: { role: req.profile.role, authUserId: req.user.id },
    });

    return successResponse(res, pipeline);
  } catch (err) {
    return handleError(res, err, 'getPipeline');
  }
}

module.exports = { getPipeline };
