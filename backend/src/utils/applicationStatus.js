// PB-07 application status state machine. Pure — no Supabase, no Express — so
// the transition rules can be unit tested in isolation.
//
// validateStatusChange({ current, next, hr_note }) -> { valid, errors, value }
//   errors.status     : `next` is not a known status value
//   errors.hr_note     : hr_note is not a string, or too long
//   errors.transition  : `next` is a known status but not reachable from `current`
//                         (including current === next)
//   value              : { next, hr_note } — hr_note trimmed, '' when absent

const { APPLICATION_STATUS } = require('../config/applicationOptions');

const HR_NOTE_MAX = 1000;

// submitted -> selected is also allowed directly (not just via shortlisted) to
// preserve the existing bulk "Select Candidates" flow (candidates.html /
// POST /vacancies/:id/candidates/select), which selects straight from
// 'submitted' without requiring an intermediate shortlist step.
const ALLOWED_TRANSITIONS = Object.freeze({
  [APPLICATION_STATUS.SUBMITTED]: [
    APPLICATION_STATUS.UNDER_REVIEW,
    APPLICATION_STATUS.SHORTLISTED,
    APPLICATION_STATUS.REJECTED,
    APPLICATION_STATUS.SELECTED,
  ],
  [APPLICATION_STATUS.UNDER_REVIEW]: [
    APPLICATION_STATUS.SHORTLISTED,
    APPLICATION_STATUS.REJECTED,
  ],
  [APPLICATION_STATUS.SHORTLISTED]: [
    APPLICATION_STATUS.SELECTED,
    APPLICATION_STATUS.REJECTED,
  ],
  [APPLICATION_STATUS.REJECTED]: [APPLICATION_STATUS.UNDER_REVIEW],
  // PB-21: the Hiring Manager's audited decision (hiringDecision.service.js)
  // is the only path that ever exercises these two — the ordinary HR status
  // endpoint (application.service.js's updateApplicationStatus) explicitly
  // refuses 'hired' as a target regardless of what this table allows, so a
  // hire always carries a hiring_decisions row.
  [APPLICATION_STATUS.SELECTED]: [APPLICATION_STATUS.HIRED, APPLICATION_STATUS.REJECTED],
  // Terminal: no legal transition ever leaves 'hired'.
  [APPLICATION_STATUS.HIRED]: [],
});

function canTransition(from, to) {
  if (from === to) return false;
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function validateStatusChange({ current, next, hr_note } = {}) {
  const errors = {};

  const knownStatuses = Object.values(APPLICATION_STATUS);
  if (typeof next !== 'string' || !knownStatuses.includes(next)) {
    errors.status = 'Unknown status value.';
  }

  let trimmedNote = '';
  if (hr_note !== undefined && hr_note !== null && hr_note !== '') {
    if (typeof hr_note !== 'string') {
      errors.hr_note = 'Internal note must be text.';
    } else {
      trimmedNote = hr_note.trim();
      if (trimmedNote.length > HR_NOTE_MAX) {
        errors.hr_note = `Internal note must be ${HR_NOTE_MAX} characters or fewer.`;
      }
    }
  }

  if (!errors.status && !canTransition(current, next)) {
    errors.transition = 'This status change is not allowed.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { next, hr_note: trimmedNote },
  };
}

module.exports = {
  APPLICATION_STATUS,
  ALLOWED_TRANSITIONS,
  canTransition,
  validateStatusChange,
};
