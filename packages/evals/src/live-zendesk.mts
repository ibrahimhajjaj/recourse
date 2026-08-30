/**
 * The live half of the help desk verification.
 *
 * Nine connectors ship and all nine are tested against each vendor's
 * documented request and error shapes, which is a weaker claim than it looks:
 * a field renamed since the docs were written passes every one of those tests
 * and fails the first real ticket. This opens a real one.
 *
 *   ZENDESK_SUBDOMAIN=acme ZENDESK_ACCESS_TOKEN=... npx tsx src/live-zendesk.mts
 *
 * The token is an OAuth access token. Zendesk is retiring API tokens: the
 * existing ones stop working on 30 April 2027 and an account created after
 * that was announced has no button to make one, so the API tokens page offers
 * nothing but the notice. An OAuth client is made under Admin Center, Apps and
 * integrations, OAuth clients.
 *
 * Nothing here deletes the ticket it makes. A support queue with one test
 * ticket in it is a smaller problem than a script that can delete tickets, and
 * closing it is one click.
 */

import { escalate } from 'helpdeck/actions'
import { zendesk } from 'helpdeck/helpdesk'

const env = process.env
const need = (name: string): string => {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function main(): Promise<void> {
  const subdomain = need('ZENDESK_SUBDOMAIN')
  const accessToken = need('ZENDESK_ACCESS_TOKEN')

  const createTicket = zendesk({ subdomain, accessToken })
  const marker = `helpdeck live check ${new Date().toISOString()}`

  // Through the action rather than the connector alone, because the action is
  // what a deployment actually calls and it does its own field handling on the
  // way past.
  const action = escalate({ createTicket })

  const result = (await action.execute?.(
    {
      subject: marker,
      body: 'Opened by the helpdeck live verification. Safe to close.',
      priority: 'low',
      email: 'sam@example.com',
      name: 'Sam Fletcher',
    },
    { emit: () => {} },
  )) as { ticketId?: string } | undefined

  if (!result?.ticketId) throw new Error('the desk accepted the call but returned no ticket id')
  console.log(`  ok    a ticket was opened  #${result.ticketId}`)

  // Read back rather than trusted. A 201 with an id proves the request was
  // shaped right; only fetching it proves the fields arrived where they were
  // meant to go.
  const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${result.ticketId}.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`could not read the ticket back: ${response.status}`)

  const { ticket } = (await response.json()) as { ticket: Record<string, any> }
  const checks: Array<[string, boolean, string]> = [
    ['the subject survived', ticket.subject === marker, String(ticket.subject)],
    ['the priority survived', ticket.priority === 'low', String(ticket.priority)],
    ['the description carries the body', String(ticket.description).includes('Safe to close'), ''],
    ['it is open', ticket.status === 'new' || ticket.status === 'open', String(ticket.status)],
  ]

  for (const [what, passed, saw] of checks) {
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${what}${passed || !saw ? '' : `  saw ${saw}`}`)
  }

  if (checks.some(([, passed]) => !passed)) process.exitCode = 1
  console.log(`\n  https://${subdomain}.zendesk.com/agent/tickets/${result.ticketId}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
