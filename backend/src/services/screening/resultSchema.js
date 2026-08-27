const {
  RECOMMENDATIONS,
  EXPERIENCE_MATCH,
  EDUCATION_MATCH,
  CANDIDATE_NAME_MAX_CHARS,
  SUMMARY_MAX_CHARS,
  SKILL_MAX_CHARS,
  MAX_SKILLS,
  EVIDENCE_MAX_ITEMS,
  EVIDENCE_VALUE_MAX_CHARS,
  recommendationFromScore,
} = require('../../config/screeningOptions');
const { computeScore, clampScore } = require('./scoring');

// Validates and normalizes the AI provider's output before ANY of it is
// persisted. The model's response is untrusted:
//   - structural problems (not an object, no usable score, no summary) -> invalid
//   - out-of-range / wrong-typed scalars                                -> invalid
//   - bad enum values, over-long strings, non-array skill lists         -> normalized
//
//   parseAndValidate(rawText) -> { valid, value, errors }
//
// `value` (when valid) is the exact object shape the screening row stores.

function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();

  // Fast path: the whole response is JSON.
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  } catch {
    /* fall through to brace scan */
  }

  // Otherwise, scan for the first balanced { ... } (ignoring braces in strings).
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

function cleanString(value, maxLen) {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen).trim() : collapsed;
}

function normalizeSkillList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const s = cleanString(typeof item === 'string' ? item : '', SKILL_MAX_CHARS);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SKILLS) break;
  }
  return out;
}

function normalizeEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return allowed.includes(upper) ? upper : fallback;
}

function normalizeEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(value)) {
    if (count >= EVIDENCE_MAX_ITEMS) break;
    const key = cleanString(k, 120);
    const val = cleanString(typeof v === 'string' ? v : JSON.stringify(v), EVIDENCE_VALUE_MAX_CHARS);
    if (!key || !val) continue;
    out[key] = val;
    count += 1;
  }
  return out;
}

// Accepts a number, or a numeric string; rejects things like "ninety four".
function asNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function parseAndValidate(rawText) {
  const errors = [];
  const raw = extractJsonObject(rawText);
  if (!raw) {
    return { valid: false, value: null, errors: ['Response was not a single JSON object.'] };
  }

  const dimensions = {
    skills: asNumberOrNull(raw.skills_score),
    experience: asNumberOrNull(raw.experience_score),
    requirements: asNumberOrNull(raw.requirements_score),
    education: asNumberOrNull(raw.education_score),
  };

  // Any dimension that is present but out of the 0-100 range is a hard reject
  // (matches the spec: a score of 120 invalidates the result).
  for (const [name, n] of Object.entries(dimensions)) {
    if (n !== null && (n < 0 || n > 100)) {
      errors.push(`${name}_score out of range: ${n}`);
    }
  }

  const rawOverall = asNumberOrNull(raw.overall_score);
  if (raw.overall_score !== undefined && rawOverall === null) {
    errors.push('overall_score was not a number.');
  }
  if (rawOverall !== null && (rawOverall < 0 || rawOverall > 100)) {
    errors.push(`overall_score out of range: ${rawOverall}`);
  }

  const summary = cleanString(raw.summary, SUMMARY_MAX_CHARS);
  if (!summary) {
    errors.push('summary was missing or empty.');
  }

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  const { score, breakdown } = computeScore(dimensions, rawOverall);
  if (score === null) {
    return {
      valid: false,
      value: null,
      errors: ['No usable score: all dimension scores and overall_score were missing.'],
    };
  }

  const recommendation =
    normalizeEnum(raw.recommendation, RECOMMENDATIONS, null) || recommendationFromScore(score);
  const experienceMatch = normalizeEnum(raw.experience_match, EXPERIENCE_MATCH, 'INSUFFICIENT_INFORMATION');
  const educationMatch = normalizeEnum(raw.education_match, EDUCATION_MATCH, 'INSUFFICIENT_INFORMATION');

  const value = {
    candidate_name: cleanString(raw.candidate_name, CANDIDATE_NAME_MAX_CHARS) || null,
    skills: normalizeSkillList(raw.skills),
    matched_skills: normalizeSkillList(raw.matched_skills),
    missing_skills: normalizeSkillList(raw.missing_skills),
    experience_match: experienceMatch,
    education_match: educationMatch,
    score,
    recommendation,
    summary,
    score_breakdown: breakdown,
    evidence: normalizeEvidence(raw.evidence),
  };

  return { valid: true, value, errors: [] };
}

module.exports = { parseAndValidate, extractJsonObject, clampScore };
