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

---

[Back to the README](../README.md)
