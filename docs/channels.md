# Answering where the customer already is

Eleven adapters. Every one verifies its webhooks, acknowledges before it answers,
and refuses to reply to itself.

```ts
import { whatsappChannel } from 'helpdeck/channels'

export const POST = whatsappChannel({
  agent,
  appSecret: process.env.META_APP_SECRET!,
  verifyToken: process.env.META_VERIFY_TOKEN!,
  phoneNumberId: process.env.WHATSAPP_PHONE_ID!,
  accessToken: process.env.WHATSAPP_TOKEN!,
})
```

That is the shape of all of them: a route handler, the agent, and whatever the
platform needs to prove the request came from it.

| Channel | Import | Proves the request with |
| --- | --- | --- |
| WhatsApp | `whatsappChannel` | HMAC over the payload |
| Messenger | `messengerChannel` | HMAC over the payload |
| Instagram | `instagramChannel` | HMAC over the payload |
| Slack | `slackChannel` | HMAC over a timestamped payload |
| Telegram | `telegramChannel` | a secret you choose |
| Discord | `discordChannel` | Ed25519 |
| Teams | `teamsChannel` | a signed JWT from Microsoft |
| SMS | `twilioChannel` | HMAC over the exact URL |
| Phone | `voiceChannel`, `gatherVoiceChannel`, `elevenLabsToolRoute` | HMAC over the exact URL, or a bearer token |
| Email | `emailChannel` | a shared secret, since providers rarely sign |
| Sunshine | `sunshineChannel` | a shared secret, since Zendesk signs nothing |

## One adapter, eight channels

Sunshine Conversations is Zendesk's messaging platform, and it is worth calling
out because it is an aggregator. One integration reaches WhatsApp, Messenger,
Instagram, Telegram, LINE, WeChat, Viber and SMS: Zendesk has already done the
per-platform work and hands every one of them over in the same envelope, with
`source.type` saying which channel a message actually arrived on.

```ts
import { sunshineChannel } from 'helpdeck/channels'

export const POST = sunshineChannel({
  agent,
  webhookSecret: process.env.SUNSHINE_WEBHOOK_SECRET!,
  appId: process.env.SUNSHINE_APP_ID!,
  keyId: process.env.SUNSHINE_KEY_ID!,
  keySecret: process.env.SUNSHINE_KEY_SECRET!,
})
```

It is also the only channel here that signs nothing. A shared secret arrives in
`X-API-Key` and comparing it is the entire security model, which is Zendesk's
design rather than a shortcut taken here. Treat that secret like a password:
anyone holding it can post anything to your endpoint.

Its disclosure is better than ours and is on by default. Marking the reply with
the `AI` author subtype makes Sunshine append its own disclaimer in the
customer's own client, per channel, for text, image and file messages alike. Set
`disclosure` as well and the customer is told twice, so use one or the other.

## Three ways to answer a phone, and the one you can use today

`voiceChannel` uses Twilio's Conversation Relay over a WebSocket. It is the best
experience: the caller can interrupt, and speech starts before the whole answer
is generated. It also needs Twilio onboarding, an accepted AI addendum, a public
WebSocket endpoint, and it carries its own concurrency limits.

`gatherVoiceChannel` is plain TwiML: one HTTP request per turn, no socket to
host, and it works on any Twilio account this afternoon. What you give up is
real, no barge-in and a pause while the whole answer is generated before any of
it is spoken. Take this to get a number answering today and move to Relay when
the latency starts to matter.

`elevenLabsToolRoute` is neither. ElevenLabs owns the call and this library is
the webhook tool their agent calls, which is the only one of the three that
needs no Twilio account at all. It is also the one proved against a live
platform.

## Two that are not here, on purpose

**3CX.** There is nothing to build against. Their own forums say 3CX cannot
receive webhooks, and as of February 2026 external interactivity is still listed
as roadmap. Any working integration is a partner arrangement rather than a
public API.

**Genesys Cloud.** Buildable, and deliberately not built. Open Messaging signs
with `X-Hub-Signature-256`, which the Meta verifier here already handles, so the
hard part is free. The problem is shape: it is a channel-bridge API, where you
sit between Genesys and some external messaging service and Genesys' own agents
and bots do the answering. Putting this library in that flow is a different
architecture from every other adapter, and getting it right needs a Genesys org
to test against. Guessing at it and shipping it would be the exact mistake this
project keeps finding in other people's documentation.

## Before you wire one up

Two files are worth more than this page.

[`examples/nextjs/.env.example`](../examples/nextjs/.env.example) lists every
credential each channel needs and, for several of them, the step the platform's
own documentation leaves out. Those steps cost hours to find and announce
themselves in no way at all: a Meta test number that is not registered, an app
subscription that reports success while subscribing to nothing, a verify
handshake that sends every parameter twice.

[`CHANNELS-VERIFIED.md`](../CHANNELS-VERIFIED.md) says which adapters have been
through real traffic from a real account and which have not. Seven have. The
difference is kept out of this page on purpose, so nothing here reads as a
claim it cannot support.

## Saying it is a machine

On a messaging channel there is no interface to put a disclosure in. No header,
no avatar with a label. The message is the only surface, so the disclosure has
to be a message.

```ts
import { defaultDisclosure, telegramChannel } from 'helpdeck/channels'

telegramChannel({ agent, botToken, secretToken, disclosure: defaultDisclosure })
```

Said once per conversation, as its own message rather than welded onto the front
of an answer about delivery times. Off unless you set it: a deployment outside
the EU may not need it, one inside it does, and that is not ours to decide from
here. EU AI Act Article 50(5) wants it at or before the first interaction, and
answering honestly when somebody asks is a different obligation that does not
satisfy this one.

## Sources under the answer

A chat widget renders `[1]` as a link because it gets the source list beside the
text. A messaging channel gets a string, so without help the customer reads a
footnote marker with no footnote.

```ts
import { slackChannel } from 'helpdeck/channels'

slackChannel({ agent, signingSecret, botToken, citations: 'list' })
```

`list` is the default. Use `none` where the links are noise, or where the reader
cannot follow them anyway, which is every voice channel.

## Or none of them

The agent underneath has no transport at all:

```ts
const { text, sources, unanswered } = await agent.answer('where is my order?')
```

That is the whole integration for anything that receives a message: a queue
worker, a CLI, a channel nobody has written an adapter for yet.

---

[Back to the README](../README.md)
