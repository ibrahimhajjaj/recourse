# Keeping the bill down

A support widget is a public endpoint that spends money on every request. The
rate limiter caps how often one caller may ask, which stops a script and does
not stop a bill: a thousand callers each politely under their own limit still
add up, and so does one loop in one conversation running all night.

Everything here is off by default and none of it needs another service.

## A ceiling on what you spend

```ts
import { createAgent, createBudget } from '@recourse-ai/core'

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
log rather than being quietly valued at zero. That distinction matters more
than it looks: an unpriced model treated as free reports confident zero spend
and silently blinds every dollar cap that keys off it. Declare a genuinely free
model rather than leaving it unknown:

```ts
createBudget({ monthlyUsd: 50, prices: { 'ollama/*': { input: 0, output: 0 } } })
```

A trailing `*` prices a whole family, because somebody self-hosting has a
handful of models and swaps them, and naming each one is a list that is wrong
the first time they pull a new tag. Longest prefix wins, so a specific entry
still beats the family it sits in, and `'*'` alone is a last resort rather than
something that shadows every real price.

`spent()` reports the volume that went unpriced next to the money:

```ts
const { month } = await budget.spent()
// { tokens: 8_400_000, usd: 12.40, unpricedTokens: 4_200_000 }
```

That third number says how much to trust the second. Half the volume priced as
unknown means the dollar figure describes half the traffic, and a cap keyed off
it is looser than it looks. The built-in table also says when it was last
checked, and a dollar cap built on one older than six months says so once at
startup, because a table that has drifted low does not fail loudly: the cap
simply stops being reachable, which looks exactly like traffic staying under
budget.

Model ids arrive as `provider/model` either way. A gateway id already is one; a
self-hosted model reports a bare `qwen3:4b`, so the provider is put back on the
front, which is the only thing that tells a local model apart from a hosted one.

Providers return the pinned snapshot they served rather than the alias you
asked for, so `gpt-4o` comes back as `gpt-4o-2024-11-20`. A dated suffix falls
back to the undated id, which means a new snapshot prices correctly on the day
it ships instead of quietly costing nothing.

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
import { createBudget, redisLedger } from '@recourse-ai/core'

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

## Not embedding the same page twice

Re-crawling a site pays to embed every chunk again, including the three hundred
and ninety-nine pages that did not change. Pass the index you are replacing:

```ts
import { ingest } from '@recourse-ai/core'

const index = await ingest({ url: 'https://example.com', previous: existing })
```

The CLI does it for you. `recourse ingest` reads the index already at the output
path and reports what it skipped:

```
Indexed 412 documents into 1,840 chunks in 41.2s
Embedded 6 changed chunks, kept 1834
```

`--fresh` re-embeds everything, for when you have changed chunker settings and
the old vectors describe text that no longer exists.

A chunk is carried over when its indexed text is byte-for-byte what it was.
That is stricter than "same page": an edited paragraph re-embeds, and so does
one whose heading moved, because the heading is part of what was embedded. It
is deliberately not matched on the chunk id, which is derived from position, so
inserting a paragraph high up a page does not re-embed everything below it.

Changing the embedding model ignores the previous index entirely. Vectors from
two models are not comparable, and half an index from each would rank nonsense
highly while looking like it worked.

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

## A call costs more than a conversation

Typing is billed in tokens. Talking is billed in tokens, plus every second of
audio going in, plus every character of speech coming out, and the last of
those is most of the bill.

Measured on this library, one provider doing all three parts, for a minute of
call where the caller talks for about twenty seconds and the agent for thirty:

```
speech recognition   $0.0002    twenty seconds of audio
the model            $0.0005    four exchanges
speech synthesis     $0.0051    about 230 characters spoken
                     -------
                     $0.0058    call it six tenths of a cent
```

**Synthesis is around ninety per cent of that**, so it is the only line worth
optimising and the voice you choose is the whole decision. At the time of
writing, per million characters: OpenAI `tts-1` $15, Groq's Orpheus $22,
Deepgram Aura-2 $30, ElevenLabs Flash $50. Across that range a minute of call
costs between four tenths of a cent and about one and a fifth.

Two things follow from the shape of that bill rather than its size.

**Brevity is a cost control on a call in a way it is not in chat.** A reply
twice as long costs twice as much to speak, takes twice as long to say, and is
worse to listen to. `maxOutputTokens` and an instruction to answer in two
sentences are doing double duty here.

**A greeting is synthesised on every single call**, and it is the same sentence
every time. Nothing here caches it for you. If you take enough calls for that
to matter, wrap the `Voice` you pass in and keep the bytes for that one string:

```ts
const remembered = new Map<string, Awaited<ReturnType<Voice['speak']>>>()

const voice: Voice = {
  name: 'cached',
  speak: async (text, signal) => {
    const held = remembered.get(text)
    if (held) return held

    const clip = await underlying.speak(text, signal)
    // The greeting and little else. Caching every sentence a model writes
    // would fill memory with strings said once.
    if (text.length < 120) remembered.set(text, clip)

    return clip
  },
}
```

### Against letting somebody else carry the call

The other way to answer a call is to hand the whole thing to a voice platform,
which this library also supports. That is about eight cents a minute, with the
model billed separately on top, and the comparable bundled services sit between
six and eight.

So carrying it yourself is roughly ten times cheaper, and the honest version of
that sentence is that you are paying the difference in operations rather than
saving it outright: you run a transcriber, a voice and a model, and their speed
and uptime become yours. A shop taking a few calls a day should take the easy
one. A shop taking a thousand minutes a month is looking at eighty dollars
against six.

The reason both are here is that the choice changes with volume, and it should
not require rewriting the agent. See [calls](calls.md) for how to switch.

## What it costs to have all of this on

Nothing measurable. The budget check is one counter read, the repeat guard is a
map lookup, and cutting a result down is cheaper than sending it. The one
exception is `takeover`, which reads the conversation once per turn, and is off
until you ask for it.
