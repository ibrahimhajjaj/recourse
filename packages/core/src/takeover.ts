/**
 * Handing a conversation to a person, and keeping the agent quiet afterwards.
 *
 * An escalation that opens a ticket and leaves the agent answering is not a
 * handoff. The customer keeps talking in the same window, the agent keeps
 * replying from the documentation, and the person who picked the ticket up is
 * now negotiating with their own product. Worse, the agent will contradict
 * them: it does not know what the human just promised.
 *
 * So a taken-over conversation carries a flag, and the agent reads it before
 * it answers. The flag lives on the conversation's own metadata rather than in
 * a new table, which means every store already supports it and there is
 * nothing to migrate.
 */

import type { Store } from './store/types.js'

/** Where the flag lives on `Conversation.meta`. */
export const PAUSED_KEY = 'aiPaused'
/** Set alongside it, so a transcript says when a person stepped in. */
export const PAUSED_AT_KEY = 'aiPausedAt'

/**
 * What the customer hears when they keep typing after a handoff.
 *
 * Silence would be worse than a wrong answer here: the customer cannot tell a
 * paused agent from a broken one, so they ask again, and again. One sentence
 * saying a person has it and their message was passed on ends that.
 */
export const PAUSED_MESSAGE = 'A colleague has taken this over and will reply here. I have passed your message on.'

export interface TakeoverOptions {
  /** Replaces {@link PAUSED_MESSAGE}. */
  message?: string
}

/**
 * Whether a person currently owns this conversation.
 *
 * Reads through rather than caching. A cache would make the window between a
 * person clicking "take over" and the agent noticing longer than the window
 * between two customer messages, which is exactly the window that matters.
 */
export async function isPaused(store: Store, conversationId: string): Promise<boolean> {
  try {
    const thread = await store.getConversation(conversationId)
    return thread?.conversation.meta?.[PAUSED_KEY] === true
  } catch {
    // A store that cannot be read should not silence the agent. Answering when
    // a human had taken over is bad; refusing to answer anybody because the
    // database blinked is worse, and it fails for every conversation at once.
    return false
  }
}

/**
 * Hands the conversation to a person. The agent stops answering in it.
 *
 * Idempotent, and safe to call from an escalation that may fire twice.
 */
export async function pauseAgent(store: Store, conversationId: string): Promise<void> {
  await merge(store, conversationId, { [PAUSED_KEY]: true, [PAUSED_AT_KEY]: new Date().toISOString() })
}

/** Gives it back to the agent, for when a person has finished with it. */
export async function resumeAgent(store: Store, conversationId: string): Promise<void> {
  await merge(store, conversationId, { [PAUSED_KEY]: false, [PAUSED_AT_KEY]: undefined })
}

/**
 * Writes the flag without dropping whatever else is on the conversation.
 *
 * `updateConversation` replaces `meta` wholesale, so the country an earlier
 * turn recorded would go with it.
 */
async function merge(store: Store, conversationId: string, patch: Record<string, unknown>): Promise<void> {
  const thread = await store.getConversation(conversationId)
  const meta = { ...(thread?.conversation.meta ?? {}), ...patch }

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) delete meta[key]
  }

  await store.updateConversation(conversationId, { meta })
}
