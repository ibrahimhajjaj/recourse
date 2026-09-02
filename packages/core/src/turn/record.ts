import type { Match } from '../types.js'
import type { Channel, Store, StoredMessage } from '../store/types.js'
import type { Contact } from '../actions/types.js'
import type { Signal } from '../safety/types.js'
import type { Webhooks } from '../webhooks/index.js'
import { toSourceRefs } from '../server/prompt.js'
import { newId } from '../util/ids.js'

/**
 * The transcript row and the webhook for a turn the agent answered.
 *
 * The paused half of a client-action turn says nothing, and recording it would
 * put a blank reply in the transcript above the real one, so a turn that
 * neither spoke nor acted is written nowhere.
 */
export async function recordTurn(turn: {
  store?: Store
  webhooks?: Webhooks
  conversationId: string
  channel: Channel
  contact?: Contact
  /** `{ meta: { country } }` when this turn carried one, otherwise empty. */
  placed: { meta?: { country: string } }
  question: string
  answer: string
  matches: Match[]
  ran: Array<{ name: string; input: unknown; output: unknown }>
  flags: Signal[]
}): Promise<void> {
  if (turn.answer.trim().length === 0 && turn.ran.length === 0) return

  if (turn.store) {
    const record: StoredMessage = {
      id: newId('m'),
      role: 'assistant',
      content: turn.answer,
      createdAt: new Date().toISOString(),
      sources: toSourceRefs(turn.matches),
      // A turn that retrieved nothing and called nothing is a content gap.
      unanswered: turn.matches.length === 0 && turn.ran.length === 0,
    }
    if (turn.ran.length > 0) record.actions = turn.ran
    // Kept so "which answers invented a number" is a query rather than an
    // afternoon of reading transcripts.
    if (turn.flags.length > 0) {
      record.flags = turn.flags.map(({ category, score, reason }) => ({ category, score, reason }))
    }
    await turn.store.appendMessage(turn.conversationId, record, {
      channel: turn.channel,
      contact: turn.contact,
      ...turn.placed,
    })
  }

  turn.webhooks?.emit(turn.matches.length === 0 ? 'conversation.unanswered' : 'conversation.answered', {
    conversationId: turn.conversationId,
    channel: turn.channel,
    question: turn.question,
    answer: turn.answer,
    sources: toSourceRefs(turn.matches),
  })
}
