import type { Team, Ticket } from './types.js'

/**
 * Which team a new ticket belongs to.
 *
 * Rules are ordered and first-match, not scored. A support lead needs to be
 * able to read the list top to bottom and say exactly where a ticket will land;
 * anything cleverer is impossible to debug at 9am on a Monday.
 */
export interface RoutingRule {
  /** Shown in the audit trail so it is obvious which rule fired. */
  name: string
  teamId: string
  /** All conditions must hold for the rule to match. */
  when: RoutingCondition
}

export interface RoutingCondition {
  channel?: Ticket['channel'] | Ticket['channel'][]
  /** Case-insensitive substring match against subject and description. */
  contains?: string[]
  /** Matched against the customer's email domain, without the @. */
  emailDomain?: string[]
  /** Escape hatch for anything the fields above cannot express. */
  custom?: (ticket: Ticket) => boolean
}

export interface RoutingResult {
  teamId?: string
  /** The rule that decided, or undefined when the default team took it. */
  rule?: string
}

export function routeTicket(
  ticket: Ticket,
  rules: RoutingRule[],
  teams: Team[],
): RoutingResult {
  for (const rule of rules) {
    if (matches(ticket, rule.when)) return { teamId: rule.teamId, rule: rule.name }
  }

  const fallback = teams.find((team) => team.isDefault) ?? teams[0]
  return { teamId: fallback?.id }
}

function matches(ticket: Ticket, when: RoutingCondition): boolean {
  if (when.channel) {
    const allowed = Array.isArray(when.channel) ? when.channel : [when.channel]
    if (!allowed.includes(ticket.channel)) return false
  }

  if (when.contains?.length) {
    const haystack = `${ticket.subject}\n${ticket.description}`.toLowerCase()
    if (!when.contains.some((needle) => haystack.includes(needle.toLowerCase()))) return false
  }

  if (when.emailDomain?.length) {
    const domain = ticket.customer.email?.split('@')[1]?.toLowerCase()
    if (!domain || !when.emailDomain.some((allowed) => domain === allowed.toLowerCase())) return false
  }

  if (when.custom && !when.custom(ticket)) return false

  return true
}
