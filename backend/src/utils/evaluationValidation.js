// PB-19 — pure validation for an interviewer's structured evaluation.
//
//   validateEvaluationInput(body) -> { valid, errors, value }
//     errors : { field: message } map (empty when valid)
//     value  : the four cleaned integer ratings + trimmed comments
//
//   computeOverallRating(ratings) -> mean of the ratings, rounded to 2dp
//
// A client-supplied overall_rating is never read here — the caller
// (evaluation.service.js) always derives it via computeOverallRating(), the
// same principle PB-05 already applies to the AI screening score.

const RATING_FIELDS = [
  'technical_rating',
  'problem_solving_rating',
  'communication_rating',
  'role_knowledge_rating',
];

const RATING_LABELS = {
  technical_rating: 'Technical rating',
  problem_solving_rating: 'Problem solving rating',
  communication_rating: 'Communication rating',
  role_knowledge_rating: 'Role knowledge rating',
};

const COMMENTS_MAX = 4000;

function isValidRating(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function validateEvaluationInput(body = {}) {
  const errors = {};
  const value = {};

  for (const field of RATING_FIELDS) {
    const raw = body[field];
    if (!isValidRating(raw)) {
      errors[field] = `${RATING_LABELS[field]} must be a whole number from 1 to 5.`;
    } else {
      value[field] = raw;
    }
  }

  const comments = typeof body.comments === 'string' ? body.comments.trim() : '';
  if (comments.length > COMMENTS_MAX) {
    errors.comments = `Comments must be ${COMMENTS_MAX} characters or fewer.`;
  } else {
    value.comments = comments;
  }

  return { valid: Object.keys(errors).length === 0, errors, value };
}

// ratings: an array of the four 1..5 integers. Division by 4 is always exact
// in binary floating point (quarters), so this rounds cleanly with no
// precision drift — e.g. [4, 5, 4, 4] -> 4.25, [3, 3, 3, 4] -> 3.25.
function computeOverallRating(ratings) {
  const sum = ratings.reduce((total, r) => total + r, 0);
  return Math.round((sum / ratings.length) * 100) / 100;
}

module.exports = { RATING_FIELDS, validateEvaluationInput, computeOverallRating };
