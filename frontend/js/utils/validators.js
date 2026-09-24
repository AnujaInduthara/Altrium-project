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

const MIN_PASSWORD_LENGTH = 8;

// Returns a { field: message } map of the first error per field, or {} if valid.
export function validateSetPasswordForm({ password, confirm }) {
  const errors = {};

  if (isBlank(password)) {
    errors.password = 'Password is required.';
  } else if (String(password).length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (isBlank(confirm)) {
    errors.confirm = 'Please confirm your password.';
  } else if (!errors.password && confirm !== password) {
    errors.confirm = 'Passwords do not match.';
  }

  return errors;
}
