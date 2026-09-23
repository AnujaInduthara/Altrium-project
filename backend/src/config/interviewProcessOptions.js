// Canonical vocabulary + limits for the PB-09..PB-12 interview process.
// Mirrors the check constraints in sql/010_create_interview_process.sql.

const INTERVIEW_LEVELS = Object.freeze(['intern', 'junior', 'mid', 'senior']);

const PROCESS_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const STAGE_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
});

// A stage in either of these statuses already has (or had) a real interview
// attached to it — PB-11/PB-12 can never remove or reorder it.
const LOCKED_STAGE_STATUSES = Object.freeze([STAGE_STATUS.SCHEDULED, STAGE_STATUS.COMPLETED]);

const LIMITS = Object.freeze({
  STAGE_NAME_MAX: 120,
  STAGE_LIST_MAX: 10,
  DURATION_MIN: 15,
  DURATION_MAX: 480,
  REQUIRED_INTERVIEWERS_MIN: 1,
  REQUIRED_INTERVIEWERS_MAX: 5,
});

module.exports = { INTERVIEW_LEVELS, PROCESS_STATUS, STAGE_STATUS, LOCKED_STAGE_STATUSES, LIMITS };
