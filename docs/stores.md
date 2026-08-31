# Where the conversations go

`memoryStore` for development, `fileStore` for a single instance, and Postgres
for anything that scales out:

```ts
import { createChatHandler } from 'helpdeck/server'
import { postgresStore } from '@helpdeck/store-postgres'

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
import { storeConformance } from 'helpdeck/store/conformance'

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
`pagination`, `filters`, `feedback`, `conversationMeta`. Everything else is
required, because everything else is something the agent calls without asking.

Be careful with `deletes` and `conversationMeta` in particular. A store that
accepts `deleteConversation` and keeps the data has turned a legal obligation
into a lie, and one that drops `meta` has an agent talking over the person who
took the conversation over. The suite catches both.

---

[Back to the README](../README.md)
