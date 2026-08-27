// Pure vacancy form-validation helpers — no DOM. Mirrors the server rules in
// backend/src/utils/vacancyValidation.js. Client validation is a UX aid only;
// the backend re-validates everything.

import { isBlank } from './validators.js';

export const DEPARTMENTS = [
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

export const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Internship',
  'Temporary',
];

export const EXPERIENCE_LEVELS = [
  'Entry Level',
  '1+ Years',
  '2+ Years',
  '3+ Years',
  '5+ Years',
  '8+ Years',
];

export const VACANCY_LIMITS = {
  jobTitle: 150,
  location: 120,
  jobDescription: 10000,
  requirementItem: 100,
  requirementsMaxItems: 50,
  positionsMax: 999,
};

// Turns the requirements textarea (one requirement per line) into a clean array.
export function parseRequirements(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isPositiveInteger(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1;
}

// values: { job_title, department, location, employment_type,
//   experience_level, number_of_positions (string), job_description,
//   job_requirements (raw textarea string) }
// Returns a { field: message } map of the first error per field, or {} if valid.
export function validateVacancyForm(values) {
  const errors = {};

  if (isBlank(values.job_title)) {
    errors.job_title = 'Job title is required.';
  } else if (values.job_title.trim().length > VACANCY_LIMITS.jobTitle) {
    errors.job_title = `Job title must be ${VACANCY_LIMITS.jobTitle} characters or fewer.`;
  }

  if (isBlank(values.department)) {
    errors.department = 'Department is required.';
  } else if (!DEPARTMENTS.includes(values.department)) {
    errors.department = 'Select a valid department.';
  }

  if (isBlank(values.location)) {
    errors.location = 'Location is required.';
  } else if (values.location.trim().length > VACANCY_LIMITS.location) {
    errors.location = `Location must be ${VACANCY_LIMITS.location} characters or fewer.`;
  }

  if (isBlank(values.employment_type)) {
    errors.employment_type = 'Employment type is required.';
  } else if (!EMPLOYMENT_TYPES.includes(values.employment_type)) {
    errors.employment_type = 'Select a valid employment type.';
  }

  if (isBlank(values.experience_level)) {
    errors.experience_level = 'Experience level is required.';
  } else if (!EXPERIENCE_LEVELS.includes(values.experience_level)) {
    errors.experience_level = 'Select a valid experience level.';
  }

  if (isBlank(values.number_of_positions)) {
    errors.number_of_positions = 'Number of positions is required.';
  } else if (!isPositiveInteger(values.number_of_positions)) {
    errors.number_of_positions = 'Number of positions must be a whole number of at least 1.';
  } else if (Number(values.number_of_positions) > VACANCY_LIMITS.positionsMax) {
    errors.number_of_positions = `Number of positions cannot exceed ${VACANCY_LIMITS.positionsMax}.`;
  }

  if (isBlank(values.job_description)) {
    errors.job_description = 'Job description is required.';
  } else if (values.job_description.trim().length > VACANCY_LIMITS.jobDescription) {
    errors.job_description = `Job description must be ${VACANCY_LIMITS.jobDescription} characters or fewer.`;
  }

  const requirements = parseRequirements(values.job_requirements);
  if (requirements.length === 0) {
    errors.job_requirements = 'Add at least one job requirement (one per line).';
  } else if (requirements.length > VACANCY_LIMITS.requirementsMaxItems) {
    errors.job_requirements = `Add no more than ${VACANCY_LIMITS.requirementsMaxItems} requirements.`;
  } else if (requirements.some((r) => r.length > VACANCY_LIMITS.requirementItem)) {
    errors.job_requirements = `Each requirement must be ${VACANCY_LIMITS.requirementItem} characters or fewer.`;
  }

  return errors;
}
