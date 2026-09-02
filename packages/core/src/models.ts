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
  /**
   * The `fetch` the provider calls, for a server that needs its answers
   * repaired on the way in. See {@link repairNumericContent}.
   */
  fetch?: typeof globalThis.fetch
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
      ...(options.fetch ? { fetch: options.fetch } : {}),
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

/**
 * A `fetch` that puts back the quotes a server dropped from a streamed token.
 *
 * The OpenAI streaming protocol says `delta.content` carries a string. Some
 * servers round-trip the token through a JSON parser before sending it, so a
 * token that happens to be valid JSON arrives as whatever it parsed to: `6`
 * rather than `"6"`. A citation marker loses its digit and reads as `[]`, a
 * price loses its number and reads as `$`, and a client that validates the
 * field against the protocol throws in the middle of an answer.
 *
 * Coercing the value back to text cannot corrupt a correct response, because a
 * server that follows the protocol never puts a number there in the first
 * place. That is what separates this from guessing: there is no legitimate
 * reading of a bare number in that field to lose.
 *
 * What it cannot do is undo the parse. `"155724\n"` reaches the wire as
 * `155724`, and the newline was eaten before this ever saw it. Only the server
 * can fix that half, which is why using this is worth reporting upstream
 * rather than settling for.
 *
 *     model: models.openaiCompatible({
 *       baseURL, model, apiKey,
 *       fetch: repairNumericContent(),
 *     })
 */
export function repairNumericContent(inner: typeof globalThis.fetch = fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await inner(input, init)

    // Only a streamed body is line-oriented. Anything else is left exactly as
    // it arrived rather than parsed and rebuilt for no reason.
    const streamed = response.headers.get('content-type')?.includes('text/event-stream')
    if (!streamed || !response.body) return response

    const repaired = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(repairLines())

    return new Response(repaired.pipeThrough(new TextEncoderStream()), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

/**
 * Rewrites whole `data:` lines, buffering whatever is left mid-line.
 *
 * A chunk boundary falls wherever the network puts it, so a line can arrive in
 * two pieces and two lines can arrive in one piece. Parsing what has not
 * finished arriving is how a repair becomes a corruption.
 */
function repairLines(): TransformStream<string, string> {
  let held = ''

  const repair = (line: string): string => {
    if (!line.startsWith('data:')) return line

    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') return line

    try {
      const frame = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }> }
      let changed = false

      for (const choice of frame.choices ?? []) {
        const content = choice?.delta?.content
        // Null is the protocol's own way of saying "no text in this chunk", so
        // it is left alone. Only a value that should have been text is rebuilt.
        if (content === undefined || content === null || typeof content === 'string') continue

        if (typeof content === 'number' || typeof content === 'boolean') {
          choice.delta!.content = String(content)
          changed = true
        }
      }

      return changed ? `data: ${JSON.stringify(frame)}` : line
    } catch {
      // Not JSON, so not ours to rewrite. A malformed frame is the client's
      // problem to report, and swallowing it here would hide it.
      return line
    }
  }

  return new TransformStream<string, string>({
    transform(chunk, controller) {
      held += chunk
      const lines = held.split('\n')
      held = lines.pop() ?? ''

      for (const line of lines) controller.enqueue(`${repair(line)}\n`)
    },

    flush(controller) {
      if (held !== '') controller.enqueue(repair(held))
    },
  })
}
