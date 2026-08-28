import { defineAction } from '../define.js'
import type { Action, ActionContext, ActionField, ActionInput } from '../types.js'

export interface Ticket {
  subject: string
  body: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  email?: string
  name?: string
  conversationId?: string
  /** The transcript so far, so a human does not have to ask again. */
  transcript?: string
}

export interface EscalateOptions {
  whenToUse?: string
  /** Extra fields to gather before opening the ticket. */
  fields?: ActionField[]
  /**
   * Where the ticket goes. Return an id or reference the customer can quote.
   * Any help desk works: Zendesk, Freshdesk, Intercom, Linear, a database, an
   * email to your support alias.
   */
  createTicket(ticket: Ticket, ctx: ActionContext): Promise<{ id?: string } | void> | { id?: string } | void
  /** Said to the customer once the ticket exists. */
  confirmation?: string
}

const BASE_FIELDS: ActionField[] = [
  { name: 'subject', type: 'string', description: 'A one-line summary of the problem.' },
  {
    name: 'body',
    type: 'string',
    description: 'The full problem in the customer’s words, plus anything you learned.',
  },
  {
    name: 'email',
    type: 'string',
    description: 'Where to reply. Ask for it if you do not already have it.',
    required: false,
  },
  { name: 'name', type: 'string', description: "The customer's name, if known.", required: false },
  {
    name: 'priority',
    type: 'string',
    description: 'How urgent this is. Reserve urgent for money lost or service down.',
    required: false,
    options: ['low', 'normal', 'high', 'urgent'],
  },
]

/**
 * Hands the conversation to a person.
 *
 * This is the most important action a support agent has. An agent that cannot
 * escalate will keep trying to answer a question it cannot answer, which is
 * worse for the customer than admitting it early.
 */
export function escalate(options: EscalateOptions): Action {
  return defineAction({
    name: 'escalate_to_human',
    whenToUse:
      options.whenToUse ??
      'Use when the customer asks for a person, is frustrated or complaining, raises a billing ' +
        'dispute, account or security issue, or asks something the documentation does not answer. ' +
        'Prefer escalating over guessing. Gather the subject and details first, then call this once.',
    collect: [...BASE_FIELDS, ...(options.fields ?? [])],

    async execute(input: ActionInput, ctx) {
      const priority = String(input.priority ?? 'normal')

      const result = await options.createTicket(
        {
          subject: String(input.subject ?? 'Support request'),
          body: String(input.body ?? ''),
          priority: (['low', 'normal', 'high', 'urgent'] as const).includes(
            priority as 'low' | 'normal' | 'high' | 'urgent',
          )
            ? (priority as 'low' | 'normal' | 'high' | 'urgent')
            : 'normal',
          email: input.email ? String(input.email) : ctx.contact?.email,
          name: input.name ? String(input.name) : ctx.contact?.name,
          conversationId: ctx.conversationId,
        },
        ctx,
      )

      const id = result && typeof result === 'object' ? result.id : undefined
      const message =
        options.confirmation ??
        (id
          ? `A person will take this over. Your reference is ${id}.`
          : 'A person will take this over and reply shortly.')

      ctx.emit({ type: 'handoff', ticketId: id, message })
      return { escalated: true, ticketId: id, message: `Tell the customer: ${message}` }
    },
  })
}
