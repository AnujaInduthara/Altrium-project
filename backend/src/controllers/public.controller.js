const { successResponse, errorResponse } = require('../utils/response');
const vacancyService = require('../services/vacancy.service');
const applicationService = require('../services/application.service');
const {
  validateApplicationInput,
  validateCvFile,
} = require('../utils/applicationValidation');

// GET /api/public/vacancies/:token
// Unauthenticated. Resolves the vacancy behind a public token and returns only
// public-safe fields.
//   * PUBLISHED -> 200 with the vacancy (the application form is shown).
//   * CLOSED    -> 410 VACANCY_CLOSED (PB-08: the link stays resolvable, but
//                  the applicant sees a "no longer accepting applications" state
//                  instead of the form).
//   * DRAFT / unknown token -> plain 404, so nothing about a non-live vacancy
//                  leaks.
async function getPublishedVacancy(req, res) {
  try {
    const vacancy = await vacancyService.getPublicVacancyByToken(req.params.token);
    if (!vacancy) {
      return errorResponse(res, 404, 'VACANCY_NOT_FOUND', 'This job vacancy is not available.');
    }
    if (vacancy.status === 'closed') {
      return errorResponse(
        res,
        410,
        'VACANCY_CLOSED',
        'Applications for this position are no longer being accepted.'
      );
    }
    return successResponse(res, vacancy);
  } catch (err) {
    console.error('getPublishedVacancy failed:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
}

// POST /api/public/vacancies/:token/applications
// Unauthenticated. The CV arrives as multipart/form-data (`cv` file + the text
// fields); uploadCvMiddleware has already parsed and size/extension-checked it.
// Order: confirm the vacancy is applyable -> validate fields -> verify the file
// -> hand off to the service (store CV, create row, clean up on failure).
async function submitApplication(req, res) {
  try {
    const vacancy = await vacancyService.getApplicableVacancyByToken(req.params.token);
    if (!vacancy) {
      return errorResponse(
        res,
        404,
        'VACANCY_NOT_FOUND',
        'This vacancy is no longer accepting applications.'
      );
    }

    const { valid, errors, value } = validateApplicationInput(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields and try again.',
          fields: errors,
        },
      });
    }

    const cvCheck = validateCvFile(req.file);
    if (!cvCheck.valid) {
      return errorResponse(res, cvCheck.status, cvCheck.code, cvCheck.message);
    }

    const result = await applicationService.createApplication({
      vacancy,
      input: value,
      cv: {
        buffer: req.file.buffer,
        size: req.file.size,
        originalName: req.file.originalname,
        ext: cvCheck.ext,
        contentType: cvCheck.contentType,
      },
    });

    return successResponse(
      res,
      {
        reference: result.reference,
        job_title: result.job_title,
        status: 'submitted',
      },
      201
    );
  } catch (err) {
    if (err && err.isApplicationError) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    console.error('submitApplication failed:', err.message);
    return errorResponse(
      res,
      500,
      'INTERNAL_ERROR',
      "We couldn't submit your application right now. Please try again later."
    );
  }
}

module.exports = { getPublishedVacancy, submitApplication };
