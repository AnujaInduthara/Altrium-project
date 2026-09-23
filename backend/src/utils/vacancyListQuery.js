// Pure parser/sanitiser for GET /api/public/vacancies query params. No
// Supabase or Express imports — this is the validation boundary, tested in
// isolation from the network.
//
// parseVacancyListQuery(rawQuery) -> { valid, errors, value }
//   errors : { field: message } map (empty when valid)
//   value  : { q, department, limit, offset }
//     q          : trimmed literal substring (SQL LIKE wildcards escaped), or ''
//     department : one of the known departments, or null
//     limit      : integer 1..50, default 20
//     offset     : integer >= 0, default 0

const { DEPARTMENTS } = require('../config/vacancyOptions');

const Q_MAX = 100;
const LIMIT_MIN = 1;
const LIMIT_MAX = 50;
const LIMIT_DEFAULT = 20;
const OFFSET_DEFAULT = 0;

// Escapes LIKE wildcards so a search term is always matched as a literal
// substring, never interpreted as a pattern.
function escapeLikeWildcards(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Parses a required-integer-like query param. Returns null if the raw value
// is missing (caller substitutes the default) and NaN if present but invalid.
function parseIntParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (typeof str !== 'string' || !/^-?\d+$/.test(str.trim())) return NaN;
  return Number(str.trim());
}

function parseVacancyListQuery(rawQuery = {}) {
  const errors = {};

  // q
  let q = '';
  if (rawQuery.q !== undefined && rawQuery.q !== null) {
    const raw = Array.isArray(rawQuery.q) ? rawQuery.q[0] : rawQuery.q;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed.length > Q_MAX) {
      errors.q = `Search text must be ${Q_MAX} characters or fewer.`;
    } else {
      q = escapeLikeWildcards(trimmed);
    }
  }

  // department
  let department = null;
  if (rawQuery.department !== undefined && rawQuery.department !== null && rawQuery.department !== '') {
    const raw = Array.isArray(rawQuery.department) ? rawQuery.department[0] : rawQuery.department;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!DEPARTMENTS.includes(trimmed)) {
      errors.department = 'Select a valid department.';
    } else {
      department = trimmed;
    }
  }

  // limit
  let limit = LIMIT_DEFAULT;
  const parsedLimit = parseIntParam(rawQuery.limit);
  if (Number.isNaN(parsedLimit)) {
    errors.limit = `Limit must be a whole number between ${LIMIT_MIN} and ${LIMIT_MAX}.`;
  } else if (parsedLimit !== null) {
    if (parsedLimit < LIMIT_MIN || parsedLimit > LIMIT_MAX) {
      errors.limit = `Limit must be a whole number between ${LIMIT_MIN} and ${LIMIT_MAX}.`;
    } else {
      limit = parsedLimit;
    }
  }

  // offset
  let offset = OFFSET_DEFAULT;
  const parsedOffset = parseIntParam(rawQuery.offset);
  if (Number.isNaN(parsedOffset)) {
    errors.offset = 'Offset must be a whole number of 0 or more.';
  } else if (parsedOffset !== null) {
    if (parsedOffset < 0) {
      errors.offset = 'Offset must be a whole number of 0 or more.';
    } else {
      offset = parsedOffset;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { q, department, limit, offset },
  };
}

module.exports = { parseVacancyListQuery };
