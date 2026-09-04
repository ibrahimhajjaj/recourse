import type { Store } from '../store/types.js'
import { getLogger } from '../diagnostics.js'
import type { Webhooks } from '../webhooks/index.js'
import type { Agent } from '../agent.js'
import { defaultViews, evaluateTriggers, type SavedView, type Trigger } from './triggers.js'
import type { Channel } from '../store/types.js'
import { assignTicket, type AssignmentAlgorithm, type Availability } from './assignment.js'
import { ticketStats } from './stats.js'
import { routeTicket, type RoutingRule } from './routing.js'
import { DEFAULT_STATUSES, defaultStatusFor, validateStatuses } from './statuses.js'
import { detectAndTranslate, type TranslationOptions } from './translate.js'
import { anyoneOnShift, availabilityAt, type Schedule } from './schedule.js'
import { RESOLVED_CATEGORIES } from './types.js'
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
  /**
   * How many open tickets one agent may hold before auto-assignment stops
   * giving them more. Unset means no limit.
   *
   * Matters most under `round_robin`, which rotates without looking at load:
   * an agent sitting on forty open tickets keeps being handed the next one.
   * A ticket nobody is eligible for stays unassigned, which is the honest
   * outcome and the one the unassigned queue exists for.
   */
  maxOpenPerAgent?: number
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
  /**
   * Translates inbound customer messages into the language the team reads.
   *
   * Customer messages only. Agent replies, internal notes and system events
   * are left exactly as written, because a mistranslated promise sent over an
   * agent's name is a worse problem than a ticket they have to paste into a
   * translator themselves.
   */
  translation?: TranslationOptions
  /**
   * Who is at work, so a ticket is not handed to somebody asleep.
   *
   * Without it everybody counts as available, which is what happened before
   * and is why a three in the morning ticket went to whoever was next in the
   * list. An unassigned ticket is visible in the queue; a ticket assigned to a
   * sleeping person is not.
   */
  /**
   * Sends an agent's reply back to the customer on the channel they used.
   *
   * Without it a handover is only half of one. The ticket records what the
   * agent wrote and marks the ball as the customer's, and on a channel the desk
   * does not itself own, the customer never sees a word of it. They are sitting
   * in WhatsApp having been told a colleague is coming.
   *
   * Not called for internal notes, and not for the customer's own messages:
   * those are already where they came from.
   *
   * A desk that owns the channel needs none of this. Answering inside Intercom's
   * messenger, or through Sunshine, puts the reply in front of the customer
   * already, and wiring this as well sends it twice.
   */
  deliver?: (reply: {
    ticket: Ticket
    channel: Channel
    conversationId: string
    content: string
    sender: TicketMessageSender
  }) => void | Promise<void>
  schedule?: Schedule
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
   * What each member of a team currently has open, and when they last got one.
   *
   * Asked per person rather than by scanning a page of the queue. The scan was
   * one call reading two hundred tickets, which is both more work and wrong:
   * a desk with more open tickets than that undercounted everybody, so the
   * least-busy agent was whoever happened to be missing from the page and a
   * cap on open tickets never tripped.
   *
   * One query each, returning a count and their newest ticket, which is all
   * the two algorithms need between them.
   */
  async function loadOfTeam(members: string[]): Promise<Availability[]> {
    return Promise.all(
      members.map(async (id) => {
        const page = await store.listTickets({
          openOnly: true,
          assigneeId: id,
          limit: 1,
          includeTotal: true,
          sortBy: 'created',
          order: 'desc',
        })

        const newest = page.items[0]

        return {
          id,
          available: true,
          openTickets: page.total ?? page.items.length,
          ...(newest ? { lastAssignedAt: newest.createdAt } : {}),
        }
      }),
    )
  }

  /**
   * Applies whatever the rules decided.
   *
   * Runs after the ticket exists rather than on the draft, because a rule can
   * reasonably depend on the number, the assignee, or the routing decision.
   */
  async function runTriggers(
    ticket: Ticket,
    event: 'created' | 'updated',
    /** What it looked like before, so a rule can match on what moved. */
    previous?: Ticket,
  ): Promise<Ticket> {
    const fired = evaluateTriggers(ticket, triggers, event, previous)
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

    // The subject and the description are the first things an agent reads and
    // the only ones that exist before any reply, so they are translated here
    // rather than waiting for the customer's second message.
    if (options.translation) {
      const opening = await detectAndTranslate(`${input.subject}\n\n${input.description}`, options.translation)

      if (!opening.skipped && opening.translation) {
        draft.metadata = {
          ...draft.metadata,
          language: opening.language,
          translation: opening.translation,
          translatedInto: options.translation.target,
        }
      } else if (opening.language !== 'unknown') {
        draft.metadata = { ...draft.metadata, language: opening.language }
      }
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
        const loads = await loadOfTeam(team.members)

        const maxOpen = team.maxOpenPerAgent ?? options.maxOpenPerAgent

        const assignee = assignTicket({
          // The team's own setting where it has one. A desk-wide default is
          // right until the first team that is a different shape.
          algorithm: team.assignment ?? options.assignment,
          candidates: options.schedule
            ? availabilityAt(new Date(now), options.schedule, loads)
            : loads,
          lastAssignedId,
          ...(maxOpen === undefined ? {} : { maxOpen }),
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

    // Closed, and now not closed. Counted here because it is the only moment
    // the transition is visible: a ticket keeps its current status and nothing
    // else, so afterwards there is no way to tell this one from a ticket that
    // was never resolved at all.
    if (
      resolved.statusCategory &&
      RESOLVED_CATEGORIES.includes(existing.statusCategory) &&
      !RESOLVED_CATEGORIES.includes(resolved.statusCategory)
    ) {
      resolved.reopened = (existing.reopened ?? 0) + 1
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

    // Rules written for `updated` used to be configuration that did nothing:
    // they were only ever evaluated when a ticket was created, so a desk that
    // wrote "when a ticket is reopened, put it back in the queue" watched it
    // never happen and had nothing to read that said why. `existing` goes with
    // it, since a rule about a transition needs both ends of one.
    //
    // Rules reach the store directly rather than coming back through here, so
    // one firing cannot set off another round of the same rules.
    return runTriggers(updated, 'updated', existing)
  }

  /**
   * The translation metadata for a message, when it earns one.
   *
   * The content itself is never touched. An agent reads the translation and
   * can always fall back to what the customer actually typed, which matters
   * the moment a translation looks wrong.
   */
  async function translationFor(
    type: TicketMessage['type'],
    sender: TicketMessageSender,
    content: string,
  ): Promise<{ metadata?: Record<string, unknown> }> {
    if (!options.translation || type !== 'reply' || sender.type !== 'customer') return {}

    const result = await detectAndTranslate(content, options.translation)

    // The language is worth recording even when nothing was translated: it is
    // what tells a drafted reply which language to come back in.
    if (result.skipped) {
      return result.language === 'unknown' ? {} : { metadata: { language: result.language } }
    }

    return {
      metadata: {
        language: result.language,
        translation: result.translation,
        translatedInto: options.translation.target,
      },
    }
  }

  /**
   * Carries an agent's reply out to the channel the customer is on.
   *
   * A failure here must not lose the reply, which is already saved. The ticket
   * is the record and delivery is a best effort on top of it, so this logs
   * rather than throws: an operator needs to know it did not arrive, so they
   * can chase it by hand instead of assuming it landed.
   */
  async function handOver(
    ticket: Ticket,
    content: string,
    sender: TicketMessageSender,
  ): Promise<void> {
    if (!options.deliver || !ticket.conversationId) return

    try {
      await options.deliver({
        ticket,
        channel: ticket.channel,
        conversationId: ticket.conversationId,
        content,
        sender,
      })
    } catch (error) {
      getLogger().error(
        `ticket ${ticket.ticketNumber}: the reply is saved but did not reach the customer on ${ticket.channel}`,
        error,
      )
    }
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
      ...(await translationFor(type, sender, content)),
    })

    // A reply to the customer puts the ball in their court; an internal note
    // changes nothing about whose move it is.
    if (type === 'reply' && sender.type === 'agent') {
      await update(ticketNumber, { statusCategory: 'on_customer' })
      await handOver(ticket, content, sender)
    } else if (type === 'reply' && sender.type === 'customer') {
      await update(ticketNumber, { statusCategory: 'on_you' })
    }

    return message
  }

  return {
    openTicket,
    update,

    /**
     * Whether anybody is on shift right now.
     *
     * What `{{agentAvailable}}` resolves to in a procedure, so one can say
     * "offer live chat if somebody is there, open a ticket if not" rather than
     * promising a reply nobody is awake to write.
     *
     * True with no schedule configured, because a deployment that has not
     * described its hours has not said anybody is away.
     */
    agentAvailable(at: Date = new Date()): boolean {
      if (!options.schedule) return true

      const members = teams.flatMap((team) => team.members)
      return anyoneOnShift(at, options.schedule, members)
    },

    /** Who is on shift now, for the management API. */
    availability(at: Date = new Date()) {
      const members = [...new Set(teams.flatMap((team) => team.members))]

      if (!options.schedule) {
        return members.map((id) => ({ id, available: true, openTickets: 0 }))
      }

      return availabilityAt(
        at,
        options.schedule,
        members.map((id) => ({ id, openTickets: 0 })),
      )
    },

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

    /**
     * The queue's numbers over whatever slice the filter names.
     *
     * Reads the threads as well as the tickets, because the response times are
     * only in the messages: how long somebody waited is the gap between what
     * they said and what a person said back, and no field on a ticket records
     * it. That makes this heavier than `listTickets`, so it is a dashboard
     * call rather than something to run per turn.
     */
    async stats(filter: TicketFilter = {}, options: { most?: number } = {}) {
      // Paged through rather than one call. A single page was 200 tickets, so
      // a desk with five thousand reported "created: 200" and meant it, which
      // is the worst kind of wrong number: confident, plausible and quietly
      // covering a fortieth of the data.
      const most = options.most ?? 2000
      const tickets: Ticket[] = []
      let cursor: string | undefined

      do {
        const page = await store.listTickets({ limit: 200, ...filter, ...(cursor ? { cursor } : {}) })
        tickets.push(...page.items)
        cursor = page.cursor
      } while (cursor && tickets.length < most)

      const threads = new Map<number, TicketMessage[]>()

      for (const ticket of tickets) {
        // Every message, not the first page of them. The close event is the
        // last thing on a thread, so on a long ticket a default page would
        // miss it and the time-to-close would silently fall back to whenever
        // the ticket was last touched.
        const thread: TicketMessage[] = []
        let at: string | undefined

        do {
          const page = await store.listTicketMessages(ticket.ticketNumber, {
            limit: 200,
            ...(at ? { cursor: at } : {}),
          })
          thread.push(...page.items)
          at = page.cursor
        } while (at && thread.length < 1000)

        threads.set(ticket.ticketNumber, thread)
      }

      // Said out loud when the slice was cut short, because a partial answer a
      // reader believes is a whole one is worse than no answer.
      return { ...ticketStats(tickets, threads), ...(cursor ? { partial: true } : {}) }
    },

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

      // The customer wrote in their own language, so the reply has to come
      // back in it. The prompt already says to answer in the language the
      // customer wrote in, and on a translated ticket the model is reading the
      // translation, so it would answer in that instead.
      const language = typeof ticket.metadata?.language === 'string' ? ticket.metadata.language : ''
      const instruction =
        language && language !== 'unknown' && language.split(/[-_]/)[0] !== 'en'
          ? `Write the reply in the customer's own language (${language}), whatever language this thread appears in.`
          : ''

      const question = [`Subject: ${ticket.subject}`, ticket.description, conversation, instruction]
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
