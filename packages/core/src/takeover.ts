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

import { patchConversationMeta } from './store/meta.js'
import type { Store } from './store/types.js'

/** Where the flag lives on `Conversation.meta`. */
export const PAUSED_KEY = 'aiPaused'
/** Set alongside it, so a transcript says when a person stepped in. */
export const PAUSED_AT_KEY = 'aiPausedAt'
/** Set when somebody actually arrives, which is not the same as being asked for. */
export const ASSIGNED_KEY = 'aiAssignedTo'
export const ASSIGNED_AT_KEY = 'aiAssignedAt'
/** Why the last handover ended, so escalations can be counted rather than guessed at. */
export const ENDED_BECAUSE_KEY = 'aiHandoverEndedBecause'

/**
 * How a handover finished.
 *
 * The reason it is worth storing: "what fraction of our escalations ended
 * because nobody came" is the question a support lead asks on day thirty, and
 * a boolean flag cannot answer it. Every one of these is a different problem
 * with a different fix.
 */
export type EndReason =
  /** A person picked it up and finished with it. The good ending. */
  | 'person-finished'
  /** The wait ran out with nobody there. Staffing, not software. */
  | 'nobody-came'
  /** The customer said they were done waiting. */
  | 'customer-ended'

/**
 * What the customer hears when they keep typing after a handoff.
 *
 * Silence would be worse than a wrong answer here: the customer cannot tell a
 * paused agent from a broken one, so they ask again, and again. One sentence
 * saying a person has it and their message was passed on ends that.
 */
export const PAUSED_MESSAGE = 'A colleague has taken this over and will reply here. I have passed your message on.'

/**
 * What the customer hears while they are still waiting for somebody.
 *
 * Different from {@link PAUSED_MESSAGE} because the situation is different: a
 * colleague has it, or a colleague has been asked for and has not arrived. A
 * customer told the first while the second is true is being misled, and they
 * wait longer than they otherwise would.
 */
export const WAITING_MESSAGE = 'I have passed this to the team and someone will reply here shortly.'

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
  /**
   * Said while a person has been asked for but has not arrived.
   *
   * Replaces {@link WAITING_MESSAGE}. Separate from `message`, which is for
   * once somebody is actually there, because telling a queuing customer that a
   * colleague already has it makes them wait longer than they otherwise would.
   */
  waitingMessage?: string
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
export async function pauseAgent(
  store: Store,
  conversationId: string,
  options: { assigned?: boolean } = {},
): Promise<void> {
  // Assigned unless told otherwise, because the usual caller is a person
  // clicking "take over" and they are, by definition, there. An automated
  // escalation passes false: it has asked for somebody, not found one.
  const assigned = options.assigned ?? true

  await patchConversationMeta(store, conversationId, {
    [PAUSED_KEY]: true,
    [PAUSED_AT_KEY]: new Date().toISOString(),
    ...(assigned ? { [ASSIGNED_KEY]: true, [ASSIGNED_AT_KEY]: new Date().toISOString() } : {}),
  })
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

/**
 * Records that a person has actually arrived.
 *
 * Distinct from `pauseAgent` on purpose. "We are getting someone" and "someone
 * is here" are two different things to be told, and conflating them is where
 * the customer sits wondering whether anybody is coming. It also makes the
 * wait measurable: the gap between these two calls is how long people queue.
 */
export async function assignAgent(store: Store, conversationId: string, who?: string): Promise<void> {
  await patchConversationMeta(store, conversationId, {
    [PAUSED_KEY]: true,
    [ASSIGNED_KEY]: who ?? true,
    [ASSIGNED_AT_KEY]: new Date().toISOString(),
  })
}

/** Whether somebody is actually on this conversation, rather than asked for. */
export async function hasPerson(store: Store, conversationId: string): Promise<boolean> {
  try {
    const thread = await store.getConversation(conversationId)

    return Boolean(thread?.conversation.meta?.[ASSIGNED_KEY])
  } catch {
    return false
  }
}

/** Gives it back to the agent, for when a person has finished with it. */
export async function resumeAgent(
  store: Store,
  conversationId: string,
  because: EndReason = 'person-finished',
): Promise<void> {
  await patchConversationMeta(store, conversationId, {
    [PAUSED_KEY]: false,
    [PAUSED_AT_KEY]: undefined,
    [ASSIGNED_KEY]: undefined,
    [ASSIGNED_AT_KEY]: undefined,
    [ENDED_BECAUSE_KEY]: because,
  })
}

/**
 * What the customer can type to stop waiting.
 *
 * Somebody who has been queuing for ten minutes and gives up currently has no
 * way to say so, and their only option is to close the tab. Matched on the
 * whole message so "I want to end my subscription" is not one.
 */
export const END_COMMANDS = ['/end', '/cancel', '/bot']

/** Whether this message is the customer asking to stop waiting for a person. */
export function isEndCommand(text: string): boolean {
  return END_COMMANDS.includes(text.trim().toLowerCase())
}

/** Why the last handover on this conversation ended, if one has. */
export async function endedBecause(store: Store, conversationId: string): Promise<EndReason | null> {
  try {
    const thread = await store.getConversation(conversationId)
    const reason = thread?.conversation.meta?.[ENDED_BECAUSE_KEY]

    return typeof reason === 'string' ? (reason as EndReason) : null
  } catch {
    return null
  }
}
