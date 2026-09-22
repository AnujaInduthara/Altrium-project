// Pure, DB-free validation for the PB-11/PB-12 "replace stage list" request
// and the PB-09 "choose interview level" request. No Supabase, no Express.
//
//   validateInterviewLevel(level) -> { valid, errors, value }
//   validateStageList(stages)     -> { valid, errors, value }

const { DEPARTMENTS } = require('../config/vacancyOptions');
const { SENIORITY_LEVELS } = require('../config/seniority');
const { INTERVIEW_LEVELS, LIMITS } = require('../config/interviewProcessOptions');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function validateInterviewLevel(level) {
  const value = typeof level === 'string' ? level.trim() : '';
  const errors = {};
  if (!value || !INTERVIEW_LEVELS.includes(value)) {
    errors.interview_level = 'Select a valid interview level.';
  }
  return { valid: Object.keys(errors).length === 0, errors, value };
}

// One stage item. `id` optionally identifies the existing
// candidate_interview_stage row this item edits (present when the caller is
// keeping/editing a stage the GET returned; absent for a brand-new stage) —
// this is what lets the service detect a locked stage being removed or
// reordered in a full-list replace. `stage_id` is the separate, optional
// catalogue (interview_stages) reference.
function validateStage(raw, index) {
  const errors = {};
  const label = `Stage ${index + 1}`;

  let id = null;
  if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
    if (!isUuid(raw.id)) errors[`stages.${index}.id`] = `${label}: invalid id.`;
    else id = raw.id;
  }

  let stageId = null;
  if (raw.stage_id !== undefined && raw.stage_id !== null && raw.stage_id !== '') {
    if (!isUuid(raw.stage_id)) errors[`stages.${index}.stage_id`] = `${label}: invalid stage_id.`;
    else stageId = raw.stage_id;
  }

  const stageName = typeof raw.stage_name === 'string' ? raw.stage_name.trim() : '';
  if (!stageName) {
    errors[`stages.${index}.stage_name`] = `${label}: name is required.`;
  } else if (stageName.length > LIMITS.STAGE_NAME_MAX) {
    errors[`stages.${index}.stage_name`] =
      `${label}: name must be ${LIMITS.STAGE_NAME_MAX} characters or fewer.`;
  }

  const duration = Number(raw.duration_minutes);
  if (!Number.isInteger(duration) || duration < LIMITS.DURATION_MIN || duration > LIMITS.DURATION_MAX) {
    errors[`stages.${index}.duration_minutes`] =
      `${label}: duration must be a whole number of minutes between ${LIMITS.DURATION_MIN} and ${LIMITS.DURATION_MAX}.`;
  }

  const requiredInterviewers = Number(raw.required_interviewers);
  if (
    !Number.isInteger(requiredInterviewers) ||
    requiredInterviewers < LIMITS.REQUIRED_INTERVIEWERS_MIN ||
    requiredInterviewers > LIMITS.REQUIRED_INTERVIEWERS_MAX
  ) {
    errors[`stages.${index}.required_interviewers`] =
      `${label}: number of interviewers must be between ${LIMITS.REQUIRED_INTERVIEWERS_MIN} and ${LIMITS.REQUIRED_INTERVIEWERS_MAX}.`;
  }

  let department = null;
  if (raw.department !== undefined && raw.department !== null && raw.department !== '') {
    const trimmed = typeof raw.department === 'string' ? raw.department.trim() : '';
    if (!DEPARTMENTS.includes(trimmed)) errors[`stages.${index}.department`] = `${label}: select a valid department.`;
    else department = trimmed;
  }

  let minimumSeniority = null;
  if (raw.minimum_seniority !== undefined && raw.minimum_seniority !== null && raw.minimum_seniority !== '') {
    const trimmed = typeof raw.minimum_seniority === 'string' ? raw.minimum_seniority.trim() : '';
    if (!SENIORITY_LEVELS.includes(trimmed)) {
      errors[`stages.${index}.minimum_seniority`] = `${label}: select a valid seniority level.`;
    } else {
      minimumSeniority = trimmed;
    }
  }

  return {
    errors,
    value: {
      id,
      stage_id: stageId,
      stage_name: stageName,
      duration_minutes: duration,
      required_interviewers: requiredInterviewers,
      department,
      minimum_seniority: minimumSeniority,
    },
  };
}

function validateStageList(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return { valid: false, errors: { stages: 'Add at least one interview stage.' }, value: [] };
  }
  if (stages.length > LIMITS.STAGE_LIST_MAX) {
    return {
      valid: false,
      errors: { stages: `Add no more than ${LIMITS.STAGE_LIST_MAX} stages.` },
      value: [],
    };
  }

  const errors = {};
  const value = stages.map((raw, index) => {
    const { errors: stageErrors, value: stageValue } = validateStage(
      raw && typeof raw === 'object' ? raw : {},
      index
    );
    Object.assign(errors, stageErrors);
    return stageValue;
  });

  // Normalise stage_order by array position — the caller can never send
  // duplicates or gaps; the returned value is always contiguous 1..n.
  value.forEach((stage, index) => {
    stage.stage_order = index + 1;
  });

  return { valid: Object.keys(errors).length === 0, errors, value };
}

module.exports = { validateInterviewLevel, validateStageList };
