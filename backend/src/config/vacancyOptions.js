// Canonical vocabularies and limits for the vacancy form fields.
//
// The backend is the single source of truth: it validates every dropdown
// value against these lists, so the client can never widen what is accepted.
// The frontend <select> options in frontend/create-vacancy.html mirror these.

const DEPARTMENTS = [
  'Engineering',
  'Product',
  'Design',
  'Finance',
  'Human Resources',
  'Marketing',
  'Sales',
  'Operations',
  'Customer Support',
  'Legal',
];

const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Internship',
  'Temporary',
];

const EXPERIENCE_LEVELS = [
  'Entry Level',
  '1+ Years',
  '2+ Years',
  '3+ Years',
  '5+ Years',
  '8+ Years',
];

// PB-01 only ever creates DRAFT. PB-02 owns DRAFT -> PUBLISHED, PB-08 owns
// PUBLISHED -> CLOSED. There is no transition back out of CLOSED.
const VACANCY_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CLOSED: 'closed',
});

// The only statuses a PB-08 "close vacancy" action may transition FROM. A draft
// has nothing to close; a closed vacancy can never be re-opened.
const VACANCY_CLOSABLE_FROM = Object.freeze(['published']);

const LIMITS = Object.freeze({
  JOB_TITLE_MAX: 150,
  DEPARTMENT_MAX: 100,
  LOCATION_MAX: 120,
  JOB_DESCRIPTION_MAX: 10000,
  REQUIREMENT_MAX: 100,
  REQUIREMENTS_MAX_ITEMS: 50,
  POSITIONS_MAX: 999,
});

module.exports = {
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  VACANCY_STATUS,
  VACANCY_CLOSABLE_FROM,
  LIMITS,
};
