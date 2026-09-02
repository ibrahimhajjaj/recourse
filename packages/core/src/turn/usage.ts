import type { LanguageModel } from 'ai'
import type { Usage } from '../budget.js'

/**
 * What the turn actually cost, or nothing when the provider did not say.
 *
 * Read after the stream rather than from a `finish` part, because a stream
 * that failed has no finish part and the totals are still worth having: a
 * turn can burn its input tokens and then die on the way back.
 */
export async function consumed(result: { usage: PromiseLike<Usage> }): Promise<Usage> {
  try {
    const usage = await result.usage
    return { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }
  } catch {
    // Unmetered is better than a turn that throws while tidying up.
    return {}
  }
}

/**
 * The id a model prices under.
 *
 * A gateway string is already `provider/model` and passes through. An SDK
 * instance is not: it reports a bare `qwen3:4b`, which says nothing about who
 * served it, and a price list cannot tell a local model apart from a hosted
 * one on that alone. The provider is put back on the front so both halves of
 * the id space have the same shape, and so `ollama/*` means something.
 *
 * The SDK suffixes providers by surface (`ollama.chat`); the surface is not
 * part of anyone's pricing, so it goes.
 */
export function nameOf(model: LanguageModel): string {
  if (typeof model === 'string') return model

  const id = (model as { modelId?: unknown }).modelId
  if (typeof id !== 'string') return 'unknown'
  if (id.includes('/')) return id

  const provider = (model as { provider?: unknown }).provider
  if (typeof provider !== 'string' || !provider) return id

  return `${provider.split('.')[0]}/${id}`
}
