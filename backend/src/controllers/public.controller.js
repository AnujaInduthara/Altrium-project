const { successResponse, errorResponse } = require('../utils/response');
const vacancyService = require('../services/vacancy.service');

// GET /api/public/vacancies/:token
// Unauthenticated. Resolves a PUBLISHED vacancy by its public token and returns
// only public-safe fields. Draft / closed / unknown tokens all get a plain 404
// so nothing about non-published vacancies leaks. PB-03 will add the actual
// application submission on top of this.
async function getPublishedVacancy(req, res) {
  try {
    const vacancy = await vacancyService.getPublishedVacancyByToken(req.params.token);
    if (!vacancy) {
      return errorResponse(res, 404, 'VACANCY_NOT_FOUND', 'This job vacancy is not available.');
    }
    return successResponse(res, vacancy);
  } catch (err) {
    console.error('getPublishedVacancy failed:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
}

module.exports = { getPublishedVacancy };
