// A provider-agnostic error type. Every AI provider implementation maps its
// SDK's failures onto one of these so the screening service can decide whether
// to retry without knowing which provider is in use.

const AI_ERROR = Object.freeze({
  NOT_CONFIGURED: 'AI_NOT_CONFIGURED', // missing key / unknown provider — not retryable
  TIMEOUT: 'AI_TIMEOUT', // request timed out — retryable
  RATE_LIMITED: 'AI_RATE_LIMITED', // 429 — retryable with backoff
  PROVIDER_ERROR: 'AI_PROVIDER_ERROR', // 5xx / network — retryable
  BAD_REQUEST: 'AI_BAD_REQUEST', // 4xx we caused — not retryable
  EMPTY_RESPONSE: 'AI_EMPTY_RESPONSE', // provider returned no text — retryable once
});

class AIProviderError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message);
    this.name = 'AIProviderError';
    this.isAIProviderError = true;
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

module.exports = { AIProviderError, AI_ERROR };
