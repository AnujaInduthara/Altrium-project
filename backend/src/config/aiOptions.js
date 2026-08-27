require('dotenv').config();

// Centralized AI provider configuration for PB-05 CV screening.
//
// Nothing here is ever sent to the browser. AI API keys are read server-side
// only, exactly like SUPABASE_SERVICE_ROLE_KEY in config/supabase.js. The
// frontend has no knowledge of the provider, the model, or the keys.
//
// All values are environment-driven so the model/provider can be swapped
// without code changes. See backend/.env.example for the variable names.

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseNonNegativeFloat(raw, fallback) {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// 'anthropic' is the only implementation shipped in PB-05. The provider factory
// (services/ai/index.js) is structured so an 'openai' (or other) implementation
// can be added without touching the screening service.
const AI_PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();

// Model id is provider-specific. Kept in config, never hardcoded in the pipeline.
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5';

// Output ceiling for the structured screening JSON. The result is small; this
// is a safety cap, not a target.
const AI_MAX_OUTPUT_TOKENS = parsePositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 1600);

// Reasoning/effort level for providers that support it (e.g. Anthropic). CV
// screening is a structured classification task — 'low' keeps it fast and
// cheap while staying deterministic enough.
const AI_EFFORT = process.env.AI_EFFORT || 'low';

// Only used by providers that still accept a sampling temperature. Screening
// wants near-deterministic output, so default low. Ignored by reasoning models
// that have removed the parameter.
const AI_TEMPERATURE = parseNonNegativeFloat(process.env.AI_TEMPERATURE, 0);

// Per-request timeout (ms) for a single AI call. The screening service adds
// bounded retries with backoff on top of this.
const AI_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.AI_REQUEST_TIMEOUT_MS, 60_000);

// Server-side secrets. Never logged, never returned in an API response.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Master switch. Screening is on by default, but automatically inert if the
// selected provider has no credentials — so a fresh checkout without an AI key
// still runs PB-01..PB-04 normally, just with screening left in 'pending'.
const AI_SCREENING_ENABLED = process.env.AI_SCREENING_ENABLED !== 'false';

function providerHasCredentials(provider = AI_PROVIDER) {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_API_KEY.length > 0;
    case 'openai':
      return OPENAI_API_KEY.length > 0;
    default:
      return false;
  }
}

// True when the screening pipeline should actually run. The service checks this
// before claiming work; if false, rows are left 'pending' for a later retry
// once credentials are configured.
function isScreeningConfigured() {
  return AI_SCREENING_ENABLED && providerHasCredentials();
}

module.exports = {
  AI_PROVIDER,
  AI_MODEL,
  AI_MAX_OUTPUT_TOKENS,
  AI_EFFORT,
  AI_TEMPERATURE,
  AI_REQUEST_TIMEOUT_MS,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  AI_SCREENING_ENABLED,
  providerHasCredentials,
  isScreeningConfigured,
};
