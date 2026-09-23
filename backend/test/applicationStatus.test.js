const test = require('node:test');
const assert = require('node:assert/strict');

const { canTransition, validateStatusChange } = require('../src/utils/applicationStatus');

// --- canTransition -----------------------------------------------------

const LEGAL = [
  ['submitted', 'under_review'],
  ['submitted', 'shortlisted'],
  ['submitted', 'rejected'],
  ['submitted', 'selected'], // preserved bulk "Select Candidates" shortcut
  ['under_review', 'shortlisted'],
  ['under_review', 'rejected'],
  ['shortlisted', 'selected'],
  ['shortlisted', 'rejected'],
  ['rejected', 'under_review'],
];

const ILLEGAL = [
  ['submitted', 'submitted'],
  ['under_review', 'under_review'],
  ['under_review', 'submitted'],
  ['under_review', 'selected'],
  ['shortlisted', 'submitted'],
  ['shortlisted', 'under_review'],
  ['shortlisted', 'shortlisted'],
  ['rejected', 'shortlisted'],
  ['rejected', 'selected'],
  ['rejected', 'rejected'],
  ['selected', 'submitted'],
  ['selected', 'under_review'],
  ['selected', 'shortlisted'],
  ['selected', 'selected'],
  // hired is terminal (PB-21) — no legal transition ever leaves it.
  ['hired', 'submitted'],
  ['hired', 'under_review'],
  ['hired', 'shortlisted'],
  ['hired', 'rejected'],
  ['hired', 'selected'],
  ['hired', 'hired'],
];

// PB-21: the Hiring Manager's audited decision is the only path that ever
// exercises these — see hiringDecision.service.js. Legal here (the shared
// state machine), even though application.service.js's ordinary HR status
// endpoint independently refuses 'hired' regardless of what this allows.
const NEW_HIRING_DECISION_TRANSITIONS = [
  ['selected', 'hired'],
  ['selected', 'rejected'],
];

test('canTransition allows every legal transition', () => {
  for (const [from, to] of LEGAL) {
    assert.equal(canTransition(from, to), true, `${from} -> ${to} should be legal`);
  }
});

test('canTransition rejects every illegal transition, including same-state', () => {
  for (const [from, to] of ILLEGAL) {
    assert.equal(canTransition(from, to), false, `${from} -> ${to} should be illegal`);
  }
});

test('canTransition rejects an unknown current status (fails closed)', () => {
  assert.equal(canTransition('archived', 'under_review'), false);
});

test('canTransition allows the new PB-21 hiring-decision transitions', () => {
  for (const [from, to] of NEW_HIRING_DECISION_TRANSITIONS) {
    assert.equal(canTransition(from, to), true, `${from} -> ${to} should be legal`);
  }
});

// --- validateStatusChange -----------------------------------------------

test('accepts a legal transition with no note', () => {
  const { valid, errors, value } = validateStatusChange({ current: 'submitted', next: 'shortlisted' });
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.equal(value.next, 'shortlisted');
  assert.equal(value.hr_note, '');
});

test('accepts a legal transition with a trimmed note', () => {
  const { valid, value } = validateStatusChange({
    current: 'shortlisted',
    next: 'selected',
    hr_note: '  Strong technical interview.  ',
  });
  assert.equal(valid, true);
  assert.equal(value.hr_note, 'Strong technical interview.');
});

test('rejects an unknown status value', () => {
  const { valid, errors } = validateStatusChange({ current: 'submitted', next: 'archived' });
  assert.equal(valid, false);
  assert.match(errors.status, /unknown/i);
  assert.equal(errors.transition, undefined);
});

test('rejects a same-state change as an illegal transition, not a validation error', () => {
  const { valid, errors } = validateStatusChange({ current: 'submitted', next: 'submitted' });
  assert.equal(valid, false);
  assert.equal(errors.status, undefined);
  assert.match(errors.transition, /not allowed/i);
});

test('rejects an illegal but known-status transition', () => {
  const { valid, errors } = validateStatusChange({ current: 'rejected', next: 'selected' });
  assert.equal(valid, false);
  assert.match(errors.transition, /not allowed/i);
});

test('rejects a non-string hr_note', () => {
  const { valid, errors } = validateStatusChange({ current: 'submitted', next: 'rejected', hr_note: 42 });
  assert.equal(valid, false);
  assert.match(errors.hr_note, /text/i);
});

test('rejects an hr_note over 1000 characters', () => {
  const { valid, errors } = validateStatusChange({
    current: 'submitted',
    next: 'rejected',
    hr_note: 'a'.repeat(1001),
  });
  assert.equal(valid, false);
  assert.match(errors.hr_note, /1000/);
});

test('accepts an hr_note at exactly 1000 characters', () => {
  const { valid, value } = validateStatusChange({
    current: 'submitted',
    next: 'rejected',
    hr_note: 'a'.repeat(1000),
  });
  assert.equal(valid, true);
  assert.equal(value.hr_note.length, 1000);
});

test('treats an absent or empty hr_note as no note', () => {
  for (const hr_note of [undefined, null, '', '   ']) {
    const { valid, value } = validateStatusChange({ current: 'submitted', next: 'rejected', hr_note });
    assert.equal(valid, true);
    assert.equal(value.hr_note, '');
  }
});
