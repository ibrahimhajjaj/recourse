import { createHelpdesk, memoryStore } from 'recourse'

/**
 * One store and one help desk, shared by the chat endpoint and the management
 * API. In a real shop this would be Postgres; in memory is enough to show the
 * transcript, the answer gaps, the leads and the ticket queue working together.
 */
export const store = memoryStore()

export const helpdesk = createHelpdesk({
  store,
  teams: [
    { id: 'support', name: 'Support', isDefault: true, members: ['ana@lumen.example', 'ben@lumen.example'] },
    { id: 'billing', name: 'Billing', isDefault: false, members: ['cat@lumen.example'] },
  ],
  routing: [
    { name: 'Billing disputes', teamId: 'billing', when: { contains: ['refund', 'charged', 'invoice', 'payment'] } },
  ],
  onTicketOpened(ticket) {
    console.log(`[recourse] ticket #${ticket.ticketNumber} -> ${ticket.teamId}/${ticket.assigneeId ?? 'unassigned'}`)
  },
})
