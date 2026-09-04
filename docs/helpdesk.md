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
it did is answerable later.

## Rules that run themselves

`routing` picks one destination when a ticket arrives. `triggers` are the
housekeeping either side of that: every matching rule fires, in the order you
wrote them, and a later one wins where two touch the same field.

```ts
createHelpdesk({
  store,
  triggers: [
    {
      name: 'Back in the queue when reopened',
      on: ['updated'],
      when: { changed: { statusCategory: { from: 'closed' } } },
      then: { setAssigneeId: null, addNote: 'Reopened, so back in the queue.' },
    },
  ],
})
```

`when` matches on what a ticket **is**: `contains` over the subject and
description, `statusCategory`, `channel`, `teamId`, `unassigned`, `email`,
`emailDomain`, and `custom` for anything else.

`email` is the whole address rather than the domain, which is how you name a
handful of accounts: the reseller whose tickets go straight to the person who
knows them, without also catching everybody else at that company. Routing rules
take the same two fields.

`changed` matches on what an update **moved**, which is a different question and
the one most real rules ask. A closed ticket looks identical whether it was
closed a moment ago or last week, and an unassigned one looks identical whether
somebody just dropped it or nobody ever picked it up:

```ts
{ changed: { statusCategory: { from: 'closed' } } }   // reopened
{ changed: { assigneeId: { to: null } } }             // dropped back in the queue
{ changed: { teamId: true } }                         // handed to another team
```

`true` is any move at all; `from` and `to` together mean both ends have to
match. A rule with a `changed` condition never fires on creation, since there is
no transition to compare against.

`then` takes `setStatusCategory`, `setTeamId`, `setAssigneeId` (`null` to
unassign), `addNote` for something only the team sees, and `setMetadata` for
tagging. What a rule does reaches the store directly, so one firing cannot set
off another round. `helpdesk.draftReply(n)` writes a reply from the same
documentation the widget uses and never sends it, because the value is a person
reading it first.

## Who gets the next one

`assignment` takes `least_busy` (the default), `round_robin` or `manual`.

Two ties matter more than they look. On equal load the ticket goes to whoever
has waited longest since their last one, not to whoever sorts first
alphabetically: that is invisible on any one assignment and unmistakable over a
month, where `ana@` takes every tie and `zoe@` takes none. Somebody who has
never been assigned anything counts as having waited longest, so a new
teammate starts at the front rather than at the back forever.

Both are also settable per team, and the team's own value wins. Teams are
different sizes doing different work: two people on billing pick their own
tickets and know each other's cases, ten on general support want them spread
evenly and would rather not think about it, and one setting across the desk
makes one of those wrong.

```ts
teams: [
  { id: 'support', name: 'Support', isDefault: true, members: [...] },
  { id: 'billing', name: 'Billing', isDefault: false, members: [...], assignment: 'manual' },
]
```

`maxOpenPerAgent` stops an agent being handed more once they hold that many
open. It matters most under `round_robin`, which rotates without looking at
load at all: an agent sitting on forty open tickets keeps being handed the next
one, and the queue is fair in a way that helps nobody. A ticket nobody is
eligible for stays unassigned, which is what the unassigned queue is for. Only
auto-assignment respects it; a manager assigning by hand is making a decision
and is entitled to.

## What the queue looks like

`helpdesk.stats(filter?)` answers the questions a support lead asks on the
thirtieth day, over whatever slice the filter names:

```ts
const { created, solved, unsolved, medianFirstReplyMs, medianTimeToCloseMs } = await helpdesk.stats({
  since: '2026-01-01T00:00:00.000Z',
})
```

`unsolved` is the backlog, which is the one worth watching over time: created
and solved both going up tells you nothing on its own.

The response times are medians, not averages. One ticket that sat over a bank
holiday weekend moves a mean enough to hide a week of good work, and the
question is "what does a customer normally wait", which a median answers and a
mean does not. A duration is absent rather than zero when nothing qualified,
because zero is a real answer meaning somebody replied instantly.

Only a reply from a person counts as an answer. A note is written between
colleagues and a status change is the software talking to itself, and counting
either would say the customer was answered when nobody has spoken to them. A
customer writing again restarts their clock, since what is being measured is
how long they wait after speaking rather than how long since the ticket opened.

Time to close reads the status events on the thread rather than `updatedAt`: a
ticket closed in an hour and edited a week later took an hour. A ticket that
came back counts to the last close.

It reads every thread in the slice, so it is a dashboard call rather than
something to run per turn. `ticketStats(tickets, threads)` is the same
arithmetic as a pure function, for a caller that already has both.

Over HTTP it is `GET /helpdesk/stats`, taking the same `?statusCategory=`,
`?teamId=`, `?channel=`, `?since=` and `?until=` as the ticket list. From a
coding agent it is the `get_queue_stats` tool.

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
