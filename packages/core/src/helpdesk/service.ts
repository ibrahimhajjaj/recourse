import type { Store } from '../store/types.js'
import type { Webhooks } from '../webhooks/index.js'
import type { Agent } from '../agent.js'
import { defaultViews, evaluateTriggers, type SavedView, type Trigger } from './triggers.js'
import type { Channel } from '../store/types.js'
import { assignTicket, loadOf, type AssignmentAlgorithm } from './assignment.js'
import { routeTicket, type RoutingRule } from './routing.js'
import { DEFAULT_STATUSES, defaultStatusFor, validateStatuses } from './statuses.js'
import type {
  StatusCategory,
  Team,
  Ticket,
  TicketCustomer,
  TicketFilter,
  TicketMessage,
  TicketMessageSender,
  TicketStatus,
} from './types.js'

export interface HelpdeskOptions {
  store: Store
  /** Defaults to a workable set covering every category. */
  statuses?: TicketStatus[]
  teams?: Team[]
  /** Ordered, first-match. Falls back to the default team. */
  routing?: RoutingRule[]
  assignment?: AssignmentAlgorithm
  /** Fires after a ticket is opened. Send the email, ping Slack, page someone. */
  onTicketOpened?: (ticket: Ticket) => void | Promise<void>
  /** Fires whenever a ticket changes, with the fields that changed. */
  onTicketUpdated?: (ticket: Ticket, patch: Partial<Ticket>) => void | Promise<void>
  /** Announces ticket events to other systems. */
  webhooks?: Webhooks
  /** Housekeeping rules that run when a ticket is created or changed. */
  triggers?: Trigger[]
  /** Named filters an agent can switch between. Defaults to three common ones. */
  views?: SavedView[]
  /**
   * Lets an agent draft a reply for a human to review. The same agent that
   * answers the widget, so a drafted reply cites the same documentation.
   */
  agent?: Agent
}

export interface OpenTicketInput {
  subject: string
  description: string
  customer: TicketCustomer
  channel?: Channel
  conversationId?: string
  metadata?: Record<string, unknown>
  /** Overrides routing when the caller already knows. */
  teamId?: string
  assigneeId?: string
}

/**
 * The help desk as a small service over the store.
 *
 * Everything a ticket needs decided at birth happens here in one place: which
 * status it starts in, which team owns it, and who picks it up. Scattering
 * those three decisions across the callers is how two channels end up creating
 * subtly different tickets for the same problem.
 */
export function createHelpdesk(options: HelpdeskOptions) {
  const statuses = options.statuses ?? DEFAULT_STATUSES
  validateStatuses(statuses)

  const teams = options.teams ?? []
  const routing = options.routing ?? []
  const { store } = options

  /** Round robin needs to remember where it stopped. */
  let lastAssignedId: string | undefined

  const triggers = options.triggers ?? []
  const views = options.views ?? defaultViews()

  /**
   * Applies whatever the rules decided.
   *
   * Runs after the ticket exists rather than on the draft, because a rule can
   * reasonably depend on the number, the assignee, or the routing decision.
   */
  async function runTriggers(ticket: Ticket, event: 'created' | 'updated'): Promise<Ticket> {
    const fired = evaluateTriggers(ticket, triggers, event)
    if (fired.length === 0) return ticket

    let current = ticket

    for (const { name, action } of fired) {
      const patch: Partial<Ticket> = {}

      if (action.setStatusCategory) {
        const status = defaultStatusFor(action.setStatusCategory, statuses)
        if (status) {
          patch.statusId = status.id
          patch.statusCategory = status.category
        }
      }
      if (action.setTeamId !== undefined) patch.teamId = action.setTeamId
      if (action.setAssigneeId !== undefined) patch.assigneeId = action.setAssigneeId ?? undefined
      if (action.setMetadata) patch.metadata = { ...current.metadata, ...action.setMetadata }

      if (Object.keys(patch).length > 0) {
        current = (await store.updateTicket(current.ticketNumber, patch)) ?? current
      }

      await store.addTicketMessage({
        ticketNumber: current.ticketNumber,
        type: 'event',
        sender: { type: 'system' },
        content: action.addNote ?? `Trigger "${name}" ran.`,
        createdAt: new Date().toISOString(),
        metadata: { event: 'trigger', trigger: name },
      })
    }

    return current
  }

  async function openTicket(input: OpenTicketInput): Promise<Ticket> {
    const now = new Date().toISOString()
    const status = defaultStatusFor('new', statuses)
    if (!status) throw new Error('no status in the "new" category to open a ticket into')

    const draft: Omit<Ticket, 'ticketNumber'> = {
      subject: input.subject.slice(0, 200),
      description: input.description,
      statusId: status.id,
      statusCategory: status.category,
      customer: input.customer,
      channel: input.channel ?? 'web',
      conversationId: input.conversationId,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    }

    // Routing needs a ticket to look at, so decide on the draft and apply after.
    const provisional = { ...draft, ticketNumber: 0 } as Ticket
    const routed = input.teamId ? { teamId: input.teamId } : routeTicket(provisional, routing, teams)
    draft.teamId = routed.teamId

    if (input.assigneeId) {
      draft.assigneeId = input.assigneeId
    } else if (draft.teamId) {
      const team = teams.find((candidate) => candidate.id === draft.teamId)
      if (team?.members.length) {
        const open = await store.listTickets({ openOnly: true, limit: 200 })
        const assignee = assignTicket({
          algorithm: options.assignment,
          candidates: loadOf(open.items, team.members),
          lastAssignedId,
        })
        if (assignee) {
          draft.assigneeId = assignee
          lastAssignedId = assignee
        }
      }
    }

    const ticket = await store.createTicket(draft)

    // An opening event, so the thread reads as a history rather than starting
    // mid-conversation with the first reply.
    await store.addTicketMessage({
      ticketNumber: ticket.ticketNumber,
      type: 'event',
      sender: { type: 'system' },
      content: routed.rule ? `Opened and routed by "${routed.rule}".` : 'Opened.',
      createdAt: now,
      metadata: { event: 'opened', rule: routed.rule, teamId: ticket.teamId, assigneeId: ticket.assigneeId },
    })

    const afterTriggers = await runTriggers(ticket, 'created')

    options.webhooks?.emit('ticket.opened', { ticket: afterTriggers })
    await options.onTicketOpened?.(afterTriggers)
    return afterTriggers
  }

  async function update(
    ticketNumber: number,
    patch: { statusId?: string; statusCategory?: StatusCategory; assigneeId?: string | null; teamId?: string | null },
  ): Promise<Ticket | null> {
    const existing = await store.getTicket(ticketNumber)
    if (!existing) return null

    const resolved: Partial<Ticket> = {}

    if (patch.statusId) {
      const status = statuses.find((candidate) => candidate.id === patch.statusId)
      if (!status) throw new Error(`unknown status "${patch.statusId}"`)
      resolved.statusId = status.id
      resolved.statusCategory = status.category
    } else if (patch.statusCategory) {
      const status = defaultStatusFor(patch.statusCategory, statuses)
      if (!status) throw new Error(`no status in the "${patch.statusCategory}" category`)
      resolved.statusId = status.id
      resolved.statusCategory = status.category
    }

    if (patch.assigneeId !== undefined) resolved.assigneeId = patch.assigneeId ?? undefined
    if (patch.teamId !== undefined) resolved.teamId = patch.teamId ?? undefined

    const updated = await store.updateTicket(ticketNumber, resolved)
    if (!updated) return null

    if (resolved.statusId && resolved.statusId !== existing.statusId) {
      await store.addTicketMessage({
        ticketNumber,
        type: 'event',
        sender: { type: 'system' },
        content: `Status changed to ${statuses.find((s) => s.id === resolved.statusId)?.internalLabel ?? resolved.statusId}.`,
        createdAt: new Date().toISOString(),
        metadata: { event: 'status', from: existing.statusId, to: resolved.statusId },
      })
    }

    options.webhooks?.emit('ticket.updated', { ticket: updated, changed: resolved })
    await options.onTicketUpdated?.(updated, resolved)
    return updated
  }

  async function post(
    ticketNumber: number,
    type: TicketMessage['type'],
    content: string,
    sender: TicketMessageSender,
  ): Promise<TicketMessage | null> {
    const ticket = await store.getTicket(ticketNumber)
    if (!ticket) return null

    const message = await store.addTicketMessage({
      ticketNumber,
      type,
      sender,
      content,
      createdAt: new Date().toISOString(),
    })

    // A reply to the customer puts the ball in their court; an internal note
    // changes nothing about whose move it is.
    if (type === 'reply' && sender.type === 'agent') {
      await update(ticketNumber, { statusCategory: 'on_customer' })
    } else if (type === 'reply' && sender.type === 'customer') {
      await update(ticketNumber, { statusCategory: 'on_you' })
    }

    return message
  }

  return {
    openTicket,
    update,

    getTicket: (ticketNumber: number) => store.getTicket(ticketNumber),
    listTickets: (filter?: TicketFilter) => store.listTickets(filter),
    searchTickets: (query: string, limit?: number) => store.searchTickets(query, limit),
    listMessages: (ticketNumber: number) => store.listTicketMessages(ticketNumber),

    /** A reply the customer will see. */
    reply: (ticketNumber: number, content: string, sender: TicketMessageSender) =>
      post(ticketNumber, 'reply', content, sender),
    /** An internal note the customer will not see. */
    note: (ticketNumber: number, content: string, sender: TicketMessageSender) =>
      post(ticketNumber, 'note', content, sender),

    statuses: () => statuses,
    teams: () => teams,
    views: () => views,

    /**
     * Runs a saved view, so an agent's queue is one call rather than a filter.
     *
     * Async even for the "no such view" case: a function that returns a promise
     * on success and throws synchronously on failure forces every caller to
     * write both a try/catch and a .catch().
     */
    async runView(id: string) {
      const view = views.find((candidate) => candidate.id === id)
      if (!view) throw new Error(`no saved view called "${id}"`)
      return store.listTickets(view.filter)
    },

    /**
     * Drafts a reply for a human to send.
     *
     * Deliberately never sends it. A drafted reply is a suggestion made from
     * the same documentation the widget uses, and the value is that a person
     * reads it before a customer does.
     */
    async draftReply(ticketNumber: number): Promise<{ text: string; unanswered: boolean } | null> {
      if (!options.agent) throw new Error('drafting needs an agent; pass one to createHelpdesk')

      const ticket = await store.getTicket(ticketNumber)
      if (!ticket) return null

      const thread = await store.listTicketMessages(ticketNumber)
      const conversation = thread.items
        .filter((message) => message.type !== 'event')
        .map((message) => `${message.sender.type === 'customer' ? 'Customer' : 'Agent'}: ${message.content}`)
        .join('\n')

      const question = [`Subject: ${ticket.subject}`, ticket.description, conversation]
        .filter(Boolean)
        .join('\n\n')

      const { text, unanswered } = await options.agent.answer(question, [], {
        // Not the ticket's own conversation: a draft is not a turn the
        // customer had, and recording it would corrupt the transcript.
        conversationId: `draft:${ticketNumber}`,
        contact: { name: ticket.customer.name, email: ticket.customer.email },
        channel: 'api',
      })

      return { text, unanswered }
    },
  }
}

export type Helpdesk = ReturnType<typeof createHelpdesk>
