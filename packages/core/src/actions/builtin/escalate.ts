import { defineAction } from '../define.js'
import { pauseAgent } from '../../takeover.js'
import type { Action, ActionContext, ActionField, ActionInput } from '../types.js'

/**
 * What `escalate` hands to whatever opens the ticket.
 *
 * Named for the request rather than the record on purpose: `Ticket` is the
 * thing the help desk stores, with a number, a status and an assignee. This is
 * the message that asks for one.
 */
export interface EscalationRequest {
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
   * Opens the ticket on the built-in help desk. Supply this instead of
   * `createTicket` when you want routing, assignment and a thread rather than
   * just a webhook into somebody else's system.
   */
  helpdesk?: {
    openTicket(input: {
      subject: string
      description: string
      customer: { name?: string; email?: string }
      conversationId?: string
      metadata?: Record<string, unknown>
    }): Promise<{ ticketNumber: number }>
  }
  /**
   * Where the ticket goes. Return an id or reference the customer can quote.
   * Any help desk works: Zendesk, Freshdesk, Intercom, Linear, a database, an
   * email to your support alias.
   */
  createTicket?(ticket: EscalationRequest, ctx: ActionContext): Promise<{ id?: string } | void> | { id?: string } | void
  /** Said to the customer once the ticket exists. */
  confirmation?: string
  /** Keeps it off the agent's own initiative; only a procedure can call it. */
  procedureOnly?: boolean
  /**
   * Marks the conversation as belonging to a person from here on.
   *
   * On by default, and free unless the agent was built with `takeover`, which
   * is the option that makes it read the flag. Setting it either way means an
   * escalation that happens today keeps working when somebody turns takeover
   * on tomorrow, rather than quietly not having been recorded.
   *
   * Turn it off where the ticket goes somewhere nobody replies from, such as a
   * webhook into a reporting system, since a conversation paused for a person
   * who will never arrive is a conversation that stops answering.
   */
  pause?: boolean
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


/** How much of the conversation goes on the ticket. */
const CARRIED = 20

/**
 * What was actually said, for the person picking the ticket up.
 *
 * The agent writes the body from what it understood, which is the thing most
 * worth double checking when it has just given up. Without this an agent reads
 * a summary of a conversation it cannot see and asks the customer to explain
 * it a third time.
 */
async function transcriptOf(ctx: ActionContext): Promise<string | undefined> {
  if (!ctx.store || !ctx.conversationId) return undefined

  try {
    const thread = await ctx.store.getConversation(ctx.conversationId)
    const said = (thread?.messages ?? [])
      .slice(-CARRIED)
      .map((message) => `${message.role === 'user' ? 'Customer' : 'Agent'}: ${message.content}`)

    return said.length > 0 ? said.join('\n') : undefined
  } catch {
    // A store that cannot be read costs the transcript, not the ticket.
    return undefined
  }
}

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
    procedureOnly: options.procedureOnly,

    async execute(input: ActionInput, ctx) {
      const priority = String(input.priority ?? 'normal')

      const ticket: EscalationRequest = {
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
        transcript: await transcriptOf(ctx),
      }

      let id: string | undefined

      if (options.helpdesk) {
        const opened = await options.helpdesk.openTicket({
          subject: ticket.subject,
          description: ticket.body,
          customer: { name: ticket.name, email: ticket.email },
          conversationId: ticket.conversationId,
          metadata: { priority: ticket.priority },
        })
        id = String(opened.ticketNumber)
      }

      if (options.createTicket) {
        const result = await options.createTicket(ticket, ctx)
        if (result && typeof result === 'object' && result.id) id = result.id
      }

      if (!options.helpdesk && !options.createTicket) {
        throw new Error('escalate needs either a helpdesk or a createTicket handler')
      }
      const message =
        options.confirmation ??
        (id
          ? `A person will take this over. Your reference is ${id}.`
          : 'A person will take this over and reply shortly.')

      // After this the person owns the conversation. Recorded before the
      // frame goes out, so a customer typing again immediately is already met
      // by the pause rather than by one last answer from the agent.
      if (options.pause !== false && ctx.store && ctx.conversationId) {
        try {
          await pauseAgent(ctx.store, ctx.conversationId)
        } catch (error) {
          // The ticket exists and the customer has been told. Failing the
          // whole action over the flag would lose both.
          console.warn(`[recourse] could not mark the conversation as taken over: ${String(error)}`)
        }
      }

      ctx.emit({ type: 'handoff', ticketId: id, message })
      return { escalated: true, ticketId: id, message: `Tell the customer: ${message}` }
    },
  })
}
