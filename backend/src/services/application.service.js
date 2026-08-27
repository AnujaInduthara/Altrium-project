const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const {
  APPLICATION_STATUS,
  DUPLICATE_WINDOW_MS,
  CV_BUCKET,
} = require('../config/applicationOptions');

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

  return { reference: created.reference, job_title: vacancy.job_title };
}

module.exports = { createApplication, ApplicationError };
