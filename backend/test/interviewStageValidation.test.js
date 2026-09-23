const test = require('node:test');
const assert = require('node:assert/strict');

const { validateInterviewLevel, validateStageList } = require('../src/utils/interviewStageValidation');

function stage(overrides = {}) {
  return {
    stage_name: 'Technical',
    duration_minutes: 60,
    required_interviewers: 1,
    ...overrides,
  };
}

// --- validateInterviewLevel ------------------------------------------------

test('accepts every known interview level', () => {
  for (const level of ['intern', 'junior', 'mid', 'senior']) {
    const { valid, value } = validateInterviewLevel(level);
    assert.equal(valid, true);
    assert.equal(value, level);
  }
});

test('rejects an unknown interview level', () => {
  const { valid, errors } = validateInterviewLevel('lead');
  assert.equal(valid, false);
  assert.match(errors.interview_level, /valid/i);
});

test('rejects a missing/blank interview level', () => {
  for (const level of [undefined, null, '', '   ']) {
    const { valid, errors } = validateInterviewLevel(level);
    assert.equal(valid, false);
    assert.match(errors.interview_level, /valid/i);
  }
});

// --- validateStageList ------------------------------------------------------

test('accepts a well-formed list and renormalises stage_order to 1..n', () => {
  const { valid, errors, value } = validateStageList([
    stage({ stage_name: 'HR/Behavioural' }),
    stage({ stage_name: 'Technical' }),
    stage({ stage_name: 'Final' }),
  ]);
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.deepEqual(
    value.map((s) => s.stage_order),
    [1, 2, 3]
  );
});

test('rejects an empty list', () => {
  const { valid, errors } = validateStageList([]);
  assert.equal(valid, false);
  assert.match(errors.stages, /at least one/i);
});

test('rejects a non-array body', () => {
  for (const raw of [undefined, null, 'x', {}, 42]) {
    const { valid, errors } = validateStageList(raw);
    assert.equal(valid, false);
    assert.match(errors.stages, /at least one/i);
  }
});

test('rejects a list of 11 stages (over the cap of 10)', () => {
  const stages = Array.from({ length: 11 }, () => stage());
  const { valid, errors } = validateStageList(stages);
  assert.equal(valid, false);
  assert.match(errors.stages, /no more than 10/i);
});

test('accepts a list of exactly 10 stages', () => {
  const stages = Array.from({ length: 10 }, () => stage());
  const { valid } = validateStageList(stages);
  assert.equal(valid, true);
});

test('rejects a blank stage name', () => {
  const { valid, errors } = validateStageList([stage({ stage_name: '   ' })]);
  assert.equal(valid, false);
  assert.match(errors['stages.0.stage_name'], /required/i);
});

test('rejects an over-length stage name', () => {
  const { valid, errors } = validateStageList([stage({ stage_name: 'a'.repeat(121) })]);
  assert.equal(valid, false);
  assert.match(errors['stages.0.stage_name'], /120/);
});

test('accepts a stage name at exactly 120 characters', () => {
  const { valid } = validateStageList([stage({ stage_name: 'a'.repeat(120) })]);
  assert.equal(valid, true);
});

test('rejects out-of-range durations', () => {
  for (const duration_minutes of [14, 481, 0, -10, 'sixty', null]) {
    const { valid, errors } = validateStageList([stage({ duration_minutes })]);
    assert.equal(valid, false);
    assert.match(errors['stages.0.duration_minutes'], /duration/i);
  }
});

test('accepts durations at the boundaries (15 and 480)', () => {
  for (const duration_minutes of [15, 480]) {
    const { valid } = validateStageList([stage({ duration_minutes })]);
    assert.equal(valid, true);
  }
});

test('rejects out-of-range interviewer counts', () => {
  for (const required_interviewers of [0, 6, -1, 'two', null]) {
    const { valid, errors } = validateStageList([stage({ required_interviewers })]);
    assert.equal(valid, false);
    assert.match(errors['stages.0.required_interviewers'], /interviewers/i);
  }
});

test('accepts interviewer counts at the boundaries (1 and 5)', () => {
  for (const required_interviewers of [1, 5]) {
    const { valid } = validateStageList([stage({ required_interviewers })]);
    assert.equal(valid, true);
  }
});

test('rejects an unknown department', () => {
  const { valid, errors } = validateStageList([stage({ department: 'Not A Real Dept' })]);
  assert.equal(valid, false);
  assert.match(errors['stages.0.department'], /department/i);
});

test('accepts a known department, and treats an absent one as null', () => {
  const withDept = validateStageList([stage({ department: 'Engineering' })]);
  assert.equal(withDept.valid, true);
  assert.equal(withDept.value[0].department, 'Engineering');

  const without = validateStageList([stage()]);
  assert.equal(without.valid, true);
  assert.equal(without.value[0].department, null);
});

test('rejects an unknown minimum_seniority', () => {
  const { valid, errors } = validateStageList([stage({ minimum_seniority: 'principal' })]);
  assert.equal(valid, false);
  assert.match(errors['stages.0.minimum_seniority'], /seniority/i);
});

test('accepts a known minimum_seniority, and treats an absent one as null', () => {
  const withLevel = validateStageList([stage({ minimum_seniority: 'senior' })]);
  assert.equal(withLevel.valid, true);
  assert.equal(withLevel.value[0].minimum_seniority, 'senior');

  const without = validateStageList([stage()]);
  assert.equal(without.valid, true);
  assert.equal(without.value[0].minimum_seniority, null);
});

test('rejects an invalid id or stage_id', () => {
  const { valid, errors } = validateStageList([stage({ id: 'not-a-uuid', stage_id: 'also-not-a-uuid' })]);
  assert.equal(valid, false);
  assert.ok(errors['stages.0.id']);
  assert.ok(errors['stages.0.stage_id']);
});

test('accepts a valid uuid id and stage_id and passes them through', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const stageId = '22222222-2222-2222-2222-222222222222';
  const { valid, value } = validateStageList([stage({ id, stage_id: stageId })]);
  assert.equal(valid, true);
  assert.equal(value[0].id, id);
  assert.equal(value[0].stage_id, stageId);
});

test('renormalises stage_order to contiguous 1..n regardless of what the caller sent, and ignores duplicates/gaps', () => {
  const { valid, value } = validateStageList([
    stage({ stage_name: 'First', stage_order: 99 }),
    stage({ stage_name: 'Second', stage_order: 1 }),
    stage({ stage_name: 'Third', stage_order: 1 }),
  ]);
  assert.equal(valid, true);
  assert.deepEqual(
    value.map((s) => [s.stage_name, s.stage_order]),
    [
      ['First', 1],
      ['Second', 2],
      ['Third', 3],
    ]
  );
});

test('collects errors across multiple stages independently', () => {
  const { valid, errors } = validateStageList([
    stage({ stage_name: '' }),
    stage({ duration_minutes: 999 }),
  ]);
  assert.equal(valid, false);
  assert.ok(errors['stages.0.stage_name']);
  assert.ok(errors['stages.1.duration_minutes']);
});
