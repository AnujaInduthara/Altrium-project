const { successResponse, errorResponse } = require('../utils/response');
const vacancyService = require('../services/vacancy.service');
const applicationService = require('../services/application.service');
const screeningService = require('../services/screening/screeningService');
const { toScreeningView } = require('./screening.controller');

// A VacancyError (FORBIDDEN when the vacancy belongs to another HR user, etc.)
// translates straight to a response; anything else is an unexpected failure.
function handleError(res, err, label) {
  if (err && err.isVacancyError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// GET /api/vacancies/:id/applications — HR only. Lists the applications for one
// of the caller's own vacancies (newest first).
async function listVacancyApplications(req, res) {
  try {
    const vacancy = await vacancyService.getVacancyForUser(req.params.id, req.user.id);
    if (!vacancy) {
      return errorResponse(res, 404, 'VACANCY_NOT_FOUND', 'This vacancy could not be found.');
    }

    const [applications, screenings] = await Promise.all([
      applicationService.listApplicationsForVacancy(vacancy.id),
      screeningService.listScreeningsForVacancy(vacancy.id),
    ]);

    // Attach each application's PB-05 screening summary (status / score /
    // recommendation / rank) for the review list. The AI never changes the
    // application's own status — that stays "submitted".
    const byApplication = new Map(screenings.map((s) => [s.application_id, s]));
    const withScreening = applications.map((application) => ({
      ...application,
      screening: toScreeningView(byApplication.get(application.id)),
    }));

    return successResponse(res, {
      vacancy: {
        id: vacancy.id,
        job_title: vacancy.job_title,
        department: vacancy.department,
        location: vacancy.location,
        status: vacancy.status,
      },
      applications: withScreening,
    });
  } catch (err) {
    return handleError(res, err, 'listVacancyApplications');
  }
}

// GET /api/applications/:id/cv — HR only. Returns a short-lived signed URL for
// the applicant's CV, but only to the HR user who owns the vacancy. An
// application owned by someone else is reported as "not found" so nothing about
// its existence leaks.
async function getApplicationCv(req, res) {
  try {
    const application = await applicationService.getApplicationById(req.params.id);
    if (!application) {
      return errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
    }

    let vacancy;
    try {
      vacancy = await vacancyService.getVacancyForUser(application.vacancy_id, req.user.id);
    } catch (err) {
      if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
        return errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
      }
      throw err;
    }
    if (!vacancy) {
      return errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
    }

    const fileName = application.cv_original_name || `${application.reference}-cv`;
    const wantsDownload = ['1', 'true', 'yes'].includes(
      String(req.query.download || '').toLowerCase()
    );
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
    return handleError(res, err, 'getApplicationCv');
  }
}

// GET /api/applications/:id/review — HR only. The full PB-06 applicant-review
// payload for one application: applicant details + the parent vacancy summary +
// the stored (read-only) AI screening result, with the same advisory ranking
// used by the AI Screening list. An application the caller does not own is
// reported as "not found" so nothing about it leaks. Read-only — nothing here
// changes the application, its status, or the screening result.
async function getApplicationReview(req, res) {
  try {
    const application = await applicationService.getApplicationById(req.params.id);
    if (!application) {
      return errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
    }

    let vacancy;
    try {
      vacancy = await vacancyService.getVacancyForUser(application.vacancy_id, req.user.id);
    } catch (err) {
      if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
        return errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
      }
      throw err;
    }
    if (!vacancy) {
      return errorResponse(res, 404, 'APPLICATION_NOT_FOUND', 'This application could not be found.');
    }

    // Rank is advisory ordering derived from the persisted score, computed the
    // same way as the AI Screening list so the two views agree.
    const screenings = await screeningService.listScreeningsForVacancy(vacancy.id);
    const screeningRow = screenings.find((s) => s.application_id === application.id) || null;

    return successResponse(res, {
      application: {
        id: application.id,
        reference: application.reference,
        full_name: application.full_name,
        email: application.email,
        phone: application.phone,
        location: application.location,
        status: application.status,
        cv_original_name: application.cv_original_name,
        cv_size_bytes: application.cv_size_bytes,
        cv_content_type: application.cv_content_type,
        created_at: application.created_at,
      },
      vacancy: {
        id: vacancy.id,
        job_title: vacancy.job_title,
        department: vacancy.department,
        location: vacancy.location,
        employment_type: vacancy.employment_type,
        experience_level: vacancy.experience_level,
        status: vacancy.status,
      },
      screening: toScreeningView(screeningRow),
    });
  } catch (err) {
    return handleError(res, err, 'getApplicationReview');
  }
}

module.exports = { listVacancyApplications, getApplicationCv, getApplicationReview };
