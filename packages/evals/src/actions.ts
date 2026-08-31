/**
 * Stand-in actions for the cases that assert on what the agent *did*.
 *
 * A support agent that answers well but never looks up an order is only half
 * working, and no amount of string matching on the reply catches that. These
 * return fixed data so a case can assert on the answer too, and they record
 * every call so `mustCallAction` has something to check.
 */

import { defineAction } from '@recourse-ai/core'
import type { Action } from '@recourse-ai/core'

export interface ActionLog {
  actions: Action[]
  /** Names of the actions that ran, in order. */
  called: string[]
}

/** Fixed orders, so a case can assert on the numbers that come back. */
const ORDERS: Record<string, { status: string; total: string; placed: string; items: string }> = {
  'LC-88231': { status: 'delivered', total: '42.00 GBP', placed: '14 August', items: '1kg Ethiopia Guji' },
  'LC-90114': { status: 'in transit', total: '18.50 GBP', placed: '26 August', items: '250g House blend' },
}

/**
 * A fresh set per run, because the log is per-agent state. Sharing one across
 * cases would let an earlier case's call satisfy a later case's assertion.
 */
export function testActions(): ActionLog {
  const called: string[] = []

  const lookupOrder = defineAction({
    name: 'lookup_order',
    whenToUse:
      'The customer asks about a specific order and has given an order number. Never guess a number they have not given you.',
    collect: [{ name: 'orderNumber', type: 'string' as const, description: 'The order number, such as LC-88231', required: true }],
    async execute({ orderNumber }) {
      called.push('lookup_order')
      const order = ORDERS[String(orderNumber).trim().toUpperCase()]
      return order ?? { error: 'no order with that number' }
    },
  })

  const createTicket = defineAction({
    name: 'create_ticket',
    whenToUse:
      'The customer needs a person: a complaint, something the help pages cannot answer, or they ask for a human.',
    collect: [
      { name: 'summary', type: 'string' as const, description: 'One line on what they need', required: true },
      { name: 'email', type: 'string' as const, description: 'Their email address, if they gave one' },
    ],
    async execute({ summary }) {
      called.push('create_ticket')
      return { ticketNumber: 'T-1001', summary }
    },
  })

  return { actions: [lookupOrder, createTicket], called }
}
