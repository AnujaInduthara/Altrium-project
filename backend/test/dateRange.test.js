const test = require('node:test');
const assert = require('node:assert/strict');

const { parseReportRange, MAX_SPAN_DAYS, DEFAULT_SPAN_DAYS } = require('../src/utils/dateRange');

const TODAY = '2026-06-15';

test('defaults to the last 90 days ending today when both from and to are omitted', () => {
  const { valid, value } = parseReportRange({ todayIso: TODAY });
  assert.equal(valid, true);
  assert.equal(value.to, TODAY);
  assert.equal(DEFAULT_SPAN_DAYS, 90);
  assert.equal(value.from, '2026-03-17'); // 90 days before 2026-06-15
});

test('defaults "to" to today when only "from" is given', () => {
  const { valid, value } = parseReportRange({ from: '2026-06-01', todayIso: TODAY });
  assert.equal(valid, true);
  assert.equal(value.from, '2026-06-01');
  assert.equal(value.to, TODAY);
});

test('defaults "from" to 90 days before "to" when only "to" is given', () => {
  const { valid, value } = parseReportRange({ to: '2026-06-01', todayIso: TODAY });
  assert.equal(valid, true);
  assert.equal(value.to, '2026-06-01');
  assert.equal(value.from, '2026-03-03'); // 90 days before 2026-06-01
});

test('accepts an explicit, valid range', () => {
  const { valid, value } = parseReportRange({ from: '2026-01-01', to: '2026-01-31', todayIso: TODAY });
  assert.equal(valid, true);
  assert.deepEqual(value, { from: '2026-01-01', to: '2026-01-31' });
});

test('accepts from === to (a single day)', () => {
  const { valid, value } = parseReportRange({ from: '2026-01-01', to: '2026-01-01', todayIso: TODAY });
  assert.equal(valid, true);
  assert.deepEqual(value, { from: '2026-01-01', to: '2026-01-01' });
});

test('rejects a malformed "from" date', () => {
  const { valid, errors } = parseReportRange({ from: '2026/01/01', to: '2026-01-31', todayIso: TODAY });
  assert.equal(valid, false);
  assert.ok(errors.from);
});

test('rejects a malformed "to" date', () => {
  const { valid, errors } = parseReportRange({ from: '2026-01-01', to: 'not-a-date', todayIso: TODAY });
  assert.equal(valid, false);
  assert.ok(errors.to);
});

test('rejects a calendar-invalid date (e.g. February 30th)', () => {
  const { valid, errors } = parseReportRange({ from: '2026-02-30', to: '2026-03-01', todayIso: TODAY });
  assert.equal(valid, false);
  assert.ok(errors.from);
});

test('rejects "to" before "from"', () => {
  const { valid, errors } = parseReportRange({ from: '2026-06-01', to: '2026-01-01', todayIso: TODAY });
  assert.equal(valid, false);
  assert.match(errors.to, /before/i);
});

test('rejects a span longer than 730 days', () => {
  const { valid, errors } = parseReportRange({ from: '2020-01-01', to: '2026-06-15', todayIso: TODAY });
  assert.equal(valid, false);
  assert.match(errors.to, /730/);
  assert.equal(MAX_SPAN_DAYS, 730);
});

test('accepts a span of exactly 730 days', () => {
  const { valid } = parseReportRange({ from: '2024-06-16', to: '2026-06-15', todayIso: TODAY });
  assert.equal(valid, true);
});

test('falls back to the real current date when todayIso is omitted or invalid', () => {
  const omitted = parseReportRange({});
  assert.equal(omitted.valid, true);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(omitted.value.to));

  const invalid = parseReportRange({ todayIso: 'garbage' });
  assert.equal(invalid.valid, true);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(invalid.value.to));
});

test('treats an empty string the same as omitted for both fields', () => {
  const { valid, value } = parseReportRange({ from: '', to: '', todayIso: TODAY });
  assert.equal(valid, true);
  assert.equal(value.to, TODAY);
});
