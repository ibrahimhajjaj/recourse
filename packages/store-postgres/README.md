# @helpdeck/store-postgres

The helpdeck `Store`, backed by Postgres.

```sh
npm install @helpdeck/store-postgres pg
```

```ts
import { postgresStore } from '@helpdeck/store-postgres'

const store = postgresStore({ connectionString: process.env.DATABASE_URL })

createChatHandler({ index, store })
```

That is the whole integration. Tables are created on first use.

## Why you need it

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

## What it does differently

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

## Running the tests

```sh
docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=helpdeck -e POSTGRES_DB=helpdeck postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:helpdeck@localhost:55432/helpdeck pnpm test
```

Without `TEST_DATABASE_URL` the suite skips rather than fails, so a contributor
changing the widget is not blocked by a database they never touched. CI runs it
against a service container on every push.

The suite is mostly not written here: it imports the same behaviour assertions
the memory and file stores pass. A store that only passes tests written for it
is not interchangeable with anything.

MIT
