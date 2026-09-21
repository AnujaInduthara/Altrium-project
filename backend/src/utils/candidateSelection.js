// Pure, DB-free validation for a PB-07 candidate-selection request. This is the
// security-relevant core: given the raw `applicationIds` from the request body
// and the set of applications that actually belong to the target vacancy, decide
// exactly which ones may transition 'submitted' -> 'selected'.
//
// Nothing here trusts the client: an id the caller sent that is not among the
// vacancy's own applications is rejected outright (it could be an application
// from another vacancy, or a fabricated id).
//
//   normalizeApplicationIds(raw) -> { valid, code?, message?, ids }
//   partitionSelection(ids, vacancyApplications) ->
//     { invalid[], alreadySelected[], ineligible[{id,status}], eligible[] }

const {
  CANDIDATE_SELECTABLE_FROM,
  MAX_CANDIDATE_SELECTION,
  APPLICATION_STATUS,
} = require('../config/applicationOptions');

// Accepts an array of non-empty strings, trims them, drops blanks and
// duplicates, and enforces the batch cap. Order is preserved.
function normalizeApplicationIds(raw) {
  if (!Array.isArray(raw)) {
    return {
      valid: false,
      code: 'INVALID_REQUEST',
      message: 'A list of applicants to select is required.',
      ids: [],
    };
  }

  const seen = new Set();
  const ids = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return {
        valid: false,
        code: 'INVALID_REQUEST',
        message: 'Each selected applicant must be identified by a valid id.',
        ids: [],
      };
    }
    const id = entry.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length === 0) {
    return {
      valid: false,
      code: 'NO_APPLICATIONS_SELECTED',
      message: 'Please select at least one applicant.',
      ids: [],
    };
  }

  if (ids.length > MAX_CANDIDATE_SELECTION) {
    return {
      valid: false,
      code: 'TOO_MANY_APPLICATIONS',
      message: `You can select at most ${MAX_CANDIDATE_SELECTION} applicants at once.`,
      ids: [],
    };
  }

  return { valid: true, ids };
}

// `vacancyApplications` : [{ id, status }, …] — every application row that
// belongs to the target vacancy (already fetched + owner-checked by the caller).
function partitionSelection(ids, vacancyApplications) {
  const byId = new Map((vacancyApplications || []).map((a) => [a.id, a]));

  const invalid = [];
  const alreadySelected = [];
  const ineligible = [];
  const eligible = [];

  for (const id of ids) {
    const application = byId.get(id);
    if (!application) {
      invalid.push(id);
    } else if (application.status === APPLICATION_STATUS.SELECTED) {
      alreadySelected.push(id);
    } else if (!CANDIDATE_SELECTABLE_FROM.includes(application.status)) {
      ineligible.push({ id, status: application.status });
    } else {
      eligible.push(id);
    }
  }

  return { invalid, alreadySelected, ineligible, eligible };
}

module.exports = { normalizeApplicationIds, partitionSelection };
