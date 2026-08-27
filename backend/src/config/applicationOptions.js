require('dotenv').config();

// Canonical limits and accepted file types for an applicant CV submission
// (PB-03). The backend is the single source of truth: it re-validates every
// field and the uploaded file against these values, so the client can never
// widen what is accepted. The frontend mirrors the human-facing numbers in
// frontend/js/utils/applicantValidators.js + frontend/js/config.js.

const MiB = 1024 * 1024;

// Configurable via env so the limit lives in one place, not scattered through
// the code. Falls back to 5 MiB, which also matches the storage bucket's
// file_size_limit in sql/004_create_applications.sql.
const parsedMax = Number.parseInt(process.env.CV_MAX_BYTES, 10);
const CV_MAX_BYTES = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 5 * MiB;

// Accepted CV types. `mime` is what the browser must claim; `ext` is the only
// filename extension allowed for that type; `magic` lists acceptable leading
// byte signatures (verified server-side — the browser's MIME type is not
// trusted on its own).
const CV_TYPES = Object.freeze({
  'application/pdf': {
    ext: 'pdf',
    // "%PDF-"
    magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    // ZIP local-file / empty-archive / spanned-archive headers ("PK..")
    magic: [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
      [0x50, 0x4b, 0x07, 0x08],
    ],
  },
});

const CV_EXTENSIONS = Object.freeze(Object.values(CV_TYPES).map((t) => t.ext));

// PB-03 only ever creates 'submitted'. The rest are defined in the DB check
// constraint for later backlog items.
const APPLICATION_STATUS = Object.freeze({ SUBMITTED: 'submitted' });

const LIMITS = Object.freeze({
  FULL_NAME_MIN: 2,
  FULL_NAME_MAX: 120,
  EMAIL_MAX: 254,
  PHONE_MIN_DIGITS: 7,
  PHONE_MAX_DIGITS: 15,
  PHONE_MAX: 30,
  LOCATION_MIN: 2,
  LOCATION_MAX: 120,
  CV_MAX_BYTES,
});

// A repeat submission of the same (vacancy, email) within this window is
// treated as an accidental double-submit and rejected with a friendly 409,
// rather than silently creating a duplicate record.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

const CV_BUCKET = 'candidate-cvs';

module.exports = {
  CV_TYPES,
  CV_EXTENSIONS,
  CV_MAX_BYTES,
  APPLICATION_STATUS,
  LIMITS,
  DUPLICATE_WINDOW_MS,
  CV_BUCKET,
};
