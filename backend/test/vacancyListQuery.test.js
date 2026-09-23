const test = require('node:test');
const assert = require('node:assert/strict');

const { parseVacancyListQuery } = require('../src/utils/vacancyListQuery');

test('defaults when the query is empty', () => {
  const { valid, errors, value } = parseVacancyListQuery({});
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { q: '', department: null, limit: 20, offset: 0 });
});

test('accepts a valid limit within range', () => {
  const { valid, value } = parseVacancyListQuery({ limit: '35' });
  assert.equal(valid, true);
  assert.equal(value.limit, 35);
});

test('rejects a limit of 0', () => {
  const { valid, errors } = parseVacancyListQuery({ limit: '0' });
  assert.equal(valid, false);
  assert.match(errors.limit, /limit/i);
});

test('rejects a limit above 50', () => {
  const { valid, errors } = parseVacancyListQuery({ limit: '51' });
  assert.equal(valid, false);
  assert.match(errors.limit, /limit/i);
});

test('rejects a non-numeric limit', () => {
  const { valid, errors } = parseVacancyListQuery({ limit: 'abc' });
  assert.equal(valid, false);
  assert.match(errors.limit, /limit/i);
});

test('rejects a negative limit', () => {
  const { valid, errors } = parseVacancyListQuery({ limit: '-5' });
  assert.equal(valid, false);
  assert.match(errors.limit, /limit/i);
});

test('rejects a negative offset', () => {
  const { valid, errors } = parseVacancyListQuery({ offset: '-1' });
  assert.equal(valid, false);
  assert.match(errors.offset, /offset/i);
});

test('accepts offset 0 explicitly', () => {
  const { valid, value } = parseVacancyListQuery({ offset: '0' });
  assert.equal(valid, true);
  assert.equal(value.offset, 0);
});

test('rejects a non-numeric offset', () => {
  const { valid, errors } = parseVacancyListQuery({ offset: 'abc' });
  assert.equal(valid, false);
  assert.match(errors.offset, /offset/i);
});

test('rejects an unknown department', () => {
  const { valid, errors } = parseVacancyListQuery({ department: 'Not A Real Dept' });
  assert.equal(valid, false);
  assert.match(errors.department, /department/i);
});

test('accepts a known department', () => {
  const { valid, value } = parseVacancyListQuery({ department: 'Engineering' });
  assert.equal(valid, true);
  assert.equal(value.department, 'Engineering');
});

test('rejects q over 100 characters', () => {
  const { valid, errors } = parseVacancyListQuery({ q: 'a'.repeat(101) });
  assert.equal(valid, false);
  assert.match(errors.q, /100/);
});

test('accepts q at exactly 100 characters', () => {
  const { valid, value } = parseVacancyListQuery({ q: 'a'.repeat(100) });
  assert.equal(valid, true);
  assert.equal(value.q, 'a'.repeat(100));
});

test('escapes % and _ inside q rather than passing them through', () => {
  const { valid, value } = parseVacancyListQuery({ q: '100%_done' });
  assert.equal(valid, true);
  assert.equal(value.q, '100\\%\\_done');
});

test('trims q before validating length and escaping', () => {
  const { valid, value } = parseVacancyListQuery({ q: '  engineer  ' });
  assert.equal(valid, true);
  assert.equal(value.q, 'engineer');
});
