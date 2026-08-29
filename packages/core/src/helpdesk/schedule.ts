/**
 * Who is actually at work right now.
 *
 * `assignTicket` already takes availability per candidate; until now the host
 * had to work it out. So a ticket arriving at three in the morning was round
 * robined to whoever was next in the list, and sat unread on somebody asleep
 * while the queue said it had an owner. An unassigned ticket is visible; a
 * ticket assigned to a sleeping person is not.
 *
 * Every calculation here is done in the team's own timezone, passed in as an
 * IANA name and resolved through `Intl`. Never the server's local zone: a shop
 * in Manchester whose tickets are served from a machine in Virginia would have
 * its night shift start five hours early, and the bug would only show in the
 * hours nobody is looking.
 */

export interface Shift {
  /** Agent id or email, matching the team's member list. */
  memberId: string
  /** Days of the week the shift runs, 0 for Sunday through 6 for Saturday. */
  days: number[]
  /** Local start, `HH:MM` in the schedule's timezone. */
  start: string
  /** Local end. Earlier than `start` means it runs past midnight. */
  end: string
}

export interface TimeOff {
  memberId: string
  /** Inclusive, as an ISO timestamp. */
  from: string
  /** Exclusive. */
  until: string
}

export interface Schedule {
  /**
   * An IANA name such as `Europe/London`. Not an offset: an offset cannot know
   * about the clocks going forward, and a schedule written in offsets is wrong
   * twice a year for whoever is on the early shift.
   */
  timezone: string
  shifts: Shift[]
  timeOff?: TimeOff[]
}

/** Local wall-clock parts of an instant, in a named timezone. */
interface LocalTime {
  /** 0 for Sunday. */
  day: number
  /** Minutes since local midnight. */
  minutes: number
}

/**
 * What time it is where the team is.
 *
 * `Intl.DateTimeFormat` is the only thing in the platform that knows a given
 * instant was in British Summer Time, so the whole calculation goes through it
 * rather than through arithmetic on a UTC offset.
 */
export function localTime(instant: Date, timezone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

  // `hour12: false` still renders midnight as 24 in some environments, which
  // would put every overnight shift an entire day out.
  const hour = Number(read('hour')) % 24

  return {
    day: days[read('weekday')] ?? 0,
    minutes: hour * 60 + Number(read('minute')),
  }
}

/** `HH:MM` as minutes since midnight. Anything unparseable is midnight. */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return ((hours ?? 0) % 24) * 60 + ((minutes ?? 0) % 60)
}

/**
 * Whether one shift covers this moment.
 *
 * The overnight case is the one that is always wrong somewhere: a shift from
 * 22:00 to 06:00 is not a range, it is two. Someone working it at 02:00 on a
 * Tuesday started their Monday shift, so the day being checked is the day the
 * shift *began* rather than today.
 */
export function shiftCovers(shift: Shift, now: LocalTime): boolean {
  const start = toMinutes(shift.start)
  const end = toMinutes(shift.end)

  if (start === end) return false

  if (start < end) {
    return shift.days.includes(now.day) && now.minutes >= start && now.minutes < end
  }

  // Past midnight. Either it is still the evening of a rostered day, or it is
  // the small hours of the morning after one.
  const yesterday = (now.day + 6) % 7

  return (
    (shift.days.includes(now.day) && now.minutes >= start) ||
    (shift.days.includes(yesterday) && now.minutes < end)
  )
}

/** Whether somebody is on holiday at this instant. */
export function onTimeOff(memberId: string, instant: Date, timeOff: TimeOff[]): boolean {
  const at = instant.getTime()

  return timeOff.some((entry) => {
    if (entry.memberId !== memberId) return false
    const from = Date.parse(entry.from)
    const until = Date.parse(entry.until)
    if (!Number.isFinite(from) || !Number.isFinite(until)) return false
    return at >= from && at < until
  })
}

/**
 * Who is on shift, for the assignment algorithm.
 *
 * Members with no shift at all are treated as always available, so adding a
 * schedule for the night team does not silently take the day team off the
 * rota. Somebody rostered is available only inside their hours; somebody on
 * leave is never available, whatever the roster says.
 */
export function availabilityAt(
  instant: Date,
  schedule: Schedule,
  members: Array<{ id: string; openTickets: number }>,
): Array<{ id: string; available: boolean; openTickets: number }> {
  const now = localTime(instant, schedule.timezone)
  const timeOff = schedule.timeOff ?? []

  return members.map((member) => {
    const rostered = schedule.shifts.filter((shift) => shift.memberId === member.id)

    const available =
      !onTimeOff(member.id, instant, timeOff) &&
      (rostered.length === 0 || rostered.some((shift) => shiftCovers(shift, now)))

    return { id: member.id, available, openTickets: member.openTickets }
  })
}

/** Whether anybody at all is on shift, for `{{agentAvailable}}`. */
export function anyoneOnShift(instant: Date, schedule: Schedule, memberIds: string[]): boolean {
  return availabilityAt(
    instant,
    schedule,
    memberIds.map((id) => ({ id, openTickets: 0 })),
  ).some((member) => member.available)
}
