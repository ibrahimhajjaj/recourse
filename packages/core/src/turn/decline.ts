import type { Message, StreamFrame } from '../types.js'
import type { Channel, Store, StoredMessage } from '../store/types.js'
import type { Contact } from '../actions/types.js'
import type { Decision } from '../safety/types.js'
import type { Webhooks } from '../webhooks/index.js'
import { newId } from '../util/ids.js'

/** Where a turn nobody answered still has to be written. */
export interface DeclineTargets {
  store?: Store
  webhooks?: Webhooks
}

/**
 * The turn a refused message gets instead.
 *
 * Still a complete turn: the transcript records what was asked and what was
 * said, the webhooks fire, and the customer gets a sentence rather than
 * silence. A refusal nobody can audit is not a safety feature.
 */
export async function* refuse(
  decision: Decision,
  turn: { conversationId: string; channel: Channel; contact?: Contact; question: string },
  into: DeclineTargets,
): AsyncGenerator<StreamFrame> {
  const message =
    decision.message ??
    (decision.action === 'handoff'
      ? 'Let me put you through to someone who can help.'
      : 'I can only help with questions about our products and your orders.')

  yield { type: 'sources', sources: [] }

  if (decision.action === 'handoff') {
    yield { type: 'handoff', message }
  } else {
    yield { type: 'delta', text: message }
  }

  if (into.store) {
    const now = new Date().toISOString()
    await into.store.appendMessage(
      turn.conversationId,
      { id: newId('m'), role: 'user', content: turn.question, createdAt: now },
      { channel: turn.channel, contact: turn.contact },
    )
    await into.store.appendMessage(turn.conversationId, {
      id: newId('m'),
      role: 'assistant',
      content: message,
      createdAt: now,
      // Not a content gap: the agent knew exactly what it was doing.
      unanswered: false,
    })
  }

  into.webhooks?.emit('conversation.answered', {
    conversationId: turn.conversationId,
    channel: turn.channel,
    question: turn.question,
    answer: message,
    sources: [],
    // So a reviewer can see why this turn looks the way it does.
    blocked: { action: decision.action, category: decision.matched?.category, reason: decision.matched?.reason },
  })

  yield { type: 'done' }
}

/**
 * A turn the agent deliberately does not answer.
 *
 * A person has taken the conversation, or a spending cap has been reached.
 * Neither is the customer's fault and neither is a refusal, so this is not
 * `refuse`: nothing is blocked, no safety verdict is recorded, and the turn
 * is not counted as a documentation gap.
 *
 * What it must still do is store what the customer said. That message is the
 * entire reason the pause is survivable: the person who took the ticket over
 * reads it, and the customer does not have to type it twice.
 */
export async function* stayQuiet(
  message: string,
  turn: {
    conversationId: string
    channel: Channel
    contact?: Contact
    question: string
    attachments: Message['attachments']
  },
  into: DeclineTargets,
): AsyncGenerator<StreamFrame> {
  yield { type: 'sources', sources: [] }
  yield { type: 'delta', text: message }

  if (into.store) {
    const now = new Date().toISOString()
    const asked: StoredMessage = { id: newId('m'), role: 'user', content: turn.question, createdAt: now }
    if (turn.attachments?.length) {
      asked.attachments = turn.attachments.map(({ name, mimeType, bytes }) => ({ name, mimeType, bytes }))
    }

    await into.store.appendMessage(turn.conversationId, asked, {
      channel: turn.channel,
      contact: turn.contact,
    })
    await into.store.appendMessage(turn.conversationId, {
      id: newId('m'),
      role: 'assistant',
      content: message,
      createdAt: now,
      // Retrieval never ran, so calling this a content gap would put a
      // question nobody tried to answer at the top of the list to fix.
      unanswered: false,
    })
  }

  yield { type: 'done' }
}
