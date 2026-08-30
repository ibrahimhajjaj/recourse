# Locking it down

## Already handled, before you configure anything

- Model output is rendered by building DOM nodes, never by assigning
  `innerHTML`. Script tags, `onerror` attributes and `javascript:` links in model
  output render as inert text.
- Webhooks are verified: HMAC for Meta and Slack and Twilio, Ed25519 for
  Discord, and a JWT checked against Microsoft's published keys for Teams. The
  Slack check enforces its replay window; `alg: none` and HMAC key confusion are
  rejected for Teams.
- Visitors can be cryptographically identified with HMAC, byte-compatible with
  what comparable products use, so actions can refuse to expose personal data to
  an unverified session.
- Outbound webhooks are signed over `timestamp.body`, so a captured delivery
  cannot be replayed with a fresh timestamp.
- Outbound campaigns refuse to contact anyone without explicit consent, drop
  duplicates, and stop early when too much is failing.

## Rate limiting

Per-instance by default, which stops a script and is not a budget control: N
serverless instances hand out N budgets. `rateLimiter` takes a shared one, and
two ship in the box.

```ts
import { createChatHandler, upstashRateLimiter } from 'helpdeck/server'

createChatHandler({
  index,
  rateLimiter: upstashRateLimiter({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    limit: 30,
  }),
})
```

Upstash is a sliding window over their REST API, so there is no client to
install and nothing to keep connected. `redisRateLimiter({ client })` takes any
Redis you already have. Both fail open, because a Redis outage turning every
customer away is a worse failure than a few minutes of unmetered traffic.

## Screening what comes in

- A message is screened before retrieval and before the model, with per-category
  sensitivity you set. Refused messages never reach a provider, which makes the
  hostile path faster than the ordinary one rather than slower: 0.23s against
  14.5s on the same machine.
- Invisible characters smuggled into a message are stripped, and the phrase
  rules read a copy with every invisible removed, so splitting a banned phrase
  with zero-width joiners does not get past them. Characters that are load
  bearing in real writing are left alone: a Persian zero-width non-joiner is
  spelling, and the bidi marks in Arabic and Hebrew are what stop an order
  number rendering backwards.
- Over-refusal is measured, not hoped for. Fifty ordinary support questions,
  including "please disregard my last message" and three angry customers, are
  refused zero times at the default policy and again at maximum sensitivity.

## Every number here is yours to change

They are all measured rather than assumed, which is exactly why none of them
should be treated as a constant:

```ts
import { phraseRule } from 'helpdeck/safety'
import { buildInstructions } from 'helpdeck/server'

createChatHandler({
  index,
  // Measured against one corpus and one embedding model. Both change.
  retrieval: { vectorFloor: 0.5, keywordFloor: 0.35, coverageFrom: 4 },
  classifier: {
    categories: [{ name: 'injection', action: 'refuse', sensitivity: 'high' }],
    // The shipped phrase lists are English. Add your own without losing them.
    rules: [phraseRule('override-es', 'injection', [
      { pattern: /\bignora\s+(todas\s+)?las\s+instrucciones\b/i, score: 0.95 },
    ])],
    passageThreshold: 0.8,
  },
  // And the prompt itself, which is the biggest policy of all. Compose from
  // the default rather than starting over:
  prompt: (context) => `${buildInstructions(context)}\n\nAlways sign off as Sam.`,
})
```


## Management API and admin page

It serves whole conversations, captured leads and tickets, so `tokens` is the
difference between an internal tool and a public one. Mounted without them it
warns once at startup rather than failing, because behind a private network open
is a reasonable thing to want and this cannot tell which network it is on.

Tokens are compared in constant time, the same way every webhook signature here
is. `includes` would stop at the first wrong character and take longer the more
of the token was right, and this is the last endpoint that should compare more
weakly than the webhooks do.


```ts
import { createApiHandler } from 'helpdeck/api'

export const GET = createApiHandler({
  store,
  helpdesk,
  knowledge,
  tokens: [process.env.HELPDECK_API_TOKEN!],
  admin: true,
})
```

Conversations, transcripts, message feedback, leads, analytics, the whole ticket
queue, and knowledge sources you can add and retrain without a deploy. `admin:
true` also serves a single self-contained page for reading yesterday's
conversations and the ranked list of questions nobody could answer.

---

[Back to the README](../README.md)
