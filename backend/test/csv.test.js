const test = require('node:test');
const assert = require('node:assert/strict');

const { toCsv, reportFilename } = require('../src/utils/csv');

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'note', label: 'Note' },
];

// --- plain values --------------------------------------------------------

test('plain values round-trip unquoted', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: 'Backend Engineer', note: 'Engineering' }] });
  assert.equal(csv, 'Name,Note\r\nBackend Engineer,Engineering\r\n');
});

test('an empty rows array produces just the header line', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [] });
  assert.equal(csv, 'Name,Note\r\n');
});

// --- commas, quotes and newlines -----------------------------------------

test('a value containing a comma is wrapped in double quotes', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: 'Smith, Jane', note: 'x' }] });
  assert.equal(csv, 'Name,Note\r\n"Smith, Jane",x\r\n');
});

test('a value containing a double quote is wrapped and the quote is doubled', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: 'The "Best" Role', note: 'x' }] });
  assert.equal(csv, 'Name,Note\r\n"The ""Best"" Role",x\r\n');
});

test('a value containing a newline (LF) is wrapped in double quotes', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: 'Line one\nLine two', note: 'x' }] });
  assert.equal(csv, 'Name,Note\r\n"Line one\nLine two",x\r\n');
});

test('a value containing a CRLF is wrapped in double quotes', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: 'Line one\r\nLine two', note: 'x' }] });
  assert.equal(csv, 'Name,Note\r\n"Line one\r\nLine two",x\r\n');
});

// --- null / undefined ------------------------------------------------------

test('null and undefined values render as an empty cell', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: null, note: undefined }] });
  assert.equal(csv, 'Name,Note\r\n,\r\n');
});

// --- formula injection: each dangerous leading character --------------------

test('=cmd|\' /C calc\'!A0 is prefixed with an apostrophe (the payload from the plan\'s DoD example)', () => {
  const value = "=cmd|' /C calc'!A0";
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: value, note: 'x' }] });
  const lines = csv.split('\r\n');
  assert.equal(lines[1], `'${value},x`);
  // The leading apostrophe means the cell is stored as text, not a formula.
  assert.ok(lines[1].startsWith("'="));
});

test('+1+1 is prefixed with an apostrophe', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: '+1+1', note: 'x' }] });
  assert.equal(csv.split('\r\n')[1], "'+1+1,x");
});

test('-1+1 is prefixed with an apostrophe', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: '-1+1', note: 'x' }] });
  assert.equal(csv.split('\r\n')[1], "'-1+1,x");
});

test('@SUM(A1) is prefixed with an apostrophe', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: '@SUM(A1)', note: 'x' }] });
  assert.equal(csv.split('\r\n')[1], "'@SUM(A1),x");
});

test('a leading tab is prefixed with an apostrophe', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: '\tmalicious', note: 'x' }] });
  assert.equal(csv.split('\r\n')[1], "'\tmalicious,x");
});

test('a leading carriage return is prefixed with an apostrophe AND the field is quoted (it still contains a raw CR)', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: '\rmalicious', note: 'x' }] });
  // Splitting on \r\n would misparse a field containing a lone \r, so assert
  // on the raw string instead.
  assert.ok(csv.includes('"\'\rmalicious",x'));
});

test('sanitisation happens before quoting: a comma-containing formula gets both the apostrophe and quotes', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: '=A1,A2', note: 'x' }] });
  assert.equal(csv.split('\r\n')[1], '"\'=A1,A2",x');
});

test('a value that merely contains one of the dangerous characters, but not as the first character, is left untouched', () => {
  const csv = toCsv({ columns: COLUMNS, rows: [{ name: 'Senior=Engineer', note: 'x' }] });
  assert.equal(csv.split('\r\n')[1], 'Senior=Engineer,x');
});

// --- reportFilename ----------------------------------------------------------

test('reportFilename builds a plain, predictable name', () => {
  assert.equal(reportFilename('recruitment-report', '2026-01-01', '2026-03-31'), 'recruitment-report_2026-01-01_2026-03-31.csv');
});

test('reportFilename strips path separators (dots and dashes are allowed, so they survive; only the slashes are stripped)', () => {
  assert.equal(
    reportFilename('../../etc/passwd', '2026-01-01', '2026-01-31'),
    '....etcpasswd_2026-01-01_2026-01-31.csv'
  );
});

test('reportFilename strips a leading slash cleanly', () => {
  assert.equal(reportFilename('/etc/passwd', '2026-01-01', '2026-01-31'), 'etcpasswd_2026-01-01_2026-01-31.csv');
});

test('reportFilename strips spaces, quotes and other unusual characters', () => {
  assert.equal(
    reportFilename('my report "final"!', '2026-01-01', '2026-01-31'),
    'myreportfinal_2026-01-01_2026-01-31.csv'
  );
});

test('reportFilename tolerates a null/undefined part', () => {
  assert.equal(reportFilename('recruitment-report', undefined, null), 'recruitment-report__.csv');
});
