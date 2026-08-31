/**
 * The three ways people actually configure a model, in one place.
 *
 * Every deployment of this ends up writing the same thirty lines: read some
 * environment variables, decide whether a local endpoint was configured, fall
 * back to a gateway id. The example had its own copy, and so does everyone who
 * copied the example.
 *
 * None of this is required. `model` takes a plain string or any AI SDK model,
 * and always will.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createEmbedder } from './embed.js'
import type { Embedder } from './types.js'

export interface OpenAICompatibleOptions {
  /** Such as `http://localhost:11434/v1` for Ollama. */
  baseURL: string
  /** Ollama ignores this; most other endpoints do not. */
  apiKey?: string
  model: string
  /** Shown in errors, so a failure names which endpoint failed. */
  name?: string
}

export const models = {
  /**
   * Anything speaking the OpenAI chat API: Ollama, vLLM, OpenRouter, Groq,
   * Together, LM Studio.
   */
  openaiCompatible(options: OpenAICompatibleOptions): LanguageModel {
    return createOpenAICompatible({
      name: options.name ?? 'openai-compatible',
      baseURL: options.baseURL,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    })(options.model)
  },

  /**
   * A model on a local Ollama.
   *
   * `qwen3:4b` because it is the smallest thing measured to answer well; see
   * the model table in the README for what that measurement was.
   */
  local(model = 'qwen3:4b', baseURL = 'http://localhost:11434/v1'): LanguageModel {
    return models.openaiCompatible({ name: 'ollama', baseURL, apiKey: 'ollama', model })
  },

  /**
   * A model id routed through the Vercel AI Gateway.
   *
   * A bare string is already this, so the function exists for symmetry and to
   * give the choice a name in a config file.
   */
  gateway(id: string): LanguageModel {
    return id
  },

  /**
   * Whatever the environment says, with a local endpoint winning when one is
   * configured.
   *
   * This is the shape every example ends up with: `OPENAI_COMPATIBLE_BASE_URL`
   * and friends for a local or self-hosted model, otherwise a gateway id.
   *
   * Pass the environment explicitly on a runtime that has no `process`. On a
   * Cloudflare Worker the variables arrive with the request rather than
   * existing globally, so it is `models.fromEnvironment(env)`.
   */
  fromEnvironment(env: EnvironmentLike = readableEnvironment(), fallback = 'openai/gpt-4o-mini'): LanguageModel {
    const baseURL = env.OPENAI_COMPATIBLE_BASE_URL
    const model = env.OPENAI_COMPATIBLE_MODEL

    if (baseURL && model) {
      return models.openaiCompatible({
        baseURL,
        model,
        ...(env.OPENAI_COMPATIBLE_API_KEY ? { apiKey: env.OPENAI_COMPATIBLE_API_KEY } : {}),
      })
    }

    return env.RECOURSE_MODEL ?? fallback
  },
}

export type EnvironmentLike = Record<string, string | undefined>

/**
 * `process.env`, or nothing at all.
 *
 * Workers and other edge runtimes have no `process`, and merely *reading* it
 * throws rather than returning undefined. A helper whose whole job is reading
 * configuration should not be the reason a deployment cannot start.
 */
function readableEnvironment(): EnvironmentLike {
  return typeof process === 'undefined' ? {} : (process.env ?? {})
}

export const embedders = {
  /**
   * Embeddings from a local Ollama.
   *
   * The model has to be the one the index was built with. A query vector from
   * a different model is not comparable to the stored ones, and the symptom is
   * bad answers rather than an error.
   */
  local(model = 'nomic-embed-text', baseURL = 'http://localhost:11434/v1'): Embedder {
    return createEmbedder({ model, baseURL, apiKey: 'ollama' })
  },

  /** Matches `models.fromEnvironment`, so the pair stays consistent. */
  fromEnvironment(env: EnvironmentLike = readableEnvironment()): Embedder | undefined {
    const baseURL = env.OPENAI_COMPATIBLE_BASE_URL
    if (!baseURL) return undefined

    return createEmbedder({
      baseURL,
      model: env.OPENAI_COMPATIBLE_EMBED_MODEL ?? 'nomic-embed-text',
      ...(env.OPENAI_COMPATIBLE_API_KEY ? { apiKey: env.OPENAI_COMPATIBLE_API_KEY } : {}),
    })
  },
}
