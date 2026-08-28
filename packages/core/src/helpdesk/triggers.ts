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
  custom?: (ticket: Ticket) => boolean
}

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
): FiredTrigger[] {
  return triggers
    .filter((trigger) => trigger.on.includes(event) && matches(ticket, trigger.when))
    .map((trigger) => ({ name: trigger.name, action: trigger.then }))
}

function matches(ticket: Ticket, when: TriggerCondition): boolean {
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

  if (when.custom && !when.custom(ticket)) return false

  return true
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
