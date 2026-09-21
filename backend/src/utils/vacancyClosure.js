// Pure, DB-free rule for the PB-08 "close vacancy" state machine. Given the
// vacancy's current status, decide whether the PUBLISHED -> CLOSED transition is
// allowed and, if not, with which typed error.
//
// Existence and ownership are checked separately by vacancy.service.js (they
// need the fetched row and the authenticated user id); this module owns only
// the status-transition decision, mirroring how candidateSelection.js isolates
// the security-relevant selection logic from the database.
//
//   evaluateCloseTransition(currentStatus) ->
//     { allowed: true }
//     | { allowed: false, code, status, message }

const { VACANCY_STATUS, VACANCY_CLOSABLE_FROM } = require('../config/vacancyOptions');

function evaluateCloseTransition(currentStatus) {
  if (currentStatus === VACANCY_STATUS.CLOSED) {
    return {
      allowed: false,
      code: 'VACANCY_ALREADY_CLOSED',
      status: 409,
      message: 'This vacancy is already closed.',
    };
  }

  if (!VACANCY_CLOSABLE_FROM.includes(currentStatus)) {
    return {
      allowed: false,
      code: 'VACANCY_NOT_PUBLISHED',
      status: 409,
      message: 'Only published vacancies can be closed.',
    };
  }

  return { allowed: true };
}

module.exports = { evaluateCloseTransition };
