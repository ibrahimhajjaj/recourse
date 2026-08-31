# Keeping the bill down

A support widget is a public endpoint that spends money on every request. The
rate limiter caps how often one caller may ask, which stops a script and does
not stop a bill: a thousand callers each politely under their own limit still
add up, and so does one loop in one conversation running all night.

Everything here is off by default and none of it needs another service.

## A ceiling on what you spend

```ts
import { createAgent, createBudget } from 'helpdeck'

const budget = createBudget({
  dailyTokens: 2_000_000,
  monthlyUsd: 50,
  onExceeded: 'pause',
})

const agent = createAgent({ index, budget })
```

The check runs **before** the model, which is the whole point: the turn that
crosses the line is precisely the one you did not want to pay for, and a check
that runs afterwards has already paid for it. A paused turn still records the
customer's question and tells them a person will pick it up, so nothing is lost
except the answer.

Caps come in two currencies and you can set both. Whichever is reached first
stops the turn.

| | Exact? | Needs prices? |
| --- | --- | --- |
| `dailyTokens`, `monthlyTokens` | Yes | No |
| `dailyUsd`, `monthlyUsd` | Only as far as the price table is current | Yes |

Tokens are what the provider actually reported, so a token cap is exact and
never goes stale. Dollars are what you budget in, and they need a price per
model, which a package can only ever hold a snapshot of. `PRICES_CHECKED` says
when the built-in table was last looked at. Pass your own for anything that
matters:

```ts
createBudget({ monthlyUsd: 50, prices: { 'my-provider/model': { input: 0.2, output: 0.8 } } })
```

A model with no price still counts towards token caps, and says so once in the
log rather than being quietly valued at zero.

Start with `onExceeded: 'warn'` for the first month. It logs and keeps
answering, which is how you find out what normal traffic costs before you pick a
number that turns your support channel off at four in the afternoon.

### More than one instance

Totals are held in memory by default. That is correct for one long-lived server
and wrong on serverless in two ways worth knowing: N instances give the
deployment N budgets, and a restart forgets the day. It still catches the
failure that matters most, a loop billing for hours, so it is the default.

When the cap is the point, share it:

```ts
import { createBudget, redisLedger } from 'helpdeck'

createBudget({ monthlyUsd: 50, ledger: redisLedger({ client: redis }) })
```

`Ledger` is two methods, `add` and `total`, so anything with an atomic
increment can be one.

## A cheaper model when the first will not answer

```ts
createAgent({ index, model: 'openai/gpt-4o', fallbackModel: 'openai/gpt-4o-mini' })
```

Tried only for failures another model could plausibly survive: a rate limit, an
exhausted quota, a provider outage, a context window that was too small. A
malformed request fails the same way twice and is not retried.

It is also only ever tried while the turn is still invisible. Once a sentence
has reached the customer or an action has run, a second attempt would either
repeat itself on screen or charge the same card twice, so a half-delivered
answer stays half delivered.

## Actions that return too much

Whatever an action returns is fed back into the conversation, and again on every
later step of the same turn. An order lookup handing back two hundred rows is
billed several times over, crowds out the passages that were the point, and puts
two hundred customers' addresses in a transcript to answer a question about one.

Results are cut down before the model sees them: long lists keep their first
rows and gain an honest count, long strings are cut, and anything still too
large is replaced by a description of itself. Credentials that rode along in a
result or an error are removed.

```ts
createAgent({ index, actionResults: { maxItems: 25, maxChars: 8000 } })
```

## Actions called in a loop

Small models loop. An action that returns "not found" gets called with the same
arguments until the step limit stops it, and every one of those is a real
request to somebody's API.

The same call with the same arguments runs twice and is then refused, with the
model told to use what it has or ask the customer something that would change
the answer. A single retry after a transient failure is still allowed, and
argument order does not count as a difference.

```ts
createAgent({ index, repeatLimit: 3 })  // or 0 to turn it off
```

The count is per turn, so a customer asking the same thing again later is
answered normally.

## What it costs to have all of this on

Nothing measurable. The budget check is one counter read, the repeat guard is a
map lookup, and cutting a result down is cheaper than sending it. The one
exception is `takeover`, which reads the conversation once per turn, and is off
until you ask for it.
