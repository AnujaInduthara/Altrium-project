const { successResponse, errorResponse } = require('../utils/response');
const hiringService = require('../services/hiring.service');
const applicationService = require('../services/application.service');
const { toScreeningView } = require('./screening.controller');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 'pending' is the only value any candidate can actually have until Step 5.2
// (PB-21) introduces hiring_decisions, but the filter already validates
// against the full set so the frontend/API contract doesn't change later.
const DECISION_STATUSES = ['pending', 'hired', 'rejected'];

function handleError(res, err, label) {
  if (err && err.isHiringError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// GET /api/hiring/candidates?vacancy_id=&status=
async function listCandidates(req, res) {
  try {
    const vacancyId = typeof req.query.vacancy_id === 'string' ? req.query.vacancy_id.trim() : '';
    if (vacancyId && !UUID_RE.test(vacancyId)) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'vacancy_id must be a valid id.');
    }

    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    if (status && !DECISION_STATUSES.includes(status)) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', `status must be one of: ${DECISION_STATUSES.join(', ')}.`);
    }

    const candidates = await hiringService.listCandidates({
      vacancyId: vacancyId || undefined,
      status: status || undefined,
    });
    return successResponse(res, { candidates });
  } catch (err) {
    return handleError(res, err, 'listCandidates');
  }
}

// GET /api/hiring/candidates/:applicationId
async function getCandidate(req, res) {
  try {
    const candidate = await hiringService.getCandidate({ applicationId: req.params.applicationId });
    return successResponse(res, {
      application: candidate.application,
      vacancy: candidate.vacancy,
      screening: toScreeningView(candidate.screening),
      stages: candidate.stages,
      decision: candidate.decision,
    });
  } catch (err) {
    return handleError(res, err, 'getCandidate');
  }
}

// GET /api/hiring/candidates/:applicationId/cv — same short-lived signed-URL
// pattern as application.controller.js's HR CV endpoint, authorized instead
// by "this application is in the Hiring Manager's pipeline".
async function getCandidateCv(req, res) {
  try {
    await hiringService.resolveCandidateForCv(req.params.applicationId);

    const application = await applicationService.getApplicationById(req.params.applicationId);
    if (!application) {
      return errorResponse(res, 404, 'CANDIDATE_NOT_FOUND', 'This candidate could not be found.');
    }

    const fileName = application.cv_original_name || `${application.reference}-cv`;
    const wantsDownload = ['1', 'true', 'yes'].includes(String(req.query.download || '').toLowerCase());
    const link = await applicationService.createCvSignedUrl(application.cv_path, {
      download: wantsDownload ? fileName : null,
    });

    return successResponse(res, {
      url: link.url,
      expires_in: link.expiresIn,
      file_name: fileName,
      content_type: application.cv_content_type || null,
    });
  } catch (err) {
    return handleError(res, err, 'getCandidateCv');
  }
}

module.exports = { listCandidates, getCandidate, getCandidateCv };
