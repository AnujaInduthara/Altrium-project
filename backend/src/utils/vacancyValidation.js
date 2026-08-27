// Server-side validation for the "create vacancy" payload. This is the
// security boundary — the client also validates, but nothing here trusts that.
//
// validateVacancyInput(body) -> { valid, errors, value }
//   errors  : { field: message } map (empty when valid)
//   value   : the cleaned, trimmed, coerced values ready to persist. It never
//             contains `status`, `created_by`, `id` or timestamps — those are
//             set from trusted server state in the service layer.

const {
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  LIMITS,
} = require('../config/vacancyOptions');

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Accepts either a JSON array of strings or a newline-separated string and
// returns a clean array of non-empty, trimmed requirement strings.
function normaliseRequirements(raw) {
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    items = raw.split(/\r?\n/);
  }
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

// Returns a positive integer, or null for anything that is not one
// (0, negatives, decimals, "abc", null, booleans, ...).
function parsePositions(raw) {
  let n = raw;
  if (typeof n === 'string') {
    const trimmed = n.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    n = Number(trimmed);
  }
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
  return n;
}

function validateVacancyInput(body = {}) {
  const errors = {};

  const job_title = asTrimmedString(body.job_title);
  const department = asTrimmedString(body.department);
  const location = asTrimmedString(body.location);
  const employment_type = asTrimmedString(body.employment_type);
  const experience_level = asTrimmedString(body.experience_level);
  const job_description = asTrimmedString(body.job_description);
  const job_requirements = normaliseRequirements(body.job_requirements);
  const number_of_positions = parsePositions(body.number_of_positions);

  if (!job_title) {
    errors.job_title = 'Job title is required.';
  } else if (job_title.length > LIMITS.JOB_TITLE_MAX) {
    errors.job_title = `Job title must be ${LIMITS.JOB_TITLE_MAX} characters or fewer.`;
  }

  if (!department) {
    errors.department = 'Department is required.';
  } else if (!DEPARTMENTS.includes(department)) {
    errors.department = 'Select a valid department.';
  }

  if (!location) {
    errors.location = 'Location is required.';
  } else if (location.length > LIMITS.LOCATION_MAX) {
    errors.location = `Location must be ${LIMITS.LOCATION_MAX} characters or fewer.`;
  }

  if (!employment_type) {
    errors.employment_type = 'Employment type is required.';
  } else if (!EMPLOYMENT_TYPES.includes(employment_type)) {
    errors.employment_type = 'Select a valid employment type.';
  }

  if (!experience_level) {
    errors.experience_level = 'Experience level is required.';
  } else if (!EXPERIENCE_LEVELS.includes(experience_level)) {
    errors.experience_level = 'Select a valid experience level.';
  }

  if (number_of_positions === null) {
    errors.number_of_positions =
      'Number of positions must be a whole number of at least 1.';
  } else if (number_of_positions > LIMITS.POSITIONS_MAX) {
    errors.number_of_positions =
      `Number of positions cannot exceed ${LIMITS.POSITIONS_MAX}.`;
  }

  if (!job_description) {
    errors.job_description = 'Job description is required.';
  } else if (job_description.length > LIMITS.JOB_DESCRIPTION_MAX) {
    errors.job_description =
      `Job description must be ${LIMITS.JOB_DESCRIPTION_MAX} characters or fewer.`;
  }

  if (job_requirements.length === 0) {
    errors.job_requirements = 'Add at least one job requirement.';
  } else if (job_requirements.length > LIMITS.REQUIREMENTS_MAX_ITEMS) {
    errors.job_requirements =
      `Add no more than ${LIMITS.REQUIREMENTS_MAX_ITEMS} requirements.`;
  } else if (job_requirements.some((r) => r.length > LIMITS.REQUIREMENT_MAX)) {
    errors.job_requirements =
      `Each requirement must be ${LIMITS.REQUIREMENT_MAX} characters or fewer.`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      job_title,
      department,
      location,
      employment_type,
      experience_level,
      number_of_positions,
      job_description,
      job_requirements,
    },
  };
}

module.exports = { validateVacancyInput, normaliseRequirements, parsePositions };
