import { describe, expect, it } from 'vitest'
import { createHelpdesk } from '../src/helpdesk/service.js'
import { memoryStore } from '../src/store/memory.js'

const desk = () => createHelpdesk({ store: memoryStore() })

const opened = async (service: ReturnType<typeof createHelpdesk>) =>
  service.openTicket({
    subject: 'Refund not received',
    description: 'They want their money back.',
    customer: { email: 'sam@shop.example' },
  })

describe('a ticket that was closed and came back', () => {
  it('counts nothing while it is only being worked on', async () => {
    const service = desk()
    const { ticketNumber } = await opened(service)

    await service.update(ticketNumber, { statusCategory: 'on_customer' })
    const worked = await service.update(ticketNumber, { statusCategory: 'on_you' })

    expect(worked?.reopened).toBeUndefined()
  })

  it('counts one when it goes from closed back to open', async () => {
    const service = desk()
    const { ticketNumber } = await opened(service)

    await service.update(ticketNumber, { statusCategory: 'closed' })
    const back = await service.update(ticketNumber, { statusCategory: 'on_you' })

    // The number a closure count cannot show: one ticket closed once is work
    // finished, and the same one closed three times is the same wrong answer
    // three times.
    expect(back?.reopened).toBe(1)
  })

  it('keeps counting when it happens again', async () => {
    const service = desk()
    const { ticketNumber } = await opened(service)

    for (let round = 0; round < 3; round++) {
      await service.update(ticketNumber, { statusCategory: 'closed' })
      await service.update(ticketNumber, { statusCategory: 'on_you' })
    }

    expect((await service.getTicket(ticketNumber))?.reopened).toBe(3)
  })

  it('does not count closing it twice in a row', async () => {
    const service = desk()
    const { ticketNumber } = await opened(service)

    await service.update(ticketNumber, { statusCategory: 'closed' })
    const again = await service.update(ticketNumber, { statusCategory: 'cancelled' })

    // Both are resolved categories, so nothing came back.
    expect(again?.reopened).toBeUndefined()
  })
})
