import { defineAction } from '../define.js'
import type { Action, ActionField } from '../types.js'

export interface ClientActionOptions {
  name: string
  whenToUse: string
  collect?: ActionField[]
  /** Keeps it off the agent's own initiative; only a procedure can call it. */
  procedureOnly?: boolean
  /** Configuration the browser needs, sent with the request. */
  clientPayload?: Record<string, unknown>
}

/**
 * An action the browser runs instead of the server.
 *
 * Some things only exist on the page: the current cart, a logged-in session,
 * the scroll position, a native share sheet. The server cannot reach any of
 * that, so the turn pauses, the widget runs the handler the host registered,
 * and the result comes back with the next message.
 */
export function clientAction(options: ClientActionOptions): Action {
  return defineAction({
    name: options.name,
    whenToUse: options.whenToUse,
    collect: options.collect,
    procedureOnly: options.procedureOnly,
    clientPayload: options.clientPayload,
    runs: 'client',
  })
}

export interface SuggestionsOptions {
  whenToUse?: string
  max?: number
  /**
   * Takes the text box away while the suggestions are on screen, so the only
   * way on is to choose one.
   *
   * For a guided flow with a fixed set of answers, where a typed reply would
   * only be re-asked. Off by default, and it should stay off for ordinary
   * support: a customer whose question is not on the list has nowhere to put
   * it, and being unable to type at a support agent is its own bad experience.
   */
  pickOne?: boolean
}

/**
 * Offers clickable follow-ups.
 *
 * Support conversations stall when the customer does not know what else they
 * can ask. Letting the agent propose the next question converts far better
 * than a blank input box.
 */
export function suggestedMessages(options: SuggestionsOptions = {}): Action {
  const max = options.max ?? 3

  return defineAction({
    name: 'suggest_replies',
    whenToUse:
      options.whenToUse ??
      `Call this at most once per reply, after answering, to offer up to ${max} short follow-up ` +
        'questions the customer is likely to ask next. Skip it when the conversation is finished.',
    collect: [
      {
        name: 'suggestions',
        type: 'string',
        description: `Up to ${max} short questions, separated by a pipe character.`,
      },
    ],
    async execute(input, ctx) {
      const items = String(input.suggestions ?? '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, max)

      ctx.emit({ type: 'suggestions', items, ...(options.pickOne && items.length > 0 ? { pickOne: true } : {}) })
      return { shown: items.length, message: 'Suggestions displayed. Do not repeat them in your reply.' }
    },
  })
}
