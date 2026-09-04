# Tickets, teams and hours

A help desk built in, for when there is no other one to hand off to. Tickets are
numbered, routed to a team by rule, and assigned to whoever is both least busy
and actually working.

```ts
import { createHelpdesk } from '@recourse-ai/core/helpdesk'

const helpdesk = createHelpdesk({
  store,
  agent,
  teams: [
    { id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.com'] },
    { id: 'billing', name: 'Billing', isDefault: false, members: ['cat@shop.com'] },
  ],
  routing: [
    { name: 'Billing disputes', teamId: 'billing', when: { contains: ['refund', 'charged'] } },
  ],
})
```

Every decision is recorded as an event on the thread, so why a ticket went where
it did is answerable later. `helpdesk.draftReply(n)` writes a reply from the same
documentation the widget uses and never sends it, because the value is a person
reading it first.

## Nobody is awake at three in the morning

`assignTicket` always took availability per candidate; until now the host had
to work it out, so a ticket arriving at 03:00 was round robined to whoever was
next and sat unread on somebody asleep.

```ts
createHelpdesk({
  store,
  teams,
  schedule: {
    timezone: 'Europe/London',
    shifts: [
      { memberId: 'sam@example.com', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      { memberId: 'kim@example.com', days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00' },
    ],
    timeOff: [{ memberId: 'sam@example.com', from: '2026-08-01', until: '2026-08-15' }],
  },
})
```

An unassigned ticket is visible in the queue. A ticket assigned to a sleeping
person is not, which is why a Sunday ticket is left with nobody rather than
given to the next name on the list.

Three details that are the whole difficulty:

**A shift past midnight is two ranges, not one.** 22:00 to 06:00 means someone
working at 02:00 on Tuesday started their Monday shift, so the day checked is
the day the shift *began*.

**The timezone is an IANA name, never an offset.** An offset cannot know the
clocks went forward, so a schedule written in offsets is wrong for half the
year. 08:30 UTC is outside a 09:00 shift in January and inside it in July, and
there is a test on each side of that boundary.

**Somebody with no shift at all is always available**, so adding a rota for the
night team does not silently take the day team off the board.

A procedure can branch on it:

```ts
import { createChatHandler } from '@recourse-ai/core/server'

createChatHandler({
  index,
  procedures,
  procedureVariables: () => ({ agentAvailable: helpdesk.agentAvailable() }),
})
```

Read fresh every turn, because a value read once at startup would have a
procedure offering live chat all night.

## Reading the queue

`listTickets` filters on status, status category, assignee (`null` for
unclaimed), team, channel and a date range, and pages with a cursor.

It comes back most recently touched first, which is what an inbox wants and the
wrong thing for anything walking every ticket. `sortBy` takes `created`,
`updated` or `lastMessage`, and `order` takes `asc` or `desc`:

```ts
// The order a queue is actually worked in.
await helpdesk.listTickets({ openOnly: true, sortBy: 'created', order: 'asc' })
```

`created` is the only one of the three that cannot move. Sorting by a mutable
field means a page window is not a snapshot: a ticket somebody replies to while
you are paging jumps to the front, and the one behind it is never handed to you.
So an export sorts by `created`, or by `updated` ascending while remembering the
last timestamp it saw.

A cursor carries the ordering it was issued for, and using it against a
different one is refused rather than silently returning a wrong page. Start the
walk again instead of mixing the two.

`includeTotal: true` puts the number of matching tickets on the page. It costs a
second query, so a queue screen showing twenty does not pay for it and a
dashboard saying "342 open" does.

Over HTTP the same thing is `?sortBy=`, `?order=` and `?includeTotal=true` on
`GET /helpdesk/tickets`.

Escalating into a desk you already run is its own page:
[docs/escalation.md](escalation.md). Handling a customer who does not write
English is [docs/languages.md](languages.md).

---

[Back to the README](../README.md)
