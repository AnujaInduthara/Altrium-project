const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeApplicationIds,
  partitionSelection,
} = require('../src/utils/candidateSelection');
const { MAX_CANDIDATE_SELECTION } = require('../src/config/applicationOptions');

// --- normalizeApplicationIds -------------------------------------------------

test('accepts a list of ids, trims, de-duplicates and preserves order', () => {
  const res = normalizeApplicationIds([' a ', 'b', 'a', 'c']);
  assert.equal(res.valid, true);
  assert.deepEqual(res.ids, ['a', 'b', 'c']);
});

test('rejects a non-array body', () => {
  for (const raw of [undefined, null, 'a', {}, 42]) {
    const res = normalizeApplicationIds(raw);
    assert.equal(res.valid, false);
    assert.equal(res.code, 'INVALID_REQUEST');
  }
});

test('rejects an array containing a non-string entry', () => {
  const res = normalizeApplicationIds(['a', 123]);
  assert.equal(res.valid, false);
  assert.equal(res.code, 'INVALID_REQUEST');
});

test('rejects an empty selection (empty array or only blanks)', () => {
  for (const raw of [[], ['', '   ']]) {
    const res = normalizeApplicationIds(raw);
    assert.equal(res.valid, false);
    assert.equal(res.code, 'NO_APPLICATIONS_SELECTED');
    assert.match(res.message, /at least one applicant/i);
  }
});

test('rejects a selection larger than the batch cap', () => {
  const ids = Array.from({ length: MAX_CANDIDATE_SELECTION + 1 }, (_, i) => `id-${i}`);
  const res = normalizeApplicationIds(ids);
  assert.equal(res.valid, false);
  assert.equal(res.code, 'TOO_MANY_APPLICATIONS');
});

// --- partitionSelection ---------------------------------------------------

const vacancyApplications = [
  { id: 'sub-1', status: 'submitted' },
  { id: 'sub-2', status: 'submitted' },
  { id: 'sel-1', status: 'selected' },
  { id: 'rej-1', status: 'rejected' },
];

test('classifies eligible submitted applications', () => {
  const res = partitionSelection(['sub-1', 'sub-2'], vacancyApplications);
  assert.deepEqual(res.eligible, ['sub-1', 'sub-2']);
  assert.deepEqual(res.invalid, []);
  assert.deepEqual(res.alreadySelected, []);
  assert.deepEqual(res.ineligible, []);
});

test('flags an id that is not one of the vacancy\'s applications as invalid', () => {
  const res = partitionSelection(['sub-1', 'from-another-vacancy'], vacancyApplications);
  assert.deepEqual(res.invalid, ['from-another-vacancy']);
  assert.deepEqual(res.eligible, ['sub-1']);
});

test('treats an already-selected application as idempotent, not an error', () => {
  const res = partitionSelection(['sel-1'], vacancyApplications);
  assert.deepEqual(res.alreadySelected, ['sel-1']);
  assert.deepEqual(res.eligible, []);
  assert.deepEqual(res.ineligible, []);
});

test('flags a rejected application as ineligible', () => {
  const res = partitionSelection(['rej-1'], vacancyApplications);
  assert.deepEqual(res.ineligible, [{ id: 'rej-1', status: 'rejected' }]);
  assert.deepEqual(res.eligible, []);
});

test('a mixed request is partitioned across every bucket', () => {
  const res = partitionSelection(
    ['sub-1', 'sel-1', 'rej-1', 'ghost'],
    vacancyApplications
  );
  assert.deepEqual(res.eligible, ['sub-1']);
  assert.deepEqual(res.alreadySelected, ['sel-1']);
  assert.deepEqual(res.ineligible, [{ id: 'rej-1', status: 'rejected' }]);
  assert.deepEqual(res.invalid, ['ghost']);
});
