import { describe, expect, it, vi } from 'vitest'
import { createHelpdesk } from '../src/helpdesk/index.js'
import { memoryStore } from '../src/store/memory.js'
import { resolveVariables } from '../src/procedures/index.js'
import {
  anyoneOnShift,
  availabilityAt,
  localTime,
  onTimeOff,
  shiftCovers,
  type Schedule,
} from '../src/helpdesk/schedule.js'

/** London, because it observes summer time and the tests need a DST boundary. */
const LONDON = 'Europe/London'

describe('reading the clock where the team is', () => {
  it('uses the schedule timezone rather than the server', () => {
    // 02:30 UTC in January is 02:30 in London and 21:30 the previous day in
    // New York, which is a different weekday as well as a different hour.
    const instant = new Date('2026-01-14T02:30:00Z')

    expect(localTime(instant, LONDON)).toEqual({ day: 3, minutes: 150 })
    expect(localTime(instant, 'America/New_York')).toEqual({ day: 2, minutes: 21 * 60 + 30 })
  })

  it('knows the clocks went forward', () => {
    // British Summer Time. The same instant is an hour later in London than in
    // UTC, and an offset written into the config could not know that.
    const summer = new Date('2026-07-14T09:00:00Z')
    const winter = new Date('2026-01-14T09:00:00Z')

    expect(localTime(summer, LONDON).minutes).toBe(10 * 60)
    expect(localTime(winter, LONDON).minutes).toBe(9 * 60)
  })

  it('renders midnight as zero rather than as twenty-four', () => {
    // Some environments format midnight as 24 with hour12 false, which would
    // put every overnight shift a whole day out.
    expect(localTime(new Date('2026-01-14T00:30:00Z'), LONDON).minutes).toBe(30)
  })
})

describe('a shift that ends the same day', () => {
  const nine_to_five = { memberId: 'sam', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }

  it('covers the middle of it', () => {
    expect(shiftCovers(nine_to_five, { day: 3, minutes: 13 * 60 })).toBe(true)
  })

  it('starts on the minute and ends on the minute', () => {
    expect(shiftCovers(nine_to_five, { day: 3, minutes: 9 * 60 })).toBe(true)
    expect(shiftCovers(nine_to_five, { day: 3, minutes: 17 * 60 })).toBe(false)
    expect(shiftCovers(nine_to_five, { day: 3, minutes: 17 * 60 - 1 })).toBe(true)
  })

  it('does not cover a day off', () => {
    expect(shiftCovers(nine_to_five, { day: 0, minutes: 13 * 60 })).toBe(false)
  })
})

describe('a shift that runs past midnight', () => {
  /** Monday to Friday nights. The classic bug lives here. */
  const nights = { memberId: 'kim', days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00' }

  it('covers the evening of a rostered day', () => {
    expect(shiftCovers(nights, { day: 1, minutes: 23 * 60 })).toBe(true)
  })

  it('covers the small hours of the morning after one', () => {
    // Tuesday at 02:00 belongs to Monday night's shift.
    expect(shiftCovers(nights, { day: 2, minutes: 2 * 60 })).toBe(true)
  })

  it('does not cover the middle of the day', () => {
    expect(shiftCovers(nights, { day: 2, minutes: 13 * 60 })).toBe(false)
  })

  it('does not cover Saturday morning, which follows an unrostered Friday night', () => {
    // Friday IS rostered, so Saturday at 02:00 is covered.
    expect(shiftCovers(nights, { day: 6, minutes: 2 * 60 })).toBe(true)
    // Sunday at 02:00 follows Saturday night, which is not rostered.
    expect(shiftCovers(nights, { day: 0, minutes: 2 * 60 })).toBe(false)
  })

  it('treats a shift with the same start and end as no shift', () => {
    expect(shiftCovers({ memberId: 'x', days: [1], start: '09:00', end: '09:00' }, { day: 1, minutes: 600 })).toBe(false)
  })
})

describe('time off', () => {
  const holiday = [{ memberId: 'sam', from: '2026-08-01T00:00:00Z', until: '2026-08-15T00:00:00Z' }]

  it('covers the days in between', () => {
    expect(onTimeOff('sam', new Date('2026-08-07T10:00:00Z'), holiday)).toBe(true)
  })

  it('starts inclusive and ends exclusive', () => {
    expect(onTimeOff('sam', new Date('2026-08-01T00:00:00Z'), holiday)).toBe(true)
    expect(onTimeOff('sam', new Date('2026-08-15T00:00:00Z'), holiday)).toBe(false)
  })

  it('belongs to one person', () => {
    expect(onTimeOff('kim', new Date('2026-08-07T10:00:00Z'), holiday)).toBe(false)
  })

  it('ignores an entry with unreadable dates rather than throwing', () => {
    expect(onTimeOff('sam', new Date(), [{ memberId: 'sam', from: 'soon', until: 'later' }])).toBe(false)
  })
})

describe('who to give a ticket to', () => {
  const schedule: Schedule = {
    timezone: LONDON,
    shifts: [
      { memberId: 'sam', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      { memberId: 'kim', days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00' },
    ],
    timeOff: [{ memberId: 'sam', from: '2026-08-01T00:00:00Z', until: '2026-08-15T00:00:00Z' }],
  }

  const team = [
    { id: 'sam', openTickets: 2 },
    { id: 'kim', openTickets: 5 },
  ]

  it('gives a three in the morning ticket to the night shift, not to somebody asleep', () => {
    // Wednesday 03:00 London.
    const at = availabilityAt(new Date('2026-01-14T03:00:00Z'), schedule, team)

    expect(at.find((member) => member.id === 'sam')?.available).toBe(false)
    expect(at.find((member) => member.id === 'kim')?.available).toBe(true)
  })

  it('gives a midday ticket to the day shift', () => {
    const at = availabilityAt(new Date('2026-01-14T12:00:00Z'), schedule, team)

    expect(at.find((member) => member.id === 'sam')?.available).toBe(true)
    expect(at.find((member) => member.id === 'kim')?.available).toBe(false)
  })

  it('leaves a Sunday afternoon ticket with nobody', () => {
    const at = availabilityAt(new Date('2026-01-18T14:00:00Z'), schedule, team)

    expect(at.every((member) => !member.available)).toBe(true)
    expect(anyoneOnShift(new Date('2026-01-18T14:00:00Z'), schedule, ['sam', 'kim'])).toBe(false)
  })

  it('lets time off override a shift', () => {
    // A Wednesday in August, in the middle of Sam's holiday, at noon.
    const at = availabilityAt(new Date('2026-08-05T11:00:00Z'), schedule, team)

    expect(at.find((member) => member.id === 'sam')?.available).toBe(false)
  })

  it('treats somebody with no shift at all as always available', () => {
    // Otherwise adding a rota for the night team silently takes the day team
    // off the board.
    const at = availabilityAt(new Date('2026-01-18T14:00:00Z'), schedule, [
      ...team,
      { id: 'unrostered', openTickets: 0 },
    ])

    expect(at.find((member) => member.id === 'unrostered')?.available).toBe(true)
  })

  it('carries the open ticket counts through untouched', () => {
    const at = availabilityAt(new Date('2026-01-14T12:00:00Z'), schedule, team)

    expect(at.find((member) => member.id === 'kim')?.openTickets).toBe(5)
  })

  it('is correct on both sides of the clocks going forward', () => {
    // 08:30 UTC is 08:30 in London in winter and 09:30 in summer, so the same
    // UTC time is outside Sam's shift in one and inside it in the other. A
    // schedule stored as an offset gets this wrong for half the year.
    const winter = availabilityAt(new Date('2026-01-14T08:30:00Z'), schedule, team)
    const summer = availabilityAt(new Date('2026-07-15T08:30:00Z'), schedule, team)

    expect(winter.find((member) => member.id === 'sam')?.available).toBe(false)
    expect(summer.find((member) => member.id === 'sam')?.available).toBe(true)
  })
})

describe('through the help desk', () => {
  const schedule: Schedule = {
    timezone: LONDON,
    shifts: [
      { memberId: 'sam@example.com', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      { memberId: 'kim@example.com', days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00' },
    ],
  }

  const teams = [
    {
      id: 'support',
      name: 'Support',
      isDefault: true,
      members: ['sam@example.com', 'kim@example.com'],
    },
  ]

  function open(at: string) {
    return createHelpdesk({
      store: memoryStore(),
      teams,
      schedule,
      assignment: 'round_robin',
    }).openTicket({
      subject: 'Late order',
      description: 'Where is it?',
      customer: { email: 'a@example.com' },
    })
  }

  it('gives a night ticket to the night shift', async () => {
    vi.setSystemTime(new Date('2026-01-14T03:00:00Z'))
    const ticket = await open('night')

    expect(ticket.assigneeId).toBe('kim@example.com')
    vi.useRealTimers()
  })

  it('gives a midday ticket to the day shift', async () => {
    vi.setSystemTime(new Date('2026-01-14T12:00:00Z'))
    const ticket = await open('day')

    expect(ticket.assigneeId).toBe('sam@example.com')
    vi.useRealTimers()
  })

  it('leaves a Sunday ticket unassigned rather than waking somebody', async () => {
    vi.setSystemTime(new Date('2026-01-18T14:00:00Z'))
    const ticket = await open('sunday')

    // Unassigned is visible in the queue. Assigned to somebody asleep is not.
    expect(ticket.assigneeId).toBeUndefined()
    vi.useRealTimers()
  })

  it('answers agentAvailable for a procedure to branch on', () => {
    const desk = createHelpdesk({ store: memoryStore(), teams, schedule })

    expect(desk.agentAvailable(new Date('2026-01-14T12:00:00Z'))).toBe(true)
    expect(desk.agentAvailable(new Date('2026-01-18T14:00:00Z'))).toBe(false)
  })

  it('says everybody is available when no schedule was configured', () => {
    // A deployment that has not described its hours has not said anybody is
    // away, and refusing live chat on that basis would be inventing a policy.
    const desk = createHelpdesk({ store: memoryStore(), teams })

    expect(desk.agentAvailable(new Date('2026-01-18T03:00:00Z'))).toBe(true)
    expect(desk.availability().every((member) => member.available)).toBe(true)
  })

  it('lists who is on shift', () => {
    const desk = createHelpdesk({ store: memoryStore(), teams, schedule })
    const on = desk.availability(new Date('2026-01-14T03:00:00Z'))

    expect(on.find((member) => member.id === 'kim@example.com')?.available).toBe(true)
    expect(on.find((member) => member.id === 'sam@example.com')?.available).toBe(false)
  })
})

describe('a procedure that knows whether anybody is there', () => {
  it('resolves agentAvailable from the help desk', () => {
    const desk = createHelpdesk({
      store: memoryStore(),
      teams: [{ id: 'support', name: 'Support', isDefault: true, members: ['sam@example.com'] }],
      schedule: {
        timezone: LONDON,
        shifts: [{ memberId: 'sam@example.com', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
      },
    })

    const variables = (at: Date) => ({ agentAvailable: desk.agentAvailable(at) })

    expect(
      resolveVariables('Live chat is {{agentAvailable}}.', {
        extra: variables(new Date('2026-01-14T12:00:00Z')),
      }),
    ).toBe('Live chat is true.')

    expect(
      resolveVariables('Live chat is {{agentAvailable}}.', {
        extra: variables(new Date('2026-01-18T03:00:00Z')),
      }),
    ).toBe('Live chat is false.')
  })
})
