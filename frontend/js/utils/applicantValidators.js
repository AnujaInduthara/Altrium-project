// Pure applicant form-validation helpers — no DOM. Mirrors the server rules in
// backend/src/utils/applicationValidation.js. Client validation is a UX aid
// only; the backend re-validates everything, including the CV bytes.

import { isEmail, isBlank } from './validators.js';

export const APPLICANT_LIMITS = {
  fullNameMin: 2,
  fullNameMax: 120,
  emailMax: 254,
  phoneMinDigits: 7,
  phoneMaxDigits: 15,
  phoneMax: 30,
  locationMin: 2,
  locationMax: 120,
};

export const CV_EXTENSIONS = ['pdf', 'docx'];

export const CV_ACCEPT = [
  '.pdf',
  '.docx',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

const PHONE_SHAPE = /^[+(]?[\d\s().+-]+$/;

// values: { full_name, email, phone, location }
// Returns a { field: message } map of the first error per field, or {} if valid.
export function validateApplicantForm(values) {
  const errors = {};

  const name = String(values.full_name || '').trim().replace(/\s+/g, ' ');
  const email = String(values.email || '').trim();
  const phone = String(values.phone || '').trim().replace(/\s+/g, ' ');
  const location = String(values.location || '').trim().replace(/\s+/g, ' ');

  if (isBlank(name) || name.length < APPLICANT_LIMITS.fullNameMin) {
    errors.full_name = 'Please enter your full name.';
  } else if (name.length > APPLICANT_LIMITS.fullNameMax) {
    errors.full_name = `Full name must be ${APPLICANT_LIMITS.fullNameMax} characters or fewer.`;
  }

  if (isBlank(email)) {
    errors.email = 'Please enter your email address.';
  } else if (email.length > APPLICANT_LIMITS.emailMax || !isEmail(email)) {
    errors.email = 'Please enter a valid email address.';
  }

  const phoneDigits = (phone.match(/\d/g) || []).length;
  if (isBlank(phone)) {
    errors.phone = 'Please enter your phone number.';
  } else if (
    phone.length > APPLICANT_LIMITS.phoneMax ||
    !PHONE_SHAPE.test(phone) ||
    phoneDigits < APPLICANT_LIMITS.phoneMinDigits ||
    phoneDigits > APPLICANT_LIMITS.phoneMaxDigits
  ) {
    errors.phone = 'Please enter a valid phone number.';
  }

  if (isBlank(location) || location.length < APPLICANT_LIMITS.locationMin) {
    errors.location = 'Please enter your location.';
  } else if (location.length > APPLICANT_LIMITS.locationMax) {
    errors.location = `Location must be ${APPLICANT_LIMITS.locationMax} characters or fewer.`;
  }

  return errors;
}

// Returns an error message string, or null when the file looks acceptable.
export function validateCvFile(file, maxBytes) {
  if (!file) return 'Please upload your CV.';

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!CV_EXTENSIONS.includes(ext)) {
    return 'Please upload your CV as a PDF or DOCX file.';
  }
  if (file.size === 0) {
    return 'The selected file appears to be empty.';
  }
  if (maxBytes && file.size > maxBytes) {
    return 'Your CV exceeds the maximum allowed file size.';
  }
  return null;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
