// Ordered seniority scale (mirrors the profiles_seniority_level_allowed check
// constraint in sql/009_extend_profiles_employees.sql). "Minimum seniority:
// senior" means senior OR ABOVE — that comparison is the one thing this module
// exists to get right and keep tested.

const SENIORITY_LEVELS = Object.freeze(['intern', 'junior', 'mid', 'senior', 'lead']);

// Returns the level's rank (0 = lowest), or null for anything not in
// SENIORITY_LEVELS (unknown value, wrong case, null, undefined, ...).
function seniorityRank(level) {
  const index = SENIORITY_LEVELS.indexOf(level);
  return index === -1 ? null : index;
}

// Fails CLOSED: if either value isn't a recognised level, this returns false
// rather than guessing. An unreadable seniority must never be treated as
// "good enough".
function meetsMinimumSeniority(actual, minimum) {
  const actualRank = seniorityRank(actual);
  const minimumRank = seniorityRank(minimum);
  if (actualRank === null || minimumRank === null) return false;
  return actualRank >= minimumRank;
}

module.exports = { SENIORITY_LEVELS, seniorityRank, meetsMinimumSeniority };
