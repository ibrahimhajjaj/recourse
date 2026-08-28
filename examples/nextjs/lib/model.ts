import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createEmbedder, type Embedder } from 'helpdeck'

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

/**
 * The embedder for the vector half of retrieval.
 *
 * It has to be the same model the index was built with, or the query vector
 * and the stored vectors are not comparable and the results are noise. Left
 * undefined, the agent falls back to the Gateway, which is right when the
 * index was built there.
 */
export function resolveEmbedder(): Embedder | undefined {
  const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL
  if (!baseURL) return undefined

  return createEmbedder({
    baseURL,
    apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
    model: process.env.OPENAI_COMPATIBLE_EMBED_MODEL ?? 'nomic-embed-text',
  })
}
