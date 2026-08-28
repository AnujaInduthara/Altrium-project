const Groq = require('groq-sdk');
const {
  AI_MODEL,
  AI_MAX_OUTPUT_TOKENS,
  AI_EFFORT,
  AI_TEMPERATURE,
  AI_REQUEST_TIMEOUT_MS,
  GROQ_API_KEY,
} = require('../../config/aiOptions');
const { AIProviderError, AI_ERROR } = require('./errors');

// Groq implementation of the AI provider contract. The rest of the app never
// imports groq-sdk directly — it goes through services/ai.
//
// Groq exposes an OpenAI-compatible Chat Completions API. Screening needs the
// full response, so this provider does NOT stream — it asks for one complete
// JSON object and returns its text for the caller to parse and validate.

let client = null;
function getClient() {
  if (!GROQ_API_KEY) {
    throw new AIProviderError(AI_ERROR.NOT_CONFIGURED, 'GROQ_API_KEY is not set.');
  }
  if (!client) {
    client = new Groq({ apiKey: GROQ_API_KEY, maxRetries: 0 });
  }
  return client;
}

function mapError(err) {
  if (err && err.isAIProviderError) return err;

  const status = err && typeof err.status === 'number' ? err.status : null;
  if (err instanceof Groq.APIConnectionTimeoutError) {
    return new AIProviderError(AI_ERROR.TIMEOUT, 'The AI request timed out.', { retryable: true, cause: err });
  }
  if (err instanceof Groq.RateLimitError || status === 429) {
    return new AIProviderError(AI_ERROR.RATE_LIMITED, 'The AI provider is rate limiting requests.', { retryable: true, cause: err });
  }
  if (err instanceof Groq.APIConnectionError || (status && status >= 500)) {
    return new AIProviderError(AI_ERROR.PROVIDER_ERROR, 'The AI provider returned a server error.', { retryable: true, cause: err });
  }
  if (status && status >= 400) {
    return new AIProviderError(AI_ERROR.BAD_REQUEST, `The AI request was rejected (${status}).`, { retryable: false, cause: err });
  }
  return new AIProviderError(AI_ERROR.PROVIDER_ERROR, 'The AI request failed.', { retryable: true, cause: err });
}

// Some Groq models (e.g. the gpt-oss family) accept a `reasoning_effort`
// parameter; others reject unknown fields. Only send it when it looks valid.
const REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

function createGroqProvider() {
  return {
    name: 'groq',
    model: AI_MODEL,

    // Runs one completion. `system` and `user` are plain strings built by the
    // screening prompt module. Returns { text } — raw model text, to be parsed
    // and validated by the caller (never trusted as-is).
    async complete({ system, user }) {
      const params = {
        model: AI_MODEL,
        max_completion_tokens: AI_MAX_OUTPUT_TOKENS,
        temperature: AI_TEMPERATURE,
        top_p: 1,
        stream: false,
        // The prompt already demands a single JSON object and nothing else;
        // JSON mode makes that a hard constraint.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (REASONING_EFFORTS.has(String(AI_EFFORT).toLowerCase())) {
        params.reasoning_effort = String(AI_EFFORT).toLowerCase();
      }

      let response;
      try {
        response = await getClient().chat.completions.create(params, {
          timeout: AI_REQUEST_TIMEOUT_MS,
        });
      } catch (err) {
        throw mapError(err);
      }

      const choice = (response.choices || [])[0] || {};

      if (choice.finish_reason === 'content_filter') {
        throw new AIProviderError(
          AI_ERROR.BAD_REQUEST,
          'The AI provider declined to process this screening request.',
          { retryable: false }
        );
      }

      const text = typeof choice.message?.content === 'string' ? choice.message.content.trim() : '';

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

module.exports = { createGroqProvider };
