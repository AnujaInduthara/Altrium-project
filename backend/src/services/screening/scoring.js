const { SCORE_WEIGHTS, SCORE_DIMENSIONS } = require('../../config/screeningOptions');

// Server-side score computation. The final 0-100 screening score is NOT taken
// verbatim from the model — it is recomputed here from the four job-relevant
// dimension sub-scores using documented, configurable weights
// (screeningOptions.SCORE_WEIGHTS). The model's own "overall" is only a
// fallback when a dimension is unusable.

function clampScore(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// dimensions: { skills, experience, requirements, education } — each a number or null.
// modelOverall: the model's self-reported overall (number or null).
function computeScore(dimensions = {}, modelOverall = null) {
  const clamped = {};
  for (const dim of SCORE_DIMENSIONS) {
    clamped[dim] = clampScore(dimensions[dim]);
  }

  const haveAll = SCORE_DIMENSIONS.every((dim) => clamped[dim] !== null);

  let score;
  let method;
  if (haveAll) {
    const weighted =
      clamped.skills * SCORE_WEIGHTS.skills +
      clamped.experience * SCORE_WEIGHTS.experience +
      clamped.requirements * SCORE_WEIGHTS.requirements +
      clamped.education * SCORE_WEIGHTS.education;
    score = clampScore(weighted);
    method = 'weighted';
  } else {
    score = clampScore(modelOverall);
    method = 'model_reported';
  }

  return {
    score, // may be null if nothing usable — caller treats that as invalid
    breakdown: {
      dimensions: clamped,
      model_overall: clampScore(modelOverall),
      weights: SCORE_WEIGHTS,
      method,
    },
  };
}

module.exports = { computeScore, clampScore };
