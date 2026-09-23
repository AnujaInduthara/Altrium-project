// PB-24 — pure CSV serialisation. No DB or Express imports.
//
//   toCsv({ columns, rows }) -> string
//     columns : [{ key, label }] — `label` is the header cell, `key` reads
//               the value off each row.
//     rows    : plain objects keyed by each column's `key`.
//     Produces RFC4180-style CSV: CRLF line endings, a value containing a
//     comma/quote/CR/LF wrapped in double quotes with internal quotes
//     doubled, null/undefined rendered as an empty cell.
//
//   CRITICAL — formula-injection protection: any value whose first character
//   is =, +, -, @, a tab, or a carriage return is prefixed with a single
//   apostrophe BEFORE quoting. Opened in Excel or Sheets, a cell starting
//   with one of those characters is otherwise evaluated as a formula rather
//   than displayed as text — this neutralises that regardless of what a
//   vacancy title, department name or any other field happens to contain.
//
//   reportFilename(prefix, from, to) -> a safe filename, stripping anything
//   outside [A-Za-z0-9._-] from each part.

const DANGEROUS_LEADING_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

function sanitizeFormulaInjection(value) {
  if (value.length === 0) return value;
  return DANGEROUS_LEADING_CHARS.has(value[0]) ? `'${value}` : value;
}

function needsQuoting(value) {
  return /[",\r\n]/.test(value);
}

// Sanitisation happens BEFORE quoting, never after — quoting a
// formula-injection payload without first neutralising it would still leave
// it executable once a spreadsheet unwraps the quotes.
function formatCell(value) {
  if (value === null || value === undefined) return '';
  const sanitized = sanitizeFormulaInjection(String(value));
  return needsQuoting(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
}

function toCsv({ columns, rows }) {
  const header = columns.map((c) => formatCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => formatCell(row[c.key])).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}

function reportFilename(prefix, from, to) {
  const safe = (part) => String(part ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  return `${safe(prefix)}_${safe(from)}_${safe(to)}.csv`;
}

module.exports = { toCsv, reportFilename };
