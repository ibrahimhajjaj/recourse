import type { StatusCategory, Ticket } from './types.js'

/**
 * Rules that run when a ticket is created or changed.
 *
 * The point is to encode the small housekeeping a team otherwise does by hand
 * fifty times a day: flagging anything from a wholesale domain, parking
 * anything that mentions a delivery strike, closing duplicates.
 */
export interface Trigger {
  name: string
  on: Array<'created' | 'updated'>
  when: TriggerCondition
  then: TriggerAction
}

export interface TriggerCondition {
  /** Case-insensitive substring match on subject and description. */
  contains?: string[]
  statusCategory?: StatusCategory | StatusCategory[]
  channel?: Ticket['channel'] | Ticket['channel'][]
  teamId?: string
  /** True only when nobody has picked the ticket up. */
  unassigned?: boolean
  emailDomain?: string[]
  /**
   * Fires only when this update moved something, and optionally where to.
   *
   * The two rules every desk eventually wants cannot be written any other way,
   * because both are about a transition rather than a state. A ticket that is
   * closed looks identical whether it was closed a moment ago or last week,
   * and one that is unassigned looks identical whether somebody just dropped
   * it or nobody ever picked it up.
   *
   * ```ts
   * { changed: { statusCategory: { from: 'closed' } } }   // reopened
   * { changed: { assigneeId: { to: null } } }             // dropped back in the queue
   * { changed: { teamId: true } }                         // handed to another team
   * ```
   *
   * Never matches on creation, and never matches when the caller did not say
   * what the ticket looked like before: there is no transition to compare
   * against, and firing anyway would run reopen rules on every new ticket.
   */
  changed?: {
    statusCategory?: Change<StatusCategory>
    assigneeId?: Change<string | null>
    teamId?: Change<string | null>
  }
  custom?: (ticket: Ticket, previous?: Ticket) => boolean
}

/**
 * A field that moved.
 *
 * `true` for any move at all, or `from` and `to` for a particular one. Both
 * together mean both ends have to match, which is how you write "closed and
 * then reopened by the customer" rather than "reopened from anywhere".
 */
export type Change<T> = true | { from?: T | T[]; to?: T | T[] }

export interface TriggerAction {
  setStatusCategory?: StatusCategory
  setTeamId?: string
  setAssigneeId?: string | null
  /** Added to the thread so the team can see why the ticket moved. */
  addNote?: string
  /** Merged into the ticket's metadata, for tagging and later filtering. */
  setMetadata?: Record<string, unknown>
}

export interface FiredTrigger {
  name: string
  action: TriggerAction
}

/**
 * Every matching rule fires, in order, and later ones win on conflict.
 *
 * Unlike routing, which picks one destination, triggers are housekeeping and
 * more than one can sensibly apply: a ticket can be both tagged as wholesale
 * and put on hold.
 */
export function evaluateTriggers(
  ticket: Ticket,
  triggers: Trigger[],
  event: 'created' | 'updated',
  /** What it looked like before this update, for the `changed` conditions. */
  previous?: Ticket,
): FiredTrigger[] {
  return triggers
    .filter((trigger) => trigger.on.includes(event) && matches(ticket, trigger.when, previous))
    .map((trigger) => ({ name: trigger.name, action: trigger.then }))
}

function matches(ticket: Ticket, when: TriggerCondition, previous?: Ticket): boolean {
  if (when.contains?.length) {
    const haystack = `${ticket.subject}\n${ticket.description}`.toLowerCase()
    if (!when.contains.some((needle) => haystack.includes(needle.toLowerCase()))) return false
  }

  if (when.statusCategory) {
    const allowed = Array.isArray(when.statusCategory) ? when.statusCategory : [when.statusCategory]
    if (!allowed.includes(ticket.statusCategory)) return false
  }

  if (when.channel) {
    const allowed = Array.isArray(when.channel) ? when.channel : [when.channel]
    if (!allowed.includes(ticket.channel)) return false
  }

  if (when.teamId && ticket.teamId !== when.teamId) return false
  if (when.unassigned === true && ticket.assigneeId) return false
  if (when.unassigned === false && !ticket.assigneeId) return false

  if (when.emailDomain?.length) {
    const domain = ticket.customer.email?.split('@')[1]?.toLowerCase()
    if (!domain || !when.emailDomain.some((allowed) => domain === allowed.toLowerCase())) return false
  }

  if (when.changed) {
    // No before-picture, no transition. A create has none by definition, and a
    // caller that did not supply one is not entitled to a reopen rule firing
    // on every ticket it saves.
    if (!previous) return false

    const { statusCategory, assigneeId, teamId } = when.changed
    if (statusCategory && !moved(previous.statusCategory, ticket.statusCategory, statusCategory)) return false
    if (assigneeId && !moved(previous.assigneeId ?? null, ticket.assigneeId ?? null, assigneeId)) return false
    if (teamId && !moved(previous.teamId ?? null, ticket.teamId ?? null, teamId)) return false
  }

  if (when.custom && !when.custom(ticket, previous)) return false

  return true
}

/** Whether a field moved, and whether it moved the way the rule asked for. */
function moved<T>(before: T, after: T, wanted: Change<T>): boolean {
  if (before === after) return false
  if (wanted === true) return true

  if (wanted.from !== undefined && !oneOf(before, wanted.from)) return false
  if (wanted.to !== undefined && !oneOf(after, wanted.to)) return false

  return true
}

function oneOf<T>(value: T, allowed: T | T[]): boolean {
  return Array.isArray(allowed) ? allowed.includes(value) : value === allowed
}

export interface SavedView {
  id: string
  name: string
  /** The filter an agent sees when they open this view. */
  filter: {
    statusCategory?: StatusCategory | StatusCategory[]
    teamId?: string
    assigneeId?: string | null
    channel?: Ticket['channel']
    openOnly?: boolean
  }
}

/**
 * The three views every support team builds on its first day, so nobody has to
 * build them again.
 */
export function defaultViews(): SavedView[] {
  return [
    { id: 'unassigned', name: 'Unassigned', filter: { assigneeId: null, openOnly: true } },
    { id: 'on-us', name: 'Waiting on us', filter: { statusCategory: ['new', 'on_you'] } },
    { id: 'on-hold', name: 'On hold', filter: { statusCategory: 'on_hold' } },
  ]
}
