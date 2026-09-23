const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RATING_FIELDS,
  validateEvaluationInput,
  computeOverallRating,
} = require('../src/utils/evaluationValidation');

function validBody(overrides = {}) {
  return {
    technical_rating: 4,
    problem_solving_rating: 4,
    communication_rating: 4,
    role_knowledge_rating: 4,
    comments: 'Solid candidate.',
    ...overrides,
  };
}

// --- validateEvaluationInput: ratings ---------------------------------------

test('accepts a fully valid body', () => {
  const { valid, errors, value } = validateEvaluationInput(validBody());
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.equal(value.technical_rating, 4);
  assert.equal(value.problem_solving_rating, 4);
  assert.equal(value.communication_rating, 4);
  assert.equal(value.role_knowledge_rating, 4);
  assert.equal(value.comments, 'Solid candidate.');
});

for (const field of RATING_FIELDS) {
  test(`rejects a string rating ("4") for ${field}`, () => {
    const { valid, errors } = validateEvaluationInput(validBody({ [field]: '4' }));
    assert.equal(valid, false);
    assert.ok(errors[field]);
  });

  test(`rejects a non-integer rating (4.5) for ${field}`, () => {
    const { valid, errors } = validateEvaluationInput(validBody({ [field]: 4.5 }));
    assert.equal(valid, false);
    assert.ok(errors[field]);
  });

  test(`rejects a rating of 0 for ${field}`, () => {
    const { valid, errors } = validateEvaluationInput(validBody({ [field]: 0 }));
    assert.equal(valid, false);
    assert.ok(errors[field]);
  });

  test(`rejects a rating of 6 for ${field}`, () => {
    const { valid, errors } = validateEvaluationInput(validBody({ [field]: 6 }));
    assert.equal(valid, false);
    assert.ok(errors[field]);
  });

  test(`rejects a null rating for ${field}`, () => {
    const { valid, errors } = validateEvaluationInput(validBody({ [field]: null }));
    assert.equal(valid, false);
    assert.ok(errors[field]);
  });

  test(`rejects a missing rating for ${field}`, () => {
    const body = validBody();
    delete body[field];
    const { valid, errors } = validateEvaluationInput(body);
    assert.equal(valid, false);
    assert.ok(errors[field]);
  });

  test(`accepts ratings at the boundaries (1 and 5) for ${field}`, () => {
    assert.equal(validateEvaluationInput(validBody({ [field]: 1 })).valid, true);
    assert.equal(validateEvaluationInput(validBody({ [field]: 5 })).valid, true);
  });
}

test('reports every invalid rating field at once', () => {
  const { valid, errors } = validateEvaluationInput(
    validBody({ technical_rating: 0, problem_solving_rating: 6 })
  );
  assert.equal(valid, false);
  assert.ok(errors.technical_rating);
  assert.ok(errors.problem_solving_rating);
  assert.ok(!errors.communication_rating);
  assert.ok(!errors.role_knowledge_rating);
});

// --- validateEvaluationInput: comments --------------------------------------

test('comments are optional', () => {
  const body = validBody();
  delete body.comments;
  const { valid, errors, value } = validateEvaluationInput(body);
  assert.equal(valid, true);
  assert.equal(errors.comments, undefined);
  assert.equal(value.comments, '');
});

test('comments are trimmed', () => {
  const { value } = validateEvaluationInput(validBody({ comments: '  looks good  ' }));
  assert.equal(value.comments, 'looks good');
});

test('accepts comments at exactly the 4000-character limit', () => {
  const { valid, errors } = validateEvaluationInput(validBody({ comments: 'a'.repeat(4000) }));
  assert.equal(valid, true);
  assert.equal(errors.comments, undefined);
});

test('rejects comments over the 4000-character limit', () => {
  const { valid, errors } = validateEvaluationInput(validBody({ comments: 'a'.repeat(4001) }));
  assert.equal(valid, false);
  assert.ok(errors.comments);
});

// --- validateEvaluationInput: overall_rating is never read from the client -

test('a client-supplied overall_rating is ignored entirely', () => {
  const { value } = validateEvaluationInput(validBody({ overall_rating: 1 }));
  assert.equal(value.overall_rating, undefined);
});

// --- computeOverallRating ----------------------------------------------------

test('computeOverallRating averages four equal ratings', () => {
  assert.equal(computeOverallRating([4, 4, 4, 4]), 4);
});

test('computeOverallRating rounds to two decimals: 4,5,4,4 -> 4.25', () => {
  assert.equal(computeOverallRating([4, 5, 4, 4]), 4.25);
});

test('computeOverallRating rounds to two decimals: 4,4,5,4 -> 4.25', () => {
  assert.equal(computeOverallRating([4, 4, 5, 4]), 4.25);
});

test('computeOverallRating rounds to two decimals: 5,4,4,4 -> 4.25', () => {
  assert.equal(computeOverallRating([5, 4, 4, 4]), 4.25);
});

test('computeOverallRating rounds to two decimals: 3,3,3,4 -> 3.25', () => {
  assert.equal(computeOverallRating([3, 3, 3, 4]), 3.25);
});

test('computeOverallRating handles the extremes', () => {
  assert.equal(computeOverallRating([1, 1, 1, 1]), 1);
  assert.equal(computeOverallRating([5, 5, 5, 5]), 5);
});
