const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCloseTransition } = require('../src/utils/vacancyClosure');
const { VACANCY_STATUS } = require('../src/config/vacancyOptions');

// --- evaluateCloseTransition -------------------------------------------------

test('allows PUBLISHED -> CLOSED', () => {
  const res = evaluateCloseTransition(VACANCY_STATUS.PUBLISHED);
  assert.deepEqual(res, { allowed: true });
});

test('rejects closing a DRAFT vacancy', () => {
  const res = evaluateCloseTransition(VACANCY_STATUS.DRAFT);
  assert.equal(res.allowed, false);
  assert.equal(res.code, 'VACANCY_NOT_PUBLISHED');
  assert.equal(res.status, 409);
  assert.match(res.message, /only published vacancies/i);
});

test('rejects closing an already-CLOSED vacancy (no re-open, no re-close)', () => {
  const res = evaluateCloseTransition(VACANCY_STATUS.CLOSED);
  assert.equal(res.allowed, false);
  assert.equal(res.code, 'VACANCY_ALREADY_CLOSED');
  assert.equal(res.status, 409);
  assert.match(res.message, /already closed/i);
});

test('rejects an unknown / missing status', () => {
  for (const raw of [undefined, null, '', 'archived', 'PUBLISHED']) {
    const res = evaluateCloseTransition(raw);
    assert.equal(res.allowed, false, `status ${JSON.stringify(raw)} must not be closable`);
    assert.equal(res.code, 'VACANCY_NOT_PUBLISHED');
  }
});
