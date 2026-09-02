/**
 * Whether it actually helped, rather than whether it replied.
 *
 * Deflection is the number every one of these tools reports and it counts the
 * wrong thing: a customer who gave up and went away is deflected. So is one who
 * was told something confidently wrong, followed it, and came back on Thursday.
 * A dashboard built on it improves while trust falls.
 *
 * What follows is deliberately harsher. A turn counts as having worked only if
 * nobody had to come back about it, which is the same standard a support lead
 * applies by instinct and almost no tool reports.
 */

import type { Conversation, Store } from './store/types.js'

export interface Outcomes {
  /** Conversations examined. */
  conversations: number
  /** Ended without a handover and without the agent saying it could not help. */
  looksAnswered: number
  /** Handed to a person. */
  escalated: number
  /** The agent said it could not answer at least once. */
  unanswered: number
  /**
   * Looked answered, and then the same person came back inside the window.
   *
   * The interesting number, and the one nothing else reports. These are the
   * conversations a deflection rate counts as wins.
   */
  cameBack: number
  /**
   * Looked answered and nobody came back. The honest success count.
   */
  durable: number
  /**
   * Conversations with no contact on them, which cannot be followed.
   *
   * Reported rather than quietly dropped, because it is the error bar on
   * everything above: an anonymous widget conversation cannot be linked to the
   * next one, so `cameBack` is a floor and never a total.
   */
  anonymous: number
}

export interface OutcomeOptions {
  store: Store
  /**
   * How long after a conversation a return still counts as the same problem.
   *
   * Seven days. Long enough to catch somebody who tried the answer, found it
   * did not work and came back after the weekend; short enough that an
   * unrelated question next month is not counted as a failure.
   */
  withinDays?: number
  /** How many conversations to read. */
  limit?: number
}

/**
 * Reads recent conversations and says how many actually ended.
 *
 * Approximate and says so. Two conversations from one person inside a week are
 * treated as the same person coming back, which is right far more often than it
 * is wrong but is not the same as knowing they came back about the same thing.
 * Reading it as a direction rather than a fact is the correct use.
 */
export async function outcomes(options: OutcomeOptions): Promise<Outcomes> {
  const withinMs = (options.withinDays ?? 7) * 24 * 60 * 60 * 1000
  const page = await options.store.listConversations({ limit: options.limit ?? 500 })

  const tally: Outcomes = {
    conversations: page.items.length,
    looksAnswered: 0,
    escalated: 0,
    unanswered: 0,
    cameBack: 0,
    durable: 0,
    anonymous: 0,
  }

  // Oldest first, so "did anybody come back" is a question about what follows.
  const ordered = [...page.items].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  )

  const byPerson = new Map<string, Conversation[]>()
  for (const conversation of ordered) {
    const who = personOf(conversation)
    if (!who) continue

    const theirs = byPerson.get(who)
    if (theirs) theirs.push(conversation)
    else byPerson.set(who, [conversation])
  }

  for (const conversation of ordered) {
    if (conversation.ticketId) {
      tally.escalated++
      continue
    }

    const thread = await options.store.getConversation(conversation.id)
    const gaveUp = (thread?.messages ?? []).some((message) => message.unanswered === true)

    if (gaveUp) {
      tally.unanswered++
      continue
    }

    // Nothing said it failed, so by any ordinary reckoning this one worked.
    tally.looksAnswered++

    const who = personOf(conversation)
    if (!who) {
      tally.anonymous++
      // Counted as durable rather than left out, so the two halves still add up.
      // It is the generous reading, which is why `anonymous` is reported beside
      // it: a large number there means this is measuring less than it looks.
      tally.durable++
      continue
    }

    if (returnedAfter(conversation, byPerson.get(who) ?? [], withinMs)) tally.cameBack++
    else tally.durable++
  }

  return tally
}

/**
 * Who a conversation belongs to, when that is knowable.
 *
 * An email, because it is the one identifier that survives a customer moving
 * from the widget to WhatsApp. A conversation without one is not counted
 * against anybody.
 */
function personOf(conversation: Conversation): string | undefined {
  const email = conversation.contact?.email
  return typeof email === 'string' && email ? email.toLowerCase() : undefined
}

/** Whether the same person opened another conversation inside the window. */
function returnedAfter(conversation: Conversation, theirs: Conversation[], withinMs: number): boolean {
  const ended = Date.parse(conversation.updatedAt || conversation.createdAt)
  if (Number.isNaN(ended)) return false

  return theirs.some((other) => {
    if (other.id === conversation.id) return false

    const started = Date.parse(other.createdAt)

    return !Number.isNaN(started) && started > ended && started - ended <= withinMs
  })
}
