# @helpdeck/store-d1

The helpdeck `Store`, backed by Cloudflare D1.

```ts
import { d1Store } from '@helpdeck/store-d1'

export default {
  async fetch(request: Request, env: Env) {
    return createChatHandler({ index, store: d1Store({ db: env.DB }) })(request)
  },
}
```

```jsonc
// wrangler.jsonc
{ "d1_databases": [{ "binding": "DB", "database_name": "helpdeck", "database_id": "..." }] }
```

## Why this rather than Postgres

The deployment, not the database. A Worker reaches D1 through a binding: no
connection pool, no credential, nothing to exhaust. On a runtime where every
instance opening a pool is the failure mode, not having pools is the feature.

## What it costs

| | Free | Paid |
| --- | --- | --- |
| Database size | 500 MB | 10 GB |
| **Queries per Worker invocation** | **50** | 1,000 |
| Databases per account | 10 | 50,000 |
| Point-in-time restore | 7 days | 30 days |

The one that will catch you out is 50 queries per *invocation* on the free
tier, because it is per request rather than per day. `getConversation` is two;
a turn that also writes messages and lists tickets adds more. Count them if you
are near it.

Cloudflare's own guidance is many small databases rather than one large one,
which suits this product: one per business, and the size ceiling stops being a
ceiling.

## Differences from the Postgres store

Same interface, same behaviour suite, different SQL underneath.

- `INTEGER PRIMARY KEY AUTOINCREMENT` rather than a sequence. The ticket-number
  race is still fixed, SQLite assigns inside the insert rather than the
  application reading the highest and adding one.
- FTS5 for ticket search. Its query syntax treats punctuation as operators, so
  every word is quoted before searching; otherwise an apostrophe in a search
  box is a syntax error rather than a search.
- JSON in TEXT columns. SQLite has JSON functions but no JSON type, and
  everything here is read whole rather than queried into.
- No advisory lock around migration. A D1 database is a single Durable Object
  and runs one statement at a time, so the race the Postgres version guards
  against cannot happen.

## Running the tests

```sh
pnpm --filter @helpdeck/store-d1 test
```

No database and no dependency: the tests drive the store through a shim over
`node:sqlite`, which Node 22 ships built in. D1 *is* SQLite, so this exercises
the same SQL the Worker will run.

**What that leaves unproven**, honestly: the binding itself, the network, and
the per-invocation query limit. Those need `wrangler dev --local` with a real
D1 binding, and a deploy needs a Cloudflare account.
