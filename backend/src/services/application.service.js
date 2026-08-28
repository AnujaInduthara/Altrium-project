const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const {
  APPLICATION_STATUS,
  DUPLICATE_WINDOW_MS,
  CV_BUCKET,
} = require('../config/applicationOptions');
const { partitionSelection } = require('../utils/candidateSelection');

// A typed, HTTP-aware error the controller translates straight to a response
// without leaking internals (mirrors VacancyError in vacancy.service.js).
class ApplicationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ApplicationError';
    this.isApplicationError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

// APP-1A2B3C4D — 8 uppercase hex chars. ~4.3e9 space; the DB unique constraint
// plus a small retry loop make a collision a non-event.
function generateReference() {
  return `APP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Safe, non-guessable storage key. Never derived from the applicant's filename,
// so it cannot collide, traverse paths, or carry a malicious name.
function buildCvPath(vacancyId, ext) {
  return `applications/${vacancyId}/${crypto.randomUUID()}.${ext}`;
}

async function findRecentDuplicate(vacancyId, email) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select('reference')
    .eq('vacancy_id', vacancyId)
    .eq('email', email)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to check for a recent application', error);
  return data || null;
}

async function uploadCv(buffer, { vacancyId, ext, contentType }) {
  const path = buildCvPath(vacancyId, ext);
  const { error } = await supabaseAdmin.storage
    .from(CV_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) throw wrapDbError('Failed to store the CV', error);
  return path;
}

// Best-effort cleanup of an upload we could not attach to a row. Storage +
// Postgres are not one transaction, so this is compensation, not a rollback —
// a failure here is logged and swallowed so the applicant still gets a clean
// error rather than a 500 about storage internals.
async function deleteCvQuietly(path) {
  try {
    const { error } = await supabaseAdmin.storage.from(CV_BUCKET).remove([path]);
    if (error) console.error('Orphaned CV cleanup failed:', path, error.message);
  } catch (err) {
    console.error('Orphaned CV cleanup threw:', path, err.message);
  }
}

async function insertApplicationRow(record) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reference = generateReference();
    const { data, error } = await supabaseAdmin
      .from('applications')
      .insert({ ...record, reference, status: APPLICATION_STATUS.SUBMITTED })
      .select('id, reference, status, created_at')
      .single();

    if (error) {
      if (error.code === '23505') continue; // reference collision — new one, retry
      throw wrapDbError('Failed to create the application', error);
    }
    return data;
  }
  throw new ApplicationError(
    'APPLICATION_FAILED',
    500,
    "We couldn't submit your application right now. Please try again later."
  );
}

// Orchestrates the PB-03 submission: duplicate check -> store CV -> create row,
// cleaning up the stored CV if the row insert fails.
//   vacancy : { id, job_title }  (already confirmed PUBLISHED by the caller)
//   input   : { full_name, email, phone, location }  (already validated)
//   cv      : { buffer, size, originalName, ext, contentType }  (already validated)
async function createApplication({ vacancy, input, cv }) {
  const duplicate = await findRecentDuplicate(vacancy.id, input.email);
  if (duplicate) {
    throw new ApplicationError(
      'DUPLICATE_APPLICATION',
      409,
      'We already have an application from this email address for this position.'
    );
  }

  const cvPath = await uploadCv(cv.buffer, {
    vacancyId: vacancy.id,
    ext: cv.ext,
    contentType: cv.contentType,
  });

  let created;
  try {
    created = await insertApplicationRow({
      vacancy_id: vacancy.id,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      location: input.location,
      cv_path: cvPath,
      cv_original_name: cv.originalName ? String(cv.originalName).slice(0, 255) : null,
      cv_size_bytes: Number.isInteger(cv.size) ? cv.size : null,
      cv_content_type: cv.contentType,
    });
  } catch (err) {
    await deleteCvQuietly(cvPath);
    throw err;
  }

  // PB-05 trigger: once the application + CV are stored, kick off AI screening.
  // Fire-and-forget — it runs after the HTTP response and never blocks or fails
  // the submission. Lazy require avoids a require cycle (the screening service
  // pulls in this module). This is the seam to move to a real background
  // worker/queue later without touching the submission path.
  try {
    require('./screening/screeningService').screenApplicationInBackground(created.id);
  } catch (err) {
    console.error('Failed to start screening for application', created.id, err.message);
  }

  return { reference: created.reference, job_title: vacancy.job_title };
}

// ---------------------------------------------------------------------------
// HR review (list applications for a vacancy, open a CV).
// ---------------------------------------------------------------------------

// Columns safe to return to the HR user who owns the vacancy. `cv_path` is
// deliberately NOT here — the CV is only reachable through a short-lived signed
// URL minted by createCvSignedUrl, never as a raw storage key.
const APPLICATION_HR_FIELDS = [
  'id',
  'reference',
  'full_name',
  'email',
  'phone',
  'location',
  'status',
  'cv_original_name',
  'cv_size_bytes',
  'cv_content_type',
  'created_at',
  'selected_at',
  'selected_by',
].join(', ');

// All applications for one vacancy, newest first. The caller (controller) must
// have already confirmed the vacancy belongs to the requesting HR user.
async function listApplicationsForVacancy(vacancyId) {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select(APPLICATION_HR_FIELDS)
    .eq('vacancy_id', vacancyId)
    .order('created_at', { ascending: false });

  if (error) throw wrapDbError('Failed to list applications', error);
  return data || [];
}

// One application incl. its `vacancy_id` and `cv_path` for the ownership check +
// signed-URL step. Returns null for an unknown / malformed id.
async function getApplicationById(applicationId) {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select(`${APPLICATION_HR_FIELDS}, vacancy_id, cv_path`)
    .eq('id', applicationId)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return null; // invalid uuid -> treat as not found
    throw wrapDbError('Failed to load application', error);
  }
  return data || null;
}

// Minimal application shape the PB-05 screening pipeline needs: the CV location
// and the vacancy to screen against. Returns null for an unknown / malformed id.
async function getApplicationForScreening(applicationId) {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select('id, vacancy_id, cv_path, cv_content_type, cv_original_name, status')
    .eq('id', applicationId)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return null; // invalid uuid -> not found
    throw wrapDbError('Failed to load application for screening', error);
  }
  return data || null;
}

// Server-side private download of a CV from the candidate-cvs bucket. Returns a
// Node Buffer. The CV bytes never leave the backend — they are extracted to text
// and only the text (job-relevant content) is sent to the AI provider.
async function downloadCv(cvPath) {
  const { data, error } = await supabaseAdmin.storage.from(CV_BUCKET).download(cvPath);
  if (error || !data) {
    throw wrapDbError('Failed to download CV', error || new Error('no CV data returned'));
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Short-lived signed URL for a CV in the private bucket. Default 120s — long
// enough to open, short enough that a leaked URL is near-useless. Pass
// `download` (a filename) to force a "save as" instead of inline rendering —
// used for the PB-06 "Download CV" action (and DOCX files, which browsers
// cannot preview inline anyway).
async function createCvSignedUrl(cvPath, { expiresIn = 120, download = null } = {}) {
  const options = download ? { download: String(download).slice(0, 255) } : undefined;
  const { data, error } = await supabaseAdmin.storage
    .from(CV_BUCKET)
    .createSignedUrl(cvPath, expiresIn, options);

  if (error || !data || !data.signedUrl) {
    throw wrapDbError('Failed to create a CV link', error || new Error('no signed url returned'));
  }
  return { url: data.signedUrl, expiresIn };
}

// ---------------------------------------------------------------------------
// PB-07 — HR selects candidates.
// ---------------------------------------------------------------------------

// Minimal (id, status) rows for every application under one vacancy. Used to
// verify that every id in a selection request really belongs to this vacancy
// and is eligible, before any write happens.
async function listApplicationStatusesForVacancy(vacancyId) {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select('id, status')
    .eq('vacancy_id', vacancyId);

  if (error) throw wrapDbError('Failed to load applications for selection', error);
  return data || [];
}

// Transition the given applications 'submitted' -> 'selected' for one vacancy,
// recording the acting HR user and a server timestamp. The caller (controller)
// must already have authenticated the HR user and confirmed they own the
// vacancy.
//
// Safety / correctness:
//   * Every id is checked against the vacancy's own applications first — an id
//     from another vacancy (or a fabricated one) is rejected as
//     INVALID_APPLICATION; a non-eligible status is APPLICATION_NOT_ELIGIBLE.
//   * The UPDATE is a single conditional statement guarded by
//     `.eq('status', 'submitted')`, so it is atomic and idempotent: a duplicate
//     / concurrent submit updates zero rows for an already-selected applicant
//     instead of creating a second "candidate" or erroring.
//   * The AI screening row and the CV are never touched.
async function selectCandidates({ vacancyId, applicationIds, hrUserId }) {
  const vacancyApplications = await listApplicationStatusesForVacancy(vacancyId);
  const { invalid, alreadySelected, ineligible, eligible } = partitionSelection(
    applicationIds,
    vacancyApplications
  );

  if (invalid.length > 0) {
    throw new ApplicationError(
      'INVALID_APPLICATION',
      400,
      'One or more selected applicants are not part of this vacancy.'
    );
  }
  if (ineligible.length > 0) {
    throw new ApplicationError(
      'APPLICATION_NOT_ELIGIBLE',
      409,
      'One or more selected applicants can no longer be selected as candidates.'
    );
  }

  let newlySelected = [];
  if (eligible.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('applications')
      .update({
        status: APPLICATION_STATUS.SELECTED,
        selected_at: new Date().toISOString(),
        selected_by: hrUserId,
      })
      .in('id', eligible)
      .eq('vacancy_id', vacancyId)
      .eq('status', APPLICATION_STATUS.SUBMITTED)
      .select('id');

    if (error) throw wrapDbError('Failed to select candidates', error);
    newlySelected = data || [];
  }

  // Every requested id is now 'selected' (either just transitioned, or already
  // was — the idempotent path). `newlySelectedCount` can be lower than
  // `eligible.length` only under a concurrent duplicate request, which is fine.
  return {
    selectedCount: applicationIds.length,
    newlySelectedCount: newlySelected.length,
    alreadySelectedCount: alreadySelected.length,
  };
}

module.exports = {
  createApplication,
  listApplicationsForVacancy,
  getApplicationById,
  getApplicationForScreening,
  listApplicationStatusesForVacancy,
  selectCandidates,
  downloadCv,
  createCvSignedUrl,
  ApplicationError,
};
