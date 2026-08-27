const { successResponse, errorResponse } = require('../utils/response');
const { validateVacancyInput } = require('../utils/vacancyValidation');
const { buildPublicApplyUrl } = require('../config/app');
const vacancyService = require('../services/vacancy.service');

// Adds the derived public application URL (null until the vacancy is published)
// so the frontend never has to know how the link is built.
function withPublicUrl(vacancy) {
  return {
    ...vacancy,
    public_url: vacancy.public_token ? buildPublicApplyUrl(vacancy.public_token) : null,
  };
}

// Translates a typed VacancyError straight to a response; anything else is an
// unexpected failure and becomes a generic 500 (details logged, never sent).
function handleError(res, err, label) {
  if (err && err.isVacancyError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// POST /api/vacancies — create a vacancy as a DRAFT owned by the caller.
async function createVacancy(req, res) {
  const { valid, errors, value } = validateVacancyInput(req.body);

  if (!valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some vacancy details need attention.',
        fields: errors,
      },
    });
  }

  try {
    const vacancy = await vacancyService.createVacancy(value, req.user.id);
    return successResponse(res, withPublicUrl(vacancy), 201);
  } catch (err) {
    console.error('createVacancy failed:', err.message);
    return errorResponse(
      res,
      500,
      'VACANCY_CREATE_FAILED',
      'Unable to save the vacancy. Please try again later.'
    );
  }
}

// GET /api/vacancies — the caller's own vacancies, newest first.
async function listVacancies(req, res) {
  try {
    const vacancies = await vacancyService.listVacanciesForUser(req.user.id);
    return successResponse(res, { vacancies: vacancies.map(withPublicUrl) });
  } catch (err) {
    console.error('listVacancies failed:', err.message);
    return errorResponse(
      res,
      500,
      'VACANCY_LIST_FAILED',
      'Unable to load vacancies. Please try again later.'
    );
  }
}

// GET /api/vacancies/:id — one vacancy the caller owns.
async function getVacancy(req, res) {
  try {
    const vacancy = await vacancyService.getVacancyForUser(req.params.id, req.user.id);
    if (!vacancy) {
      return errorResponse(res, 404, 'VACANCY_NOT_FOUND', 'This vacancy could not be found.');
    }
    return successResponse(res, withPublicUrl(vacancy));
  } catch (err) {
    return handleError(res, err, 'getVacancy');
  }
}

// POST /api/vacancies/:id/publish — DRAFT -> PUBLISHED. No request body.
async function publishVacancy(req, res) {
  try {
    const vacancy = await vacancyService.publishVacancy(req.params.id, req.user.id);
    return successResponse(res, withPublicUrl(vacancy));
  } catch (err) {
    return handleError(res, err, 'publishVacancy');
  }
}

module.exports = { createVacancy, listVacancies, getVacancy, publishVacancy };
