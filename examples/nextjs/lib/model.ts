import { models, embedders } from '@recourse-ai/core'
import type { LanguageModel } from 'ai'
import type { Embedder } from '@recourse-ai/core'

/**
 * Picks the model to answer with.
 *
 * The default is a model id string, which the AI SDK routes through the Vercel
 * AI Gateway; on a Vercel deployment that authenticates itself with no key to
 * create. Setting OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL points
 * the same agent at anything speaking the OpenAI chat API instead: OpenRouter,
 * Groq, Together, or Ollama and vLLM on your own hardware.
 */
export function resolveModel(): LanguageModel {
  return models.fromEnvironment()
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
  return embedders.fromEnvironment()
}

/**
 * The model the voice path answers with.
 *
 * A call cannot wait. The tool that fetches an answer mid-conversation has a
 * timeout measured in seconds, and the agent simply goes quiet when it passes,
 * which a caller hears as the line dropping. A reasoning model that thinks
 * before it speaks is a good default for chat and unusable here: measured at
 * 53 seconds for one question against a local one, on a 30 second timeout.
 *
 * Its own endpoint, not just its own model name. The fast option is usually a
 * different provider from the one answering chat, so sharing a base URL would
 * mean naming a model the configured host has never heard of.
 *
 * Falls back to the chat model when nothing is set, so this stays optional.
 */
export function resolveVoiceModel(): LanguageModel {
  const model = process.env.VOICE_MODEL
  const baseURL = process.env.VOICE_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL

  if (model && baseURL) {
    const apiKey = process.env.VOICE_API_KEY ?? process.env.OPENAI_COMPATIBLE_API_KEY

    return models.openaiCompatible({ baseURL, model, ...(apiKey ? { apiKey } : {}) })
  }

  return resolveModel()
}
