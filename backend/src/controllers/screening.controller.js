const { successResponse, errorResponse } = require('../utils/response');
const vacancyService = require('../services/vacancy.service');
const applicationService = require('../services/application.service');
const screeningService = require('../services/screening/screeningService');

// HR-facing, read-only + retry endpoints for PB-05 screening results. All of
// these are already behind authenticateUser + requireHR (see the router); each
// one additionally confirms the caller owns the parent vacancy, and reports an
// application it does not own as 404 so nothing leaks.

// Public-safe projection of a screening row (drops internal error_detail etc.).
function toScreeningView(row) {
  if (!row) return { status: 'not_started' };
  return {
    status: row.status,
    score: row.score,
    recommendation: row.recommendation,
    candidate_name: row.candidate_name,
    skills: row.skills || [],
    matched_skills: row.matched_skills || [],
    missing_skills: row.missing_skills || [],
    experience_match: row.experience_match,
    education_match: row.education_match,
    summary: row.summary,
    score_breakdown: row.score_breakdown || null,
    evidence: row.evidence || null,
    model_provider: row.model_provider,
    model_name: row.model_name,
    screening_version: row.screening_version,
    error_code: row.error_code || null,
    ai_screening_rank: row.ai_screening_rank ?? null,
    processed_at: row.processing_completed_at,
    updated_at: row.updated_at,
  };
}

// Resolves the application and enforces "caller owns the parent vacancy".
// Returns { application } or sends a 404 response and returns null.
async function resolveOwnedApplication(req, res) {
  const application = await applicationService.getApplicationById(req.params.id);
  if (!application) {
    errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
    return null;
  }
  try {
    const vacancy = await vacancyService.getVacancyForUser(application.vacancy_id, req.user.id);
    if (!vacancy) {
      errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
      return null;
    }
  } catch (err) {
    if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
      errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
      return null;
    }
    throw err;
  }
  return { application };
}

// GET /api/applications/:id/screening
async function getApplicationScreening(req, res) {
  try {
    const owned = await resolveOwnedApplication(req, res);
    if (!owned) return undefined;

    const row = await screeningService.getScreeningForApplication(owned.application.id);
    return successResponse(res, { screening: toScreeningView(row) });
  } catch (err) {
    console.error('getApplicationScreening failed:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
}

// POST /api/applications/:id/screening/retry
// HR-authorized manual retry of a screening that previously FAILED.
async function retryApplicationScreening(req, res) {
  try {
    const owned = await resolveOwnedApplication(req, res);
    if (!owned) return undefined;

    const outcome = await screeningService.retryScreening(owned.application.id);

    if (outcome.alreadyRunning) {
      return successResponse(res, { status: outcome.status, message: 'AI screening is already being processed.' });
    }
    if (outcome.status === 'pending') {
      return successResponse(res, { status: 'pending', message: 'AI screening has been queued.' });
    }
    // completed / other — nothing to do.
    return errorResponse(
      res,
      409,
      'SCREENING_NOT_RETRYABLE',
      `Screening is "${outcome.status}" and cannot be retried.`
    );
  } catch (err) {
    if (err && err.isScreeningError) {
      return errorResponse(res, 404, 'SCREENING_NOT_FOUND', 'No screening exists for this application yet.');
    }
    console.error('retryApplicationScreening failed:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
}

module.exports = { getApplicationScreening, retryApplicationScreening, toScreeningView };
