import type { Message } from '../types.js'
import type { Classifier } from '../safety/classify.js'
import type { Decision } from '../safety/types.js'

export interface ScreenedInput {
  /** The conversation as everything downstream should read it. */
  messages: Message[]
  /** The last message's text, after any rewrite. */
  question: string
  /** Null when no classifier is configured. */
  decision: Decision | null
}

/**
 * The customer's message, checked and cleaned, before anything is spent on it.
 *
 * Runs before retrieval and before the model, because a refused message should
 * cost neither. This is the tier that makes the hostile path faster than the
 * ordinary one rather than slower.
 *
 * Detectors may rewrite as well as judge: smuggled invisible characters come
 * out here, so everything downstream reads what the customer sees. The caller
 * decides what a blocking verdict means, because refusing is a turn's worth of
 * frames and only the generator can produce those.
 */
export async function screenInput(
  messages: Message[],
  classifier: Classifier | null,
  conversationId: string,
): Promise<ScreenedInput> {
  const last = messages[messages.length - 1]
  const decision = classifier ? await classifier.check(last?.content ?? '', { conversationId }) : null

  const cleaned =
    decision && last && decision.text !== last.content
      ? messages.map((message, position) =>
          position === messages.length - 1 ? { ...message, content: decision.text } : message,
        )
      : messages

  return { messages: cleaned, question: cleaned[cleaned.length - 1]?.content ?? '', decision }
}
