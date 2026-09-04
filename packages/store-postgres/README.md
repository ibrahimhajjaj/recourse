# @recourse-ai/store-postgres

The recourse `Store`, backed by Postgres.

```sh
npm install @recourse-ai/store-postgres pg
```

```ts
import { createChatHandler } from '@recourse-ai/core/server'
import { postgresStore } from '@recourse-ai/store-postgres'

const store = postgresStore({ connectionString: process.env.DATABASE_URL })

createChatHandler({ index, store })
```

That is the whole integration. Tables are created on first use.

## When the other stores stop being enough

`memoryStore` dies with the process. `fileStore` assumes one writer.

Every serverless deployment runs more than one instance under load, and with
either of those the transcripts, tickets and sources scatter across instances
that cannot see each other. Nothing errors; the data is just quietly in the
wrong place. That is the failure this package exists to remove.

It also fixes a race the file store cannot: ticket numbers come from a Postgres
sequence rather than read-the-highest-and-add-one, so twenty tickets opened in
the same moment get twenty different numbers.

## Options

```ts
postgresStore({
  // Prefer passing a pool you already own: one per process, not one per store.
  pool,
  // Or a connection string, and one is made for you.
  connectionString: process.env.DATABASE_URL,
  // Off if migrations are owned by something else, or the role cannot DDL.
  migrate: true,
})
```

`migrate(pool)` is exported if you would rather run it yourself at boot. It
takes an advisory lock, so several instances starting at once is fine.

## Where it departs from the other stores

- **Message order comes from a sequence, not the timestamp.** Two messages in
  one turn are written in the same millisecond, and ordering on the timestamp
  renders the answer above the question.
- **Pagination is keyset, not offset.** The cursor is still the last item's id,
  identical to the in-memory store, so a cursor keeps working if you swap
  implementations. Under it, `(updated_at, id)` means a row arriving mid-page
  cannot make you see the same conversation twice.
- **Ticket search is Postgres full-text**, over the subject, the description
  and every message body, through `plainto_tsquery` so an apostrophe in the
  search box is a search rather than a 500.
- **`stats()` is one round trip.** Those numbers are read together on every
  dashboard load, and five queries would be five times the latency.

## Vectors

The index file carries int8 vectors and scans them all, which is honest to
roughly twenty thousand chunks. Past that it is the file that hurts before the
scan does. `pgVectorStore` moves that half into Postgres:

```ts
import { pgVectorStore } from '@recourse-ai/store-postgres'

const vectors = pgVectorStore({ pool, dimensions: 768 })

createChatHandler({ index, embedder, vectorStore: vectors })
```

Needs `CREATE EXTENSION vector`. Neon, Supabase and RDS all ship pgvector; a
plain Postgres needs it installed.

Chunk text stays in the index file. Only the vectors move, so there is exactly
one place the text lives and no rule about which copy wins.

- An HNSW index with `vector_cosine_ops`, built on the empty table, so ingest
  can fill it afterwards. IVFFlat would need a training pass over data that is
  not there yet.
- `<=>` returns cosine *distance*, so the store returns `1 - distance`. Getting
  that backwards ranks everything upside down and still looks plausible.
- The relevance floor is applied in SQL, not after, so a million-row table does
  not ship rows back to be discarded.
- A dimension mismatch throws rather than returning meaningless distances.

## Serverless, where this actually goes wrong

The connection limit, not the query load, is what breaks a database behind
serverless functions. Total connections is instances times pool size, and you
do not control the first number.

**Create the store once, at module scope.** The mistake that exhausts a
database is building one per request: every call opens another pool, none are
closed, and the count climbs until Postgres refuses. The store warns once if it
sees a second pool for the same database in one process.

```ts
// lib/store.ts, imported by every route, constructed once.
export const store = postgresStore({ connectionString: process.env.DATABASE_URL })
```

**Do not set `max: 1`.** It is common advice and it is wrong: it does not
reduce the total, because the total is instances times pool size, and it
removes all concurrency inside each instance. Put a pooler in front instead.

**Use your provider's pooled endpoint**, not the direct one. Neon and Supabase
both run PgBouncer in transaction mode and give you a separate host or port for
it; a direct connection string is for migrations and psql, not for an
application that scales out.

**Suspension leaks connections.** An idle serverless instance is suspended in
memory, and a suspended instance does not run its idle timers, so connections
opened before it went to sleep stay open until the instance dies or the
database gives up on them. The defaults here use a five second idle timeout to
shrink that window. On Vercel, close it properly:

```ts
import { attachDatabasePool } from '@vercel/functions'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
attachDatabasePool(pool)

export const store = postgresStore({ pool })
```

Defaults when this package builds the pool: `max: 10`,
`idleTimeoutMillis: 5000`, `connectionTimeoutMillis: 10000`, and
`allowExitOnIdle` so a script can exit rather than being held open by an idle
connection. Override `max` and `idleTimeoutMillis` if you have measured
something better.

## Running the tests

```sh
docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=recourse -e POSTGRES_DB=recourse postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:recourse@localhost:55432/recourse pnpm test
```

An installed Postgres works too, with no daemon and nothing left behind. The
recipe is in the header of `test/postgres.test.ts`, including the one thing
that catches people out: a unix socket path has about a hundred bytes to play
with, so the socket directory has to sit somewhere short rather than beside a
temporary data directory under a long project path.

Use `pnpm test postgres` for that route. The vector suite next door needs the
pgvector extension, which a plain server does not have, and its failures say
`extension "vector" is not available` rather than anything about your changes.

Without `TEST_DATABASE_URL` the suite skips rather than fails, so a contributor
changing the widget is not blocked by a database they never touched. CI runs it
against a service container on every push.

The suite is mostly not written here: it imports the same behaviour assertions
the memory and file stores pass. A store that only passes tests written for it
is not interchangeable with anything.

MIT
