import { embedMany, type EmbeddingModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { Embedder, SourceContext } from './types.js'

export interface EmbedderOptions {
  /** A Gateway model id, or an embedding model instance from any provider. */
  model?: EmbeddingModel
  /**
   * Points at any OpenAI-compatible embeddings endpoint instead of the Gateway:
   * Ollama or vLLM on your own machine, or another hosted provider. With this
   * set, building a vector index needs no account anywhere.
   */
  baseURL?: string
  apiKey?: string
  /**
   * Truncate vectors to this width. OpenAI's text-embedding-3 family is
   * Matryoshka-trained, so the leading dimensions carry the most signal and
   * cutting there loses very little while making the index a third of the size.
   * Ignored for models where truncation is not known to be safe.
   */
  dimensions?: number
  /** Values per request. Large enough to be efficient, small enough to report progress. */
  batchSize?: number
}

/**
 * A `baseURL` wins over the Gateway, so a model id given alongside one names a
 * model on that endpoint rather than a Gateway route.
 */
function resolveEmbeddingModel(options: EmbedderOptions): EmbeddingModel {
  if (options.model && typeof options.model !== 'string') return options.model

  if (options.baseURL) {
    return createOpenAICompatible({
      name: 'byo',
      baseURL: options.baseURL,
      // Local servers ignore it, but the SDK insists on something.
      apiKey: options.apiKey ?? 'not-needed',
    }).textEmbeddingModel(options.model ?? DEFAULT_LOCAL_MODEL)
  }

  return options.model ?? DEFAULT_MODEL
}

/** Models trained so that a truncated prefix is still a usable embedding. */
const MATRYOSHKA = /^openai\/text-embedding-3-/

const DEFAULT_MODEL = 'openai/text-embedding-3-small'
/** Ollama's default embedding model, used when only a baseURL is given. */
const DEFAULT_LOCAL_MODEL = 'nomic-embed-text'
const DEFAULT_DIMENSIONS = 512
const DEFAULT_BATCH = 96

/**
 * Embeddings through the Vercel AI Gateway. On a Vercel deployment the OIDC
 * token is injected automatically, so this needs no key of its own; locally it
 * reads AI_GATEWAY_API_KEY.
 *
 * The whole embedding step is optional. Skip it and retrieval falls back to
 * keyword search, which needs no credentials whatsoever.
 */
export function createEmbedder(options: EmbedderOptions = {}): Embedder {
  const model = resolveEmbeddingModel(options)
  const batchSize = options.batchSize ?? DEFAULT_BATCH
  // Truncation is only safe on models known to be Matryoshka-trained, and a
  // model instance rather than an id is someone else's provider, so leave it be.
  const truncateTo =
    typeof model === 'string' && MATRYOSHKA.test(model) ? (options.dimensions ?? DEFAULT_DIMENSIONS) : 0
  // The label travels inside the index so `ask` can rebuild the same model.
  // Calling a local model "gateway:" would send the next query to the wrong place.
  const label = typeof model === 'string' ? `gateway:${model}` : `${options.baseURL ? 'endpoint' : 'provider'}:${model.modelId}`

  return {
    name: label,
    // Reported after the first batch; callers only need it to size the index.
    dimensions: truncateTo || 0,

    async embed(texts: string[], ctx: SourceContext = {}): Promise<Float32Array[]> {
      const report = ctx.onProgress ?? (() => {})
      const out: Float32Array[] = []

      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize)
        const { embeddings } = await embedMany({ model, values: batch, abortSignal: ctx.signal })

        for (const embedding of embeddings) {
          const width = truncateTo > 0 ? Math.min(truncateTo, embedding.length) : embedding.length
          out.push(Float32Array.from(embedding.slice(0, width)))
        }

        report({
          phase: 'embed',
          message: `embedded ${Math.min(start + batch.length, texts.length)} of ${texts.length}`,
          done: out.length,
          total: texts.length,
        })
      }

      this.dimensions = out[0]?.length ?? 0
      return out
    },
  }
}

/**
 * True when something in the environment can authenticate to the Gateway. Used
 * to decide whether to attempt embeddings rather than failing the whole ingest
 * over an optional step.
 */
export function canReachGateway(
  // Not `= process.env`: a default parameter is evaluated at call time, and on
  // a runtime without `process` that throws rather than yielding undefined.
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : (process.env ?? {}),
): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN)
}
