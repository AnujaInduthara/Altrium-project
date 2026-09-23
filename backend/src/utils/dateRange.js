// PB-23 — pure date-range validation for the reporting endpoints. No DB or
// Express imports. `todayIso` is always passed in rather than read from
// Date.now() here, so this stays deterministically testable.

const MAX_SPAN_DAYS = 730;
const DEFAULT_SPAN_DAYS = 90;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects e.g. 2026-02-30, which Date would otherwise silently roll over.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtcDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(iso, days) {
  const date = toUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((toUtcDate(toIso) - toUtcDate(fromIso)) / 86400000);
}

// parseReportRange({ from, to, todayIso }) -> { valid, errors, value }
//   from/to   : optional ISO date strings (YYYY-MM-DD). Either or both may be
//               omitted — `to` defaults to today, `from` defaults to
//               DEFAULT_SPAN_DAYS before the (resolved) `to`.
//   todayIso  : what "today" means for defaulting; falls back to the real
//               current date when omitted or invalid.
//   value     : { from, to } (both resolved ISO dates) when valid, else null
function parseReportRange({ from, to, todayIso } = {}) {
  const errors = {};
  const today = isValidIsoDate(todayIso) ? todayIso : new Date().toISOString().slice(0, 10);

  const hasFrom = from !== undefined && from !== null && from !== '';
  const hasTo = to !== undefined && to !== null && to !== '';

  if (hasFrom && !isValidIsoDate(from)) errors.from = 'from must be a valid date (YYYY-MM-DD).';
  if (hasTo && !isValidIsoDate(to)) errors.to = 'to must be a valid date (YYYY-MM-DD).';

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, value: null };
  }

  const resolvedTo = hasTo ? to : today;
  const resolvedFrom = hasFrom ? from : addDays(resolvedTo, -DEFAULT_SPAN_DAYS);

  if (resolvedTo < resolvedFrom) {
    return { valid: false, errors: { to: 'to must not be before from.' }, value: null };
  }

  if (daysBetween(resolvedFrom, resolvedTo) > MAX_SPAN_DAYS) {
    return {
      valid: false,
      errors: { to: `Date range must not exceed ${MAX_SPAN_DAYS} days.` },
      value: null,
    };
  }

  return { valid: true, errors: {}, value: { from: resolvedFrom, to: resolvedTo } };
}

module.exports = { parseReportRange, MAX_SPAN_DAYS, DEFAULT_SPAN_DAYS };
