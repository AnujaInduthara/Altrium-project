// Pure validation helpers — no DOM, easy to unit test.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (value) => EMAIL_PATTERN.test(value);

export const isBlank = (value) => !value || !String(value).trim();

// Returns a { field: message } map of the first error per field, or {} if valid.
export function validateLoginForm({ email, password }) {
  const errors = {};

  if (isBlank(email)) {
    errors.email = 'Email is required.';
  } else if (!isEmail(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (isBlank(password)) {
    errors.password = 'Password is required.';
  }

  return errors;
}
