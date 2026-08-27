const Anthropic = require('@anthropic-ai/sdk');
const {
  AI_MODEL,
  AI_MAX_OUTPUT_TOKENS,
  AI_EFFORT,
  AI_REQUEST_TIMEOUT_MS,
  ANTHROPIC_API_KEY,
} = require('../../config/aiOptions');
const { AIProviderError, AI_ERROR } = require('./errors');

// Anthropic implementation of the AI provider contract. The rest of the app
// never imports @anthropic-ai/sdk directly — it goes through services/ai.

let client = null;
function getClient() {
  if (!ANTHROPIC_API_KEY) {
    throw new AIProviderError(AI_ERROR.NOT_CONFIGURED, 'ANTHROPIC_API_KEY is not set.');
  }
  if (!client) {
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 0 });
  }
  return client;
}

function mapError(err) {
  if (err && err.isAIProviderError) return err;

  // Anthropic SDK typed errors carry a numeric `status`.
  const status = err && typeof err.status === 'number' ? err.status : null;
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIProviderError(AI_ERROR.TIMEOUT, 'The AI request timed out.', { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.RateLimitError || status === 429) {
    return new AIProviderError(AI_ERROR.RATE_LIMITED, 'The AI provider is rate limiting requests.', { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError || (status && status >= 500)) {
    return new AIProviderError(AI_ERROR.PROVIDER_ERROR, 'The AI provider returned a server error.', { retryable: true, cause: err });
  }
  if (status && status >= 400) {
    return new AIProviderError(AI_ERROR.BAD_REQUEST, `The AI request was rejected (${status}).`, { retryable: false, cause: err });
  }
  return new AIProviderError(AI_ERROR.PROVIDER_ERROR, 'The AI request failed.', { retryable: true, cause: err });
}

function createAnthropicProvider() {
  return {
    name: 'anthropic',
    model: AI_MODEL,

    // Runs one completion. `system` and `user` are plain strings built by the
    // screening prompt module. Returns { text } — raw model text, to be parsed
    // and validated by the caller (never trusted as-is).
    async complete({ system, user }) {
      let response;
      try {
        response = await getClient().messages.create(
          {
            model: AI_MODEL,
            max_tokens: AI_MAX_OUTPUT_TOKENS,
            output_config: { effort: AI_EFFORT },
            system,
            messages: [{ role: 'user', content: user }],
          },
          { timeout: AI_REQUEST_TIMEOUT_MS }
        );
      } catch (err) {
        throw mapError(err);
      }

      if (response && response.stop_reason === 'refusal') {
        throw new AIProviderError(
          AI_ERROR.BAD_REQUEST,
          'The AI provider declined to process this screening request.',
          { retryable: false }
        );
      }

      const text = (response.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      if (!text) {
        throw new AIProviderError(AI_ERROR.EMPTY_RESPONSE, 'The AI provider returned an empty response.', {
          retryable: true,
        });
      }

      return {
        text,
        usage: response.usage || null,
      };
    },
  };
}

module.exports = { createAnthropicProvider };
