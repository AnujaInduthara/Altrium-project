// Server-side validation for a PB-03 applicant submission. This is the security
// boundary — the client validates too, but nothing here trusts that, and
// nothing here trusts the browser-supplied MIME type or filename.
//
//   validateApplicationInput(body) -> { valid, errors, value }
//     errors : { field: message } map (empty when valid)
//     value  : cleaned/trimmed/normalized fields ready to persist
//
//   validateCvFile(file) -> { valid: true, ext, contentType }
//                        |  { valid: false, status, code, message }

const { LIMITS, CV_TYPES, CV_EXTENSIONS } = require('../config/applicationOptions');

const UNSUPPORTED_CV_MESSAGE = 'Please upload your CV as a PDF or DOCX file.';

// Deliberately permissive: an applicant's name/email/phone is not a place to be
// clever with regexes. We only reject the clearly-invalid.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE_RE = /^[+(]?[\d\s().+-]+$/;

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ');
}

function validateApplicationInput(body = {}) {
  const errors = {};

  const full_name = collapseWhitespace(asTrimmedString(body.full_name));
  const emailInput = asTrimmedString(body.email);
  const email = emailInput.toLowerCase();
  const phone = collapseWhitespace(asTrimmedString(body.phone));
  const location = collapseWhitespace(asTrimmedString(body.location));

  if (!full_name || full_name.length < LIMITS.FULL_NAME_MIN) {
    errors.full_name = 'Please enter your full name.';
  } else if (full_name.length > LIMITS.FULL_NAME_MAX) {
    errors.full_name = `Full name must be ${LIMITS.FULL_NAME_MAX} characters or fewer.`;
  }

  if (!emailInput) {
    errors.email = 'Please enter your email address.';
  } else if (emailInput.length > LIMITS.EMAIL_MAX || !EMAIL_RE.test(emailInput)) {
    errors.email = 'Please enter a valid email address.';
  }

  const phoneDigits = (phone.match(/\d/g) || []).length;
  if (!phone) {
    errors.phone = 'Please enter your phone number.';
  } else if (
    phone.length > LIMITS.PHONE_MAX ||
    !PHONE_SHAPE_RE.test(phone) ||
    phoneDigits < LIMITS.PHONE_MIN_DIGITS ||
    phoneDigits > LIMITS.PHONE_MAX_DIGITS
  ) {
    errors.phone = 'Please enter a valid phone number.';
  }

  if (!location || location.length < LIMITS.LOCATION_MIN) {
    errors.location = 'Please enter your location.';
  } else if (location.length > LIMITS.LOCATION_MAX) {
    errors.location = `Location must be ${LIMITS.LOCATION_MAX} characters or fewer.`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { full_name, email, phone, location },
  };
}

function fail(status, code, message) {
  return { valid: false, status, code, message };
}

function startsWith(buffer, signature) {
  if (!buffer || buffer.length < signature.length) return false;
  return signature.every((byte, i) => buffer[i] === byte);
}

// Verifies the uploaded file as far as is practical without parsing it:
//   - a non-empty buffer within the size limit
//   - a claimed MIME type we accept, with the matching extension
//   - leading magic bytes that match that type
//   - for DOCX, that it is really an OOXML ZIP (contains "[Content_Types].xml")
function validateCvFile(file) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    return fail(400, 'CV_REQUIRED', 'Please upload your CV.');
  }
  if (file.size > LIMITS.CV_MAX_BYTES) {
    return fail(413, 'CV_TOO_LARGE', 'Your CV exceeds the maximum allowed file size.');
  }

  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  const typeDef = CV_TYPES[file.mimetype];

  if (!typeDef || !CV_EXTENSIONS.includes(ext) || typeDef.ext !== ext) {
    return fail(415, 'CV_UNSUPPORTED_TYPE', UNSUPPORTED_CV_MESSAGE);
  }

  const magicOk = typeDef.magic.some((sig) => startsWith(file.buffer, sig));
  if (!magicOk) {
    return fail(415, 'CV_UNSUPPORTED_TYPE', UNSUPPORTED_CV_MESSAGE);
  }

  if (ext === 'docx' && !file.buffer.includes(Buffer.from('[Content_Types].xml'))) {
    return fail(415, 'CV_UNSUPPORTED_TYPE', UNSUPPORTED_CV_MESSAGE);
  }

  return { valid: true, ext, contentType: file.mimetype };
}

module.exports = {
  validateApplicationInput,
  validateCvFile,
  UNSUPPORTED_CV_MESSAGE,
};
