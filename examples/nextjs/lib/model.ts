import { models, embedders } from 'helpdeck'
import type { LanguageModel } from 'ai'
import type { Embedder } from 'helpdeck'

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
