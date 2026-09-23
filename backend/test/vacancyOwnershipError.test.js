const test = require('node:test');
const assert = require('node:assert/strict');

const { toVacancyErrorResponse } = require('../src/utils/vacancyOwnershipError');

// PB-7.2 security audit — vacancy.controller.js's getVacancy/publishVacancy/
// closeVacancy and application.controller.js's listVacancyApplications used
// to pass a VacancyError straight through to the response. For FORBIDDEN
// (an existing vacancy owned by another HR user) that meant a caller probing
// another HR user's vacancy id got a 403 — itself confirming the vacancy
// exists, exactly what DEVELOPMENT_PLAN.md's "404, not 403" rule forbids.

test('FORBIDDEN is translated to 404 VACANCY_NOT_FOUND, never left as 403', () => {
  const result = toVacancyErrorResponse({
    code: 'FORBIDDEN',
    status: 403,
    message: 'You do not have permission to view this vacancy.',
  });
  assert.deepEqual(result, {
    status: 404,
    code: 'VACANCY_NOT_FOUND',
    message: 'This vacancy could not be found.',
  });
});

test('every other VacancyError code passes through unchanged', () => {
  const cases = [
    { code: 'VACANCY_NOT_FOUND', status: 404, message: 'This vacancy could not be found.' },
    { code: 'VACANCY_ALREADY_PUBLISHED', status: 409, message: 'This vacancy has already been published.' },
    { code: 'VACANCY_NOT_DRAFT', status: 409, message: 'Only draft vacancies can be published.' },
    { code: 'VACANCY_INCOMPLETE', status: 400, message: 'Please complete all required vacancy information before publishing.' },
    { code: 'VACANCY_CLOSE_FAILED', status: 500, message: 'Unable to close the vacancy. Please try again.' },
  ];
  for (const err of cases) {
    assert.deepEqual(toVacancyErrorResponse(err), err);
  }
});

test('does not mistake a message merely containing "forbidden" for the FORBIDDEN code', () => {
  const err = { code: 'VACANCY_NOT_DRAFT', status: 409, message: 'This action is forbidden right now.' };
  assert.deepEqual(toVacancyErrorResponse(err), err);
});
