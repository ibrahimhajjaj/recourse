# Where the conversations go

`memoryStore` for development, `fileStore` for a single instance, and Postgres
for anything that scales out:

```ts
import { createChatHandler } from '@recourse-ai/core/server'
import { postgresStore } from '@recourse-ai/store-postgres'

createChatHandler({ index, store: postgresStore({ connectionString: process.env.DATABASE_URL }) })
```

This matters more than it looks. Every serverless deployment runs more than one
instance under load, and with a file store the transcripts, tickets and sources
scatter across instances that cannot see each other. Nothing errors; the data is
just quietly in the wrong place.

All four implementations (memory, file, Postgres and D1) pass the same
behaviour suite, so swapping one is a configuration change rather than a
rewrite.

## Writing your own

The suite the four run is published, so a fifth store proves it conforms rather
than hoping:

```ts
import { storeConformance } from '@recourse-ai/core/store/conformance'

storeConformance({ name: 'dynamodb', make: () => myStore() })
```

It brings no test runner with it. `describe` and `it` come from the global
scope, or you pass them in, and the assertions are its own, so vitest, jest,
node:test and bun:test all work. `make` must hand back a fresh, empty store on
every call.

A store that genuinely cannot do something declares it, rather than the suite
sinking to whatever the weakest implementation manages:

```ts
storeConformance({
  name: 'audit-log',
  make: () => appendOnlyStore(),
  supports: { deletes: false },
})
```

The declaration is itself a named test, so a green tick never hides how much of
the suite was skipped. What you can opt out of: `deletes`, `leads`, `stats`,
`pagination`, `filters`, `feedback`, `conversationMeta`, `tickets`. Everything
else is required, because everything else is something the agent calls without
asking.

Paging is the part that is harder than it looks, so the helper the built-in
stores use is public:

```ts
import { pageAfter, byNewest } from '@recourse-ai/core/store'

const matching = all.filter(mine)
return pageAfter(all, matching, options, (row) => row.id, byNewest((row) => row.updatedAt))
```

Two things it does that a `slice` does not, and the suite checks both. The
cursor is looked up among **every** row rather than only the matching ones,
because a listing is read while the thing it lists is being written to: a
source that finishes re-crawling, a ticket somebody closes, a conversation a
new message pushes past your `until`. Looked for among the matching rows it is
simply not there, and the walk ends with the rest undelivered. And the id
breaks a tie on the timestamp, or two rows written in the same millisecond can
come back either way round and paging hands one over twice and the other never.

In SQL both fall out of `(updated_at, id) < (SELECT updated_at, id FROM t WHERE
id = ?)` with a matching `ORDER BY`, which is why the two SQL stores here had
neither bug.

Both SQL stores here pass the whole suite against a real server, Postgres 16
and D1's SQLite. That matters more for the queue than for anything else,
because its cursor compares a row value against an expression rather than a
column, and an expression is exactly the sort of thing that typechecks and then
behaves differently in two dialects.

A ticket queue is the same shape with one extra rule: the caller chooses what
to sort by, and a cursor is only a position within one ordering. Four helpers
carry that so a store does not have to reinvent it:

```ts
import { orderingOf, sortedAt, sortColumn, ticketCursor, ticketCursorAt } from '@recourse-ai/core'

const ordering = orderingOf(filter)                 // the sortBy and order, defaults filled in
const at = ticketCursorAt(filter.cursor, ordering)  // throws if the cursor was issued for another
// ... then, per row: sortedAt(ticket, ordering.sortBy) in memory,
// or sortColumn(ordering.sortBy) as a SQL expression.
const next = ticketCursor(ordering, last.ticketNumber)
```

`ticketCursorAt` throwing is the point. A cursor used against a different
ordering points at a row that has moved, and the page that comes back is
quietly wrong rather than empty, which is the worse of the two.

Be careful with `deletes` and `conversationMeta` in particular. A store that
accepts `deleteConversation` and keeps the data has turned a legal obligation
into a lie, and one that drops `meta` has an agent talking over the person who
took the conversation over. The suite catches both.

`patchMeta` is the one method on `Store` you may leave out. It changes named
keys on `meta` and leaves the others alone, and a `null` value deletes a key.
Implement it if your store can merge JSON where the data lives, because that is
what stops a status webhook and a sweeper writing at the same moment from
losing each other's keys. Skip it if it cannot, and the caller reads, merges
and writes back instead.

## Reading a conversation without opening it

A stored conversation is only useful if you can skim it. Finding the one that
went badly last Tuesday otherwise means opening thirty.

```ts
import { markChanged, summariseStale } from '@recourse-ai/core'

// Free. One field on the conversation, called when a turn ends.
hooks.on('turn.end', ({ conversationId }) => void markChanged(store, conversationId!))

// Expensive, and on your schedule rather than the customer's.
await summariseStale({ store, model: fastModel, limit: 20 })
```

That split is the whole design. A version that summarises on every message
makes a busy shop pay for a model call per message all day; this marks the
conversation as changed for nothing and summarises ten messages once.

You get a title, a one-sentence summary, and how the customer seems: `angry`,
`unhappy`, `neutral`, `happy` or `delighted`. They live on the conversation's
own metadata, so no store needs a migration, and `insightOf(conversation)`
reads them back without asking the model anything.

The mood is carried forward rather than judged fresh. Given only the last two
messages a model flips it every turn; told what it decided last time, it changes
when something actually changed.

Two failure modes are handled the way you would want. A reply the parser cannot
read is discarded rather than half-applied, because a title with no summary
looks like a conversation nobody has looked at. And a conversation the model
keeps choking on has its mark cleared anyway, so it cannot hold up the sweep
behind it for ever.

---

[Back to the README](../README.md)
