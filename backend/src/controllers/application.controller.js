const { successResponse, errorResponse } = require('../utils/response');
const vacancyService = require('../services/vacancy.service');
const applicationService = require('../services/application.service');

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

    const applications = await applicationService.listApplicationsForVacancy(vacancy.id);

    return successResponse(res, {
      vacancy: {
        id: vacancy.id,
        job_title: vacancy.job_title,
        department: vacancy.department,
        location: vacancy.location,
        status: vacancy.status,
      },
      applications,
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

    const link = await applicationService.createCvSignedUrl(application.cv_path);

    return successResponse(res, {
      url: link.url,
      expires_in: link.expiresIn,
      file_name: application.cv_original_name || `${application.reference}-cv`,
      content_type: application.cv_content_type || null,
    });
  } catch (err) {
    return handleError(res, err, 'getApplicationCv');
  }
}

module.exports = { listVacancyApplications, getApplicationCv };
