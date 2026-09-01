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

export const UNANSWERED_MESSAGE =
  'Nobody is available to pick this up right now, so I will carry on helping if I can.'

export interface TakeoverOptions {
  /** Replaces {@link PAUSED_MESSAGE}. */
  message?: string
  /**
   * How long the agent stays quiet waiting for a person, in milliseconds.
   *
   * Off unless set, which is how it behaved before this existed. Turn it on
   * and a handover that nobody picks up hands itself back rather than leaving
   * the customer in silence: an escalation at two in the morning otherwise
   * ends the conversation without anybody deciding to.
   *
   * The clock is the moment of handover, not the last message, so a customer
   * who keeps typing into the silence does not keep extending their own wait.
   */
  waitForPersonMs?: number
  /** Said when the wait runs out. Replaces {@link UNANSWERED_MESSAGE}. */
  unansweredMessage?: string
}

/**
 * Whether a person currently owns this conversation.
 *
 * Reads through rather than caching. A cache would make the window between a
 * person clicking "take over" and the agent noticing longer than the window
 * between two customer messages, which is exactly the window that matters.
 */
export async function isPaused(
  store: Store,
  conversationId: string,
  waitForPersonMs?: number,
): Promise<boolean> {
  try {
    const thread = await store.getConversation(conversationId)
    if (thread?.conversation.meta?.[PAUSED_KEY] !== true) return false
    if (!waitForPersonMs) return true

    // The timestamp was written on every handover and read by nothing, so a
    // pause had no way to end except a person ending it.
    const since = thread.conversation.meta?.[PAUSED_AT_KEY]
    if (typeof since !== 'string') return true

    const began = Date.parse(since)
    if (Number.isNaN(began)) return true

    return Date.now() - began < waitForPersonMs
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

/**
 * Whether this conversation was handed back by the clock rather than a person.
 *
 * The agent answers either way; this is so the turn can open by saying nobody
 * came, instead of the customer wondering what happened to the human they were
 * promised.
 */
export async function waitedTooLong(
  store: Store,
  conversationId: string,
  waitForPersonMs?: number,
): Promise<boolean> {
  if (!waitForPersonMs) return false

  try {
    const thread = await store.getConversation(conversationId)
    if (thread?.conversation.meta?.[PAUSED_KEY] !== true) return false

    const since = thread.conversation.meta?.[PAUSED_AT_KEY]
    if (typeof since !== 'string') return false

    const began = Date.parse(since)

    return !Number.isNaN(began) && Date.now() - began >= waitForPersonMs
  } catch {
    return false
  }
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
