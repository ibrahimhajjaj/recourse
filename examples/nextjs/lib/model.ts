import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

/**
 * Picks the model to answer with.
 *
 * The default is a model id string, which the AI SDK routes through the Vercel
 * AI Gateway, which on a Vercel deployment authenticates itself with no key to
 * create. Setting the three OPENAI_COMPATIBLE variables points the same agent
 * at anything speaking the OpenAI chat API instead: OpenRouter, Groq, Together,
 * or Ollama and vLLM on your own hardware. Nothing else in the app changes.
 */
export function resolveModel(): LanguageModel {
  const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY
  const modelId = process.env.OPENAI_COMPATIBLE_MODEL

  if (baseURL && apiKey && modelId) {
    return createOpenAICompatible({ name: 'byo', baseURL, apiKey })(modelId)
  }

  return process.env.HELPDECK_MODEL ?? 'openai/gpt-4o-mini'
}
