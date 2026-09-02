import type { Store } from './types.js'

/**
 * Changes some keys on a conversation's `meta` without touching the others.
 *
 * `updateConversation` replaces `meta` wholesale, on purpose: that is how a
 * flag gets cleared. So a feature that owns two keys out of eight has to say
 * so, rather than reading all eight and writing all eight back and racing
 * whoever else was doing the same thing.
 *
 * `store.patchMeta` does it in one statement where the store can. Everything
 * else, including a store written outside this repo, gets the read and write
 * it had before, so nothing breaks by not implementing it.
 *
 * `undefined` and `null` both delete the key. `undefined` is what a caller
 * naturally writes for "clear this", and it disappears from JSON, so it is
 * turned into `null` before it goes anywhere near a store.
 */
export async function patchConversationMeta(
  store: Store,
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const normalised: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) normalised[key] = value === undefined ? null : value

  if (store.patchMeta) {
    await store.patchMeta(conversationId, normalised)
    return
  }

  const thread = await store.getConversation(conversationId)
  if (!thread) return

  const meta = { ...(thread.conversation.meta ?? {}) }
  for (const [key, value] of Object.entries(normalised)) {
    if (value === null) delete meta[key]
    else meta[key] = value
  }

  await store.updateConversation(conversationId, { meta })
}
