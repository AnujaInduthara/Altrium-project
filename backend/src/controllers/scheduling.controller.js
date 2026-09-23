const { successResponse, errorResponse } = require('../utils/response');
const availabilityService = require('../services/availability.service');
const interviewService = require('../services/interview.service');

function handleError(res, err, label) {
  // findAvailableInterviewers can throw either: AvailabilityError for its own
  // concerns, or InterviewProcessError from the shared stage->vacancy
  // ownership resolver it delegates to.
  if (err && (err.isAvailabilityError || err.isInterviewProcessError || err.isInterviewError)) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RANGE_DAYS = 14;
const MAX_RANGE_DAYS = 60;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();
  const toMs = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((toMs - fromMs) / 86400000);
}

// GET /api/interview-stages/:stageId/available-interviewers — HR only.
// Query: from (date, default today), to (date, default from + 14 days).
async function getAvailableInterviewers(req, res) {
  const errors = {};
  const today = todayIso();

  let from = today;
  if (req.query.from !== undefined) {
    if (typeof req.query.from !== 'string' || !DATE_RE.test(req.query.from)) {
      errors.from = 'Enter a valid date (YYYY-MM-DD).';
    } else {
      from = req.query.from;
    }
  }

  let to = errors.from ? undefined : addDaysIso(from, DEFAULT_RANGE_DAYS);
  if (req.query.to !== undefined) {
    if (typeof req.query.to !== 'string' || !DATE_RE.test(req.query.to)) {
      errors.to = 'Enter a valid date (YYYY-MM-DD).';
    } else {
      to = req.query.to;
    }
  }

  if (!errors.from && !errors.to) {
    if (to < from) {
      errors.to = 'The end date must be on or after the start date.';
    } else if (daysBetween(from, to) > MAX_RANGE_DAYS) {
      errors.to = `The date range cannot be longer than ${MAX_RANGE_DAYS} days.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the date range and try again.',
        fields: errors,
      },
    });
  }

  try {
    const result = await availabilityService.findAvailableInterviewers({
      stageId: req.params.stageId,
      authUserId: req.user.id,
      from,
      to,
    });
    return successResponse(res, result);
  } catch (err) {
    return handleError(res, err, 'getAvailableInterviewers');
  }
}

// POST /api/interview-stages/:stageId/schedule — HR only, owner-checked.
// Body: { scheduled_date, start_time, interviewer_ids }.
async function scheduleInterview(req, res) {
  try {
    const interview = await interviewService.schedule({
      stageId: req.params.stageId,
      input: req.body || {},
      authUserId: req.user.id,
    });
    return successResponse(res, interview, 201);
  } catch (err) {
    if (err && err.isInterviewError && err.code === 'VALIDATION_ERROR' && err.fields) {
      return res.status(400).json({
        success: false,
        error: { code: err.code, message: err.message, fields: err.fields },
      });
    }
    return handleError(res, err, 'scheduleInterview');
  }
}

module.exports = { getAvailableInterviewers, scheduleInterview };
