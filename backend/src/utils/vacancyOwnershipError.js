// Pure — the one correct translation of a VacancyError into an HTTP response
// shape, for every controller that calls vacancyService.getVacancyForUser /
// publishVacancy / closeVacancy directly.
//
// FORBIDDEN (the vacancy exists but belongs to another HR user) must never
// reach the client as a 403 — a 403 there would itself confirm that some
// vacancy exists at that id, to a caller who isn't allowed to know that
// (DEVELOPMENT_PLAN.md §3 Security: "reading someone else's record returns
// 404, not 403"). Every other VacancyError code already carries its own
// correct status and passes through unchanged.
function toVacancyErrorResponse(err) {
  if (err.code === 'FORBIDDEN') {
    return { status: 404, code: 'VACANCY_NOT_FOUND', message: 'This vacancy could not be found.' };
  }
  return { status: err.status, code: err.code, message: err.message };
}

module.exports = { toVacancyErrorResponse };
