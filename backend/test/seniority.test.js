const test = require('node:test');
const assert = require('node:assert/strict');

const { SENIORITY_LEVELS, seniorityRank, meetsMinimumSeniority } = require('../src/config/seniority');

// --- seniorityRank ---------------------------------------------------------

test('ranks every known level in ascending order', () => {
  const ranks = SENIORITY_LEVELS.map(seniorityRank);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] > ranks[i - 1]);
  }
});

test('returns null for an unknown level', () => {
  assert.equal(seniorityRank('archived'), null);
});

test('returns null for wrong-case input (case-sensitive)', () => {
  assert.equal(seniorityRank('Senior'), null);
  assert.equal(seniorityRank('SENIOR'), null);
});

test('returns null for null/undefined/non-string input', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(seniorityRank(value), null);
  }
});

// --- meetsMinimumSeniority --------------------------------------------------

test('meets the bar when exactly at the minimum', () => {
  assert.equal(meetsMinimumSeniority('senior', 'senior'), true);
});

test('meets the bar when above the minimum', () => {
  assert.equal(meetsMinimumSeniority('lead', 'senior'), true);
  assert.equal(meetsMinimumSeniority('senior', 'junior'), true);
});

test('fails the bar when below the minimum', () => {
  assert.equal(meetsMinimumSeniority('mid', 'senior'), false);
  assert.equal(meetsMinimumSeniority('intern', 'junior'), false);
});

test('fails closed when the actual level is unknown', () => {
  assert.equal(meetsMinimumSeniority('archived', 'junior'), false);
  assert.equal(meetsMinimumSeniority(null, 'junior'), false);
  assert.equal(meetsMinimumSeniority(undefined, 'junior'), false);
});

test('fails closed when the minimum level is unknown', () => {
  assert.equal(meetsMinimumSeniority('lead', 'archived'), false);
  assert.equal(meetsMinimumSeniority('lead', null), false);
});

test('fails closed on case mismatch even if otherwise sufficient', () => {
  assert.equal(meetsMinimumSeniority('Lead', 'senior'), false);
  assert.equal(meetsMinimumSeniority('lead', 'Senior'), false);
});

test('every level meets its own rank as the minimum, and none meets the next one up', () => {
  for (let i = 0; i < SENIORITY_LEVELS.length; i += 1) {
    assert.equal(meetsMinimumSeniority(SENIORITY_LEVELS[i], SENIORITY_LEVELS[i]), true);
    if (i + 1 < SENIORITY_LEVELS.length) {
      assert.equal(meetsMinimumSeniority(SENIORITY_LEVELS[i], SENIORITY_LEVELS[i + 1]), false);
    }
  }
});
