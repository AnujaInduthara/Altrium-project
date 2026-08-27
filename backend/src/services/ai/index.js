const { AI_PROVIDER } = require('../../config/aiOptions');
const { AIProviderError, AI_ERROR } = require('./errors');
const { createAnthropicProvider } = require('./anthropicProvider');

// AI provider factory.
//
//   AI Screening Service  ->  getAIProvider()  ->  <provider implementation>
//
// Every provider returns the same shape:
//   { name, model, async complete({ system, user }) -> { text, usage } }
//
// To add a provider (e.g. OpenAI): implement the same contract in
// ./openaiProvider.js and add a case below. The screening service does not
// change.

function getAIProvider() {
  switch (AI_PROVIDER) {
    case 'anthropic':
      return createAnthropicProvider();
    // case 'openai':
    //   return createOpenAIProvider();
    default:
      throw new AIProviderError(
        AI_ERROR.NOT_CONFIGURED,
        `Unknown AI_PROVIDER "${AI_PROVIDER}". Supported: anthropic.`
      );
  }
}

module.exports = { getAIProvider, AIProviderError, AI_ERROR };
