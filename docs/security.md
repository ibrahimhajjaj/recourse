# Locking it down


## Knowing who is asking

A person on a support desk has the customer's record open. They answer from it,
and they know when a conversation stops being a question and becomes a security
matter.

Pass a `contact` and the agent gets the same. `Contact.attributes` reaches the
prompt, so the answer is written for the plan the person is actually on rather
than for a stranger:

```ts
contact: {
  name: 'Sam Okafor',
  email: 'sam@shop.example',
  attributes: { plan: 'Starter', customerSince: '2024' },
  verified: true,
}
```

The rules that come with it matter more than the facts.

**The record is never read out.** A model handed an account will otherwise
recite it, and confirming a detail back to whoever is typing is how you tell an
attacker whether they guessed right.

**`verified` is the whole difference.** Anybody can type an email address. Until
something checked it, the record is a hint for phrasing an answer and nothing
that can be acted on, and the prompt says so in those words.

**Anything touching the account goes to a person**, and that rule is not part of
this block: it applies to everybody, including a visitor nobody has identified,
because somebody with no account at all can still say they have been hacked.

It is written as a list of things people say rather than as a category, on the
assumption that the model is not clever. "Account security" is a heading a large
model infers and a small one does not, so the prompt names the situations: they
have been hacked, somebody else is in their account, they do not recognise a
charge, they want to change an email or password, they are locked out, they want
money sent to a different card, they are asking on somebody else's behalf, they
want data deleted, they mention a lawyer or a regulator, or they may be in
danger.

The second half is about how this actually gets defeated, which is pressure
rather than cleverness. The agent is told not to work out who anybody is, not to
ask for a password or a photograph of a document, and not to say whether a name
or an order number somebody gave is correct, because confirming it is how an
attacker learns what to guess next. Being angry, being in a hurry, claiming to
work there and saying somebody already approved it are named as what they are:
the usual ways this gets talked past, and not reasons to continue.

An anonymous visitor produces exactly the prompt they always did. Nothing is
added when there is nobody to add.


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

## What a customer is told when the provider fails

A provider's error string is written for whoever holds the API key. It quotes
the request back, which means the customer's own words, the instructions, and
sometimes a URL with a token in it. Putting that on a chat widget publishes all
three, and storing it in the transcript keeps them next to the conversation
forever.

So the customer gets a sentence and a reference, and the provider's own words go
to `console.error` and stop there:

```
I could not answer that. Try again in a minute. (reference k3n8fa)
```

```
[recourse] model call failed conversation=c_8f2 model=openai/gpt-4o ref=k3n8fa reason=rate_limited …
```

The two are joined by that reference rather than by copying the text into both,
so a customer who quotes it gets an operator straight to the line. Failures are
classified into a fixed vocabulary (`rate_limited`, `quota_exhausted`,
`unauthorized`, `timeout`, `too_large`, `unsupported_input`, `unavailable`,
`cancelled`, `unknown`) and anything unrecognised lands on `unknown`, which is
safe by construction: a new provider's phrasing degrades to a vague sentence
rather than to a leak.

The same applies to actions. An action that fails on an authenticated request
tends to quote the request, credential included, and that string is about to
become tool output and then a stored transcript, so it is redacted and capped
first.

`describeFailure` and `logFailure` are exported if you want the same split
somewhere else.

## Rate limiting

Per-instance by default, which stops a script and is not a budget control: N
serverless instances hand out N budgets. `rateLimiter` takes a shared one, and
two ship in the box.

```ts
import { createChatHandler, upstashRateLimiter } from '@recourse-ai/core/server'

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
import { phraseRule } from '@recourse-ai/core/safety'
import { buildInstructions } from '@recourse-ai/core/server'

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
import { createApiHandler } from '@recourse-ai/core/api'

export const GET = createApiHandler({
  store,
  helpdesk,
  knowledge,
  tokens: [process.env.RECOURSE_API_TOKEN!],
  admin: true,
})
```

Conversations, transcripts, message feedback, leads, analytics, the whole ticket
queue, and knowledge sources you can add and retrain without a deploy. `admin:
true` also serves a single self-contained page for reading yesterday's
conversations and the ranked list of questions nobody could answer.

That page has a Widget tab: every appearance and behaviour option as a control,
the real widget rendered beside them as a live preview, and the `<script>` tag
to paste into your site. The preview mounts the actual build rather than a
drawing of one, so what it shows is what visitors get; point it at a script the
browser can reach and it works, and when it cannot the snippet is still
correct.

Nothing there is saved, and that is the design rather than a shortcut. The
snippet is the configuration: it lives on your site, so there is no stored
copy that can drift from what visitors actually see, and no migration when a
field is added. A hosted product needs somewhere to keep your settings because
it renders the widget for you. Here you render it.

## Who read what

The management API hands back whole transcripts, so it is the one endpoint
worth recording access to:

```ts
createApiHandler({
  store,
  tokens: [process.env.RECOURSE_ADMIN_TOKEN as string],
  onAccess: (event) => logger.info('recourse.api', event),
})
```

It fires for refused requests as well as successful ones, which is the half an
access log exists for. `actor` is twelve hex characters of the token's SHA-256
rather than the token, so entries group by credential and a log file never
becomes a list of bearer tokens. A hook that throws is logged and ignored:
taking the API down because an audit sink is unavailable is not the safer
failure.

Nothing here writes it down, because where an access log belongs is a decision
about your infrastructure. Three separate regimes ask for one and none can be
satisfied afterwards: the HIPAA Security Rule wants a record of who examined
systems holding health information, the GDPR wants you able to show who
accessed personal data, and SOC 2 asks the same question.

On HIPAA specifically, one thing is worth saying plainly because it is the
opposite of what a feature comparison suggests. A hosted product needs a
business associate agreement with you because it processes your data on its
servers. Self-hosted, there is no business associate: the deployment is yours,
the data never leaves it, and the agreement you would have needed does not
apply. What does apply is the Security Rule on your own infrastructure, and
the model is the part to look at hardest, since a hosted model provider that
sees a transcript is a business associate even when nothing else is.

## Where the visitor is, if you ask and they agree

Chats by country is the one analytic that needs something about a person, so it
is off, and turning it on takes a decision rather than a flag:

```ts
import { consented } from '@recourse-ai/core/server'

createChatHandler({
  agent,
  analytics: { country: consented('analytics') },
})
```

No address is ever received. Cloudflare, Vercel, Netlify, CloudFront and App
Engine all resolve the country at the edge and pass it as a header, so what is
read is a two-letter code and what is stored is the same code on the
conversation. There is no address to leak, no database to keep current, and
behind an origin that resolves nothing, no country is recorded and everything
else works the same.

It is a function rather than `true` because consent is the one thing a library
cannot decide. It cannot know whether a banner was shown, what it said, or what
the visitor agreed to, and under the GDPR the lawful basis has to exist before
the data does. `consented('analytics')` reads `X-Recourse-Consent`, which is the
shape a consent manager already holds, and a missing header is a no. Pass your
own predicate if your consent lives somewhere else.

Two things worth saying plainly to whoever writes your privacy notice: a
country is not an identifier on its own, and `Cloudflare` sends `XX` for
unknown and `T1` for Tor, neither of which is recorded.

## Facts the model must never hold

Identity has two tiers here, and the difference matters more than it looks.

`contact.attributes` is the open one. It reaches procedure text, which reaches
the prompt, which can reach an answer. That is right for a name or a plan and
wrong for a billing id, a date of birth or an internal account reference.

The second tier is signed and stops at the action:

```ts
import { signClaims } from '@recourse-ai/core'

// On your server, where the secret lives.
const token = await signClaims({ stripeId: 'cus_123', dob: '1990-04-02' }, secret)
```

The browser passes the token through with the message, it is verified here, and
the contents arrive as `ctx.private` inside an action. Nothing that builds a
prompt reads it, so an action can look a customer up by their billing id
without the model ever holding the id.

Signed as one blob rather than field by field, because a browser passes it
through and an unsigned bag of facts from a browser is not a fact. A token
signed with the wrong secret, edited after signing, truncated, or carrying
something that is not an object all give the same answer: no verified claims,
rather than an exception.

The token carries its own proof, so it works even when the visitor's user id
did not verify. The two halves are independent on purpose.

---

[Back to the README](../README.md)
