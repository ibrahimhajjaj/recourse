import { defineAction } from '../define.js'
import { pauseAgent } from '../../takeover.js'
import type { Action, ActionContext, ActionField, ActionInput } from '../types.js'
import type { StoredMessage } from '../../store/types.js'
import { INSIGHT_KEYS } from '../../insights.js'
import { getLogger } from '../../diagnostics.js'
import type { Channel } from '../../store/types.js'

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
  /**
   * What the agent already did, in the order it did it.
   *
   * The transcript says what was discussed; this says what was actually run and
   * what came back. Without it the person picking the ticket up cannot tell a
   * lookup that failed from one that was never attempted, and their first reply
   * asks the customer to confirm an order number the agent already checked.
   */
  tried?: Array<{ action: string; ok: boolean; detail?: string }>
  /**
   * How the customer seemed, when the conversation has been summarised.
   *
   * Not decoration. It is what decides whether this ticket is picked up next or
   * in an hour, and a person reading four hundred words of transcript to work
   * it out is the cost this exists to remove.
   */
  mood?: string
  /** A one-line summary of the conversation, when one has been made. */
  summary?: string
}

/**
 * The ticket body a person actually reads.
 *
 * Ordered by what they need first. The summary and the mood decide whether this
 * is picked up now or in an hour; what was already tried decides what their
 * first reply says. The transcript goes last, because it is the long version of
 * everything above it and most tickets are resolved without reading it.
 *
 * The failure this is shaped against is the common one: the handoff happens,
 * and the first human reply asks for the order number the customer already
 * gave and the agent already looked up. From the customer's side that is worse
 * than never having been offered the bot.
 */
export function ticketBody(ticket: EscalationRequest): string {
  const parts = [ticket.body]

  if (ticket.summary) parts.push('', `Summary: ${ticket.summary}`)
  if (ticket.mood) parts.push(`Customer seems: ${ticket.mood}`)

  if (ticket.tried?.length) {
    parts.push('', 'Already tried:')
    for (const attempt of ticket.tried) {
      parts.push(`- ${attempt.action}: ${attempt.ok ? 'ok' : `failed, ${attempt.detail ?? 'no detail'}`}`)
    }
  }

  if (ticket.transcript) parts.push('', 'Conversation so far:', ticket.transcript)

  return parts.join('\n')
}

export interface EscalateOptions {
  whenToUse?: string
  /**
   * The tool name, when one is not enough.
   *
   * Two escalations is a real configuration: one on the website and one on
   * Instagram, with different rules and different details to gather. They need
   * different names, since the tool set is keyed on the name and two actions
   * sharing one is refused rather than one quietly replacing the other.
   */
  name?: string
  /**
   * The channels this is offered on. Unset means all of them.
   *
   * Some of these only work in one place, and some are a policy rather than a
   * capability: a refund you are happy to let the agent issue to somebody who
   * signed in on the website is a different proposition over SMS.
   */
  channels?: Channel[]
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
/**
 * What the agent already ran this conversation, newest last.
 *
 * Kept short on purpose: a name, whether it worked, and a line of what came
 * back. The full input and output are in the transcript and in the store for
 * anybody who needs them; what the person picking this up needs is whether the
 * order was looked up and what it said.
 */
function attempted(messages: StoredMessage[]): EscalationRequest['tried'] {
  const tried: NonNullable<EscalationRequest['tried']> = []

  for (const message of messages) {
    for (const ran of message.actions ?? []) {
      const output = ran.output as { ok?: boolean; error?: unknown; data?: unknown } | undefined
      const ok = output?.ok !== false

      tried.push({
        action: ran.name,
        ok,
        // The error when it failed, because that is the useful half. On success
        // the fact that it ran is usually enough, and the data is in the store.
        ...(ok ? {} : { detail: String(output?.error ?? 'failed').slice(0, 200) }),
      })
    }
  }

  return tried.length > 0 ? tried : undefined
}

/**
 * Everything the person picking this up should not have to ask for.
 *
 * One read of the conversation rather than three, and every part optional: a
 * store that cannot be read costs the context, never the ticket. A ticket that
 * failed to open because the summary could not be fetched would be the worst
 * possible trade.
 */
async function contextFor(
  ctx: ActionContext,
): Promise<Pick<EscalationRequest, 'transcript' | 'tried' | 'mood' | 'summary'>> {
  if (!ctx.store || !ctx.conversationId) return {}

  try {
    const thread = await ctx.store.getConversation(ctx.conversationId)
    if (!thread) return {}

    const said = thread.messages
      .slice(-CARRIED)
      .map((message) => `${message.role === 'user' ? 'Customer' : 'Agent'}: ${message.content}`)

    const meta = thread.conversation.meta ?? {}
    const mood = meta[INSIGHT_KEYS.mood]
    const summary = meta[INSIGHT_KEYS.summary]

    return {
      ...(said.length > 0 ? { transcript: said.join('\n') } : {}),
      ...(attempted(thread.messages) ? { tried: attempted(thread.messages) } : {}),
      ...(typeof mood === 'string' ? { mood } : {}),
      ...(typeof summary === 'string' ? { summary } : {}),
    }
  } catch {
    // A store that cannot be read costs the context, not the ticket.
    return {}
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
    name: options.name ?? 'escalate_to_human',
    ...(options.channels ? { channels: options.channels } : {}),
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
        ...(await contextFor(ctx)),
      }

      let id: string | undefined

      if (options.helpdesk) {
        const opened = await options.helpdesk.openTicket({
          subject: ticket.subject,
          description: ticketBody(ticket),
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
          // Nobody is on it yet. Saying a colleague already has it would have the
          // customer wait longer than they otherwise would.
          await pauseAgent(ctx.store, ctx.conversationId, { assigned: false })
        } catch (error) {
          // The ticket exists and the customer has been told. Failing the
          // whole action over the flag would lose both.
          getLogger().warn(`could not mark the conversation as taken over: ${String(error)}`)
        }
      }

      ctx.emit({ type: 'handoff', ticketId: id, message })
      return { escalated: true, ticketId: id, message: `Tell the customer: ${message}` }
    },
  })
}
