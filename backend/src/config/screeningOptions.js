// Canonical vocabularies, limits and the scoring policy for PB-05 CV screening.
//
// The backend is the single source of truth. The AI provider's output is
// normalized and validated against these values before anything is persisted
// (services/screening/resultSchema.js), and the database repeats the important
// constraints as defence in depth (sql/005_create_application_screenings.sql).

// Screening lifecycle. Independent of applications.status, which stays 'submitted'.
const SCREENING_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

// Advisory recommendation — never hire/reject language.
const RECOMMENDATIONS = Object.freeze([
  'STRONG_MATCH',
  'GOOD_MATCH',
  'PARTIAL_MATCH',
  'WEAK_MATCH',
  'INSUFFICIENT_INFORMATION',
]);

const EXPERIENCE_MATCH = Object.freeze([
  'STRONG',
  'MODERATE',
  'WEAK',
  'NOT_DEMONSTRATED',
  'INSUFFICIENT_INFORMATION',
]);

const EDUCATION_MATCH = Object.freeze([
  'STRONG',
  'MODERATE',
  'WEAK',
  'NOT_APPLICABLE',
  'NOT_DEMONSTRATED',
  'INSUFFICIENT_INFORMATION',
]);

// Safe, non-sensitive error categories stored on a failed screening. A raw
// provider error message is NEVER stored here or shown to HR.
const ERROR_CODES = Object.freeze({
  DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
  CV_EXTRACTION_ERROR: 'CV_EXTRACTION_ERROR',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_TIMEOUT: 'AI_TIMEOUT',
  INVALID_AI_RESPONSE: 'INVALID_AI_RESPONSE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

// Bumped when the prompt or scoring policy changes in a way that makes old and
// new results not directly comparable. Stored on every screening.
const SCREENING_VERSION = 'v1';

// --- CV text handling ------------------------------------------------------

// Below this many readable characters the extraction is treated as a failure
// (scanned/image-only PDF, empty file, garbled encoding). We never invent
// candidate data from an unreadable document.
const CV_TEXT_MIN_CHARS = 200;

// Upper bound on CV text sent to the provider (~6-8k tokens). Large CVs are
// truncated with a marker rather than sent whole; the head of a CV carries the
// summary/skills/most-recent-experience that matter most for screening.
const CV_TEXT_MAX_CHARS = 24_000;

// --- output normalization caps ------------------------------------------

const CANDIDATE_NAME_MAX_CHARS = 160;
const SUMMARY_MAX_CHARS = 1_500;
const SKILL_MAX_CHARS = 80;
const MAX_SKILLS = 60;
const EVIDENCE_MAX_ITEMS = 30;
const EVIDENCE_VALUE_MAX_CHARS = 400;

// --- processing controls -----------------------------------------------

// Total attempts (initial + retries) before a screening stays 'failed' and is
// only re-runnable by an explicit, authorized HR retry.
const MAX_ATTEMPTS = 3;

// Bounded retry/backoff for transient provider failures within one attempt.
const PROVIDER_RETRY = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 800,
  maxDelayMs: 6_000,
});

// --- scoring policy ----------------------------------------------------

// The overall score is recomputed server-side as a weighted sum of the four
// job-relevant dimensions the model rates 0-100. The model's own "overall"
// number is only a fallback when a dimension is missing. Protected/personal
// characteristics are not dimensions and must never influence the score.
//
// Override with AI_SCORE_WEIGHTS (comma-separated
// skills:experience:requirements:education, e.g. "0.4,0.3,0.2,0.1").
function parseWeights() {
  const raw = process.env.AI_SCORE_WEIGHTS;
  const fallback = { skills: 0.4, experience: 0.3, requirements: 0.2, education: 0.1 };
  if (!raw) return fallback;
  const parts = raw.split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) return fallback;
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return fallback;
  return {
    skills: parts[0] / sum,
    experience: parts[1] / sum,
    requirements: parts[2] / sum,
    education: parts[3] / sum,
  };
}

const SCORE_WEIGHTS = Object.freeze(parseWeights());

const SCORE_DIMENSIONS = Object.freeze(['skills', 'experience', 'requirements', 'education']);

// Recommendation buckets used only as a fallback when the model omits or
// mis-formats its recommendation. Advisory, score-derived, never a decision.
function recommendationFromScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'INSUFFICIENT_INFORMATION';
  if (score >= 85) return 'STRONG_MATCH';
  if (score >= 70) return 'GOOD_MATCH';
  if (score >= 50) return 'PARTIAL_MATCH';
  return 'WEAK_MATCH';
}

module.exports = {
  SCREENING_STATUS,
  RECOMMENDATIONS,
  EXPERIENCE_MATCH,
  EDUCATION_MATCH,
  ERROR_CODES,
  SCREENING_VERSION,
  CV_TEXT_MIN_CHARS,
  CV_TEXT_MAX_CHARS,
  CANDIDATE_NAME_MAX_CHARS,
  SUMMARY_MAX_CHARS,
  SKILL_MAX_CHARS,
  MAX_SKILLS,
  EVIDENCE_MAX_ITEMS,
  EVIDENCE_VALUE_MAX_CHARS,
  MAX_ATTEMPTS,
  PROVIDER_RETRY,
  SCORE_WEIGHTS,
  SCORE_DIMENSIONS,
  recommendationFromScore,
};
