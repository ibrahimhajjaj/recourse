/**
 * Whether the answer actually arrived.
 *
 * "We sent it" and "they got it" are the same fact today, and they are not the
 * same fact. A message that failed on the way to a customer looks identical in
 * a transcript to one they read and ignored, which makes "how many of our
 * escalation notices never reached anybody" unanswerable.
 *
 * The awkward part is not recording the states, it is that they do not arrive
 * in order. Meta re-delivers status webhooks and can hand you `sent` after
 * `read`. Applied naively the state goes backwards, a customer who has read
 * the message shows as merely sent, and anything triggered by a state change
 * fires twice.
 */

import type { Channel } from '../store/types.js'

/** How far an outbound message got. */
export type DeliveryState = 'sent' | 'delivered' | 'read' | 'failed'

export interface DeliveryUpdate {
  /** The platform's id for the message, not ours. */
  messageId: string
  state: DeliveryState
  channel: Channel
  conversationId?: string
  /** Why, when the platform said. Only ever set on `failed`. */
  reason?: string
  /** Whatever else the platform sent, kept for a support ticket about it. */
  detail?: Record<string, unknown>
}

/**
 * How far along each state is, so a late one cannot move it backwards.
 *
 * `failed` sits above `read` on purpose: a failure after a read is a real
 * thing on some platforms (a message read on one device and rejected on
 * another) and it is the more important of the two to surface.
 */
const RANK: Record<DeliveryState, number> = { sent: 1, delivered: 2, read: 3, failed: 4 }

export interface DeliveryLog {
  /**
   * Records an update, and says whether it changed anything.
   *
   * False means it was a duplicate or a late arrival, and the caller should do
   * nothing at all with it. That return is the whole point: without it the
   * side effects run again on every re-delivery.
   */
  apply(update: DeliveryUpdate): boolean
  /** How far a message got, or undefined if nothing has been said about it. */
  stateOf(messageId: string): DeliveryState | undefined
  /** Everything known, for handing to a store or a dashboard. */
  entries(): Array<{ messageId: string; state: DeliveryState; at: number }>
}

export interface DeliveryLogOptions {
  /**
   * How many messages to remember.
   *
   * Bounded because a busy line would otherwise grow this for ever in a
   * long-lived process. The oldest are dropped, which is right: a status
   * arriving for a message that fell out of the window is old news anyway.
   */
  maxEntries?: number
  /** Called when a message actually moves forward, never on a duplicate. */
  onChange?: (update: DeliveryUpdate, previous?: DeliveryState) => void
}

/**
 * Keeps delivery states in order, whatever order they arrive in.
 *
 * In memory on purpose. This is a de-duplicator in front of whatever the host
 * really stores, and putting it in a database would mean a read and a write on
 * every status webhook, of which a busy line gets several per message.
 */
export function createDeliveryLog(options: DeliveryLogOptions = {}): DeliveryLog {
  const maxEntries = options.maxEntries ?? 5000
  const states = new Map<string, { state: DeliveryState; at: number }>()

  return {
    apply(update: DeliveryUpdate): boolean {
      const known = states.get(update.messageId)

      // Equal counts as stale, not as new. A re-delivered `read` is the same
      // fact arriving twice, and acting on it twice is the bug.
      if (known && RANK[known.state] >= RANK[update.state]) return false

      states.set(update.messageId, { state: update.state, at: Date.now() })

      // Map keeps insertion order, so the first key is the oldest.
      while (states.size > maxEntries) {
        const oldest = states.keys().next().value
        if (oldest === undefined) break
        states.delete(oldest)
      }

      options.onChange?.(update, known?.state)

      return true
    },

    stateOf(messageId) {
      return states.get(messageId)?.state
    },

    entries() {
      return [...states].map(([messageId, entry]) => ({ messageId, state: entry.state, at: entry.at }))
    },
  }
}
