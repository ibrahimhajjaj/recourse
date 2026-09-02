/**
 * One thought sent as four messages, answered once.
 *
 * People do not compose on a phone. They send "hi", then "I have a problem",
 * then "with my order", then "LUM-1234", in eight seconds. Answered one at a
 * time that is four model calls, four half-answers, and a reply to "hi" arriving
 * after the order number has already been sent.
 *
 * The fix is to wait for the silence rather than for a fixed time from the
 * first message. A timer started at "hi" cuts a long burst in half; a window
 * that restarts on every arrival ends when the person actually stops typing.
 *
 * This library does not own a scheduler, so the work is split the way it has
 * to be. `hold` runs inside the request that receives a message and costs one
 * store write. `due` finds the conversations whose silence has lasted long
 * enough, for whatever the deployment already has: a cron, a queue, a Durable
 * Object alarm. Neither half needs a process to stay alive.
 */

import { PAUSED_KEY } from './takeover.js'
import { patchConversationMeta } from './store/meta.js'
import type { Conversation, Store, StoredMessage } from './store/types.js'

export const HOLD_KEYS = {
  /** When the current burst may be answered, if nothing else arrives. */
  dueAt: 'coalesceDueAt',
  /** When it began, so somebody typing forever still gets an answer. */
  firstAt: 'coalesceFirstAt',
  /** Who is answering this burst, so two sweepers do not both. */
  claim: 'coalesceClaim',
} as const

export interface HoldOptions {
  store: Store
  /**
   * Silence, in milliseconds, before a burst counts as finished.
   *
   * Around five seconds suits a phone keyboard. The cost is asymmetric and
   * worth knowing which way: too long only adds latency, too short fires
   * mid-sentence and defeats the whole thing, so err long.
   *
   * Zero turns this off and answers immediately, which is what the web widget
   * wants: somebody typing into a box sends one message and waits.
   */
  windowMs: number
  /**
   * The longest a burst may be held, however much the customer keeps typing.
   *
   * Without it a window that restarts on every message never ends for somebody
   * writing continuously, and they get silence rather than an answer. Thirty
   * seconds by default: long enough that a normal burst never reaches it.
   */
  maxWaitMs?: number
  /**
   * The most messages folded into one turn.
   *
   * A burst is normally three or four. Two hundred is somebody pasting a log
   * or a script hammering the webhook, and sending all of it to the model is a
   * bill rather than a question. The newest are kept, because that is where
   * the actual request is.
   */
  maxMessages?: number
}

export interface Held {
  /** Whether this turn should be answered now. */
  ready: boolean
  /**
   * Everything said since the burst began, oldest first.
   *
   * Empty when not ready. Feed the whole thing to the agent as the customer's
   * turn: they meant it as one message.
   */
  messages: StoredMessage[]
}

/**
 * Records a message and says whether to answer yet.
 *
 * Call it after storing the message. When it says not ready, reply with
 * nothing at all: a "one moment" would itself be a message the customer has to
 * read, and they are still typing.
 */
export async function hold(conversationId: string, options: HoldOptions): Promise<Held> {
  const thread = await options.store.getConversation(conversationId)
  if (!thread) return { ready: true, messages: [] }

  const meta = thread.conversation.meta ?? {}

  // A person owns this conversation, so there is nothing to schedule. Arming a
  // window here would have the agent answer over the top of them once it
  // elapsed, which is the one thing a handover exists to prevent.
  if (meta[PAUSED_KEY] === true) return { ready: false, messages: [] }

  if (options.windowMs <= 0) {
    return { ready: true, messages: burst(thread.messages, options.maxMessages) }
  }

  const now = Date.now()

  await patchConversationMeta(options.store, conversationId, {
    // Restarted on every arrival, which is what makes it a silence detector
    // rather than a timer from the first word.
    [HOLD_KEYS.dueAt]: new Date(now + options.windowMs).toISOString(),
    // Set once and left alone, so the ceiling below is measured from when the
    // customer started rather than from their most recent keystroke.
    ...(typeof meta[HOLD_KEYS.firstAt] === 'string' ? {} : { [HOLD_KEYS.firstAt]: new Date(now).toISOString() }),
  })

  return { ready: false, messages: [] }
}

/**
 * The conversations that have gone quiet long enough to answer.
 *
 * Run from whatever fires on a schedule. Each one comes back with the whole
 * burst gathered and its hold already taken, so an overlapping sweeper almost
 * never picks up the same burst. See `release` for why "almost".
 */
export async function due(options: HoldOptions & { limit?: number }): Promise<
  Array<{ conversationId: string; messages: StoredMessage[] }>
> {
  const limit = options.limit ?? 20
  const now = Date.now()
  const page = await options.store.listConversations({ limit: limit * 5 })

  const ready: Array<{ conversationId: string; messages: StoredMessage[] }> = []

  for (const conversation of page.items) {
    if (ready.length >= limit) break

    // A person took it over while it was being held. Their conversation is
    // theirs; drop the hold and leave it alone.
    if (conversation.meta?.[PAUSED_KEY] === true) {
      await forget(options.store, conversation.id)
      continue
    }

    const dueAt = conversation.meta?.[HOLD_KEYS.dueAt]
    if (typeof dueAt !== 'string') continue

    const at = Date.parse(dueAt)
    if (Number.isNaN(at)) continue

    // Either the silence lasted, or the customer has been typing long enough
    // that waiting for more silence is no longer serving them.
    const startedAt = Date.parse(String(conversation.meta?.[HOLD_KEYS.firstAt] ?? dueAt))
    const overdue = !Number.isNaN(startedAt) && now - startedAt >= (options.maxWaitMs ?? 30_000)
    if (at > now && !overdue) continue

    // Released before the burst is handed over, not after. A sweep that reads,
    // answers, then clears would let a second sweeper pick up the same burst
    // while the first one is still talking to the model.
    const taken = await release(options.store, conversation)
    if (!taken) continue

    const thread = await options.store.getConversation(conversation.id)
    if (!thread) continue

    ready.push({ conversationId: conversation.id, messages: burst(thread.messages, options.maxMessages) })
  }

  return ready
}

/**
 * Takes the burst, and says whether this caller is the one that got it.
 *
 * A `Store` has no compare and swap, so this is the next best thing: write a
 * token, read it back, and only proceed if it is still yours. Two sweepers
 * that both saw the burst write different tokens, one write lands last, and
 * only that one answers. The loser leaves the hold alone rather than clearing
 * it, so nothing is lost if the winner then dies.
 *
 * Not a lock, and not claimed to be one. It turns "both answer" into "almost
 * never both answer", which is the right trade for a cron. A deployment that
 * needs the guarantee wants a Durable Object alarm, where the scheduler is the
 * lock and none of this is necessary.
 */
async function release(store: Store, conversation: Conversation): Promise<boolean> {
  const fresh = await store.getConversation(conversation.id)
  const meta = fresh?.conversation.meta ?? {}
  if (typeof meta[HOLD_KEYS.dueAt] !== 'string') return false

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  await patchConversationMeta(store, conversation.id, { [HOLD_KEYS.claim]: token })

  const after = await store.getConversation(conversation.id)
  if (after?.conversation.meta?.[HOLD_KEYS.claim] !== token) return false

  await patchConversationMeta(store, conversation.id, {
    [HOLD_KEYS.dueAt]: null,
    [HOLD_KEYS.firstAt]: null,
    [HOLD_KEYS.claim]: null,
  })

  return true
}

/** Drops a hold without taking the burst, for one a person now owns. */
async function forget(store: Store, conversationId: string): Promise<void> {
  await patchConversationMeta(store, conversationId, {
    [HOLD_KEYS.dueAt]: null,
    [HOLD_KEYS.firstAt]: null,
    [HOLD_KEYS.claim]: null,
  })
}

/**
 * Everything the customer has said since the agent last replied, capped.
 *
 * The newest are kept when there are too many. A burst is three or four
 * messages; two hundred is a paste or a script, and the actual request is at
 * the end of it rather than the start.
 */
function burst(messages: StoredMessage[], maxMessages = 25): StoredMessage[] {
  const at = messages.map((message) => message.role).lastIndexOf('assistant')
  const said = messages.slice(at + 1).filter((message) => message.role === 'user')

  return said.length > maxMessages ? said.slice(-maxMessages) : said
}
