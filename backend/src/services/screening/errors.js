const { ERROR_CODES } = require('../../config/screeningOptions');

// A typed screening failure. `code` is always one of screeningOptions.ERROR_CODES
// (a safe category), `message` is safe to log but is NOT shown to HR verbatim —
// PB-06 maps the code to its own wording. Raw provider/storage errors are only
// ever attached as `cause` and are never persisted.
class ScreeningError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message);
    this.name = 'ScreeningError';
    this.isScreeningError = true;
    this.code = ERROR_CODES[code] ? code : ERROR_CODES.UNKNOWN_ERROR;
    if (cause) this.cause = cause;
  }
}

module.exports = { ScreeningError };
