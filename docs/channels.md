# Answering where the customer already is

Eleven adapters. Every one verifies its webhooks, acknowledges before it answers,
and refuses to reply to itself.

```ts
import { whatsappChannel } from '@recourse-ai/core/channels'

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
| Intercom | `intercomChannel` | `X-Hub-Signature`, SHA-1, which is their choice |

Intercom appears twice in this repository and they are different things. The
connector in [docs/escalation.md](escalation.md) opens a ticket and walks away.
`intercomChannel` is a conversation: the customer types in the Intercom
messenger on your site, the agent answers there, and the thread stays where
your team already works. It needs an `adminId`, because Intercom attributes
every admin reply to somebody, so make an admin for the agent rather than
borrowing a colleague's name.

`parseCommonEmail` reads the shapes Postmark, SendGrid, Mailgun, Cloudflare Email
Routing and Brevo send, which is five ways of naming the same six facts. Brevo
is the one that nests, posting an array under `items` with addresses as objects
rather than as `Name <address>` strings. Anything else is a `parse` of your own,
which is a dozen lines and the reason that option exists.
| Sunshine | `sunshineChannel` | a shared secret, since Zendesk signs nothing |

## One adapter, eight channels

Sunshine Conversations is Zendesk's messaging platform, and it is worth calling
out because it is an aggregator. One integration reaches WhatsApp, Messenger,
Instagram, Telegram, LINE, WeChat, Viber and SMS: Zendesk has already done the
per-platform work and hands every one of them over in the same envelope, with
`source.type` saying which channel a message actually arrived on.

```ts
import { sunshineChannel } from '@recourse-ai/core/channels'

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

## A call from the page, with no phone in it

All three above answer a telephone. `browserVoiceRoute` is the fourth shape: a
Call button in the widget, on the page the visitor is already reading. That is
what people reach for when the thing they want to ask is on the screen in front
of them and typing it out would take four sentences.

The browser cannot open that connection by itself, because it needs an account
credential, and a credential on a page is a credential anybody can spend. So the
route is a swap. The page asks it, it spends the key server-side, and it hands
back a URL good for one call that expires in fifteen minutes.

```ts
import { browserVoiceRoute } from '@recourse-ai/core/channels'

export const POST = browserVoiceRoute({
  agentId: process.env.ELEVENLABS_AGENT_ID as string,
  apiKey: process.env.ELEVENLABS_API_KEY as string,
  rateLimit: { limit: 5, windowMs: 10 * 60_000 },
})
```

Then point the widget at it, and the button appears:

```html
<script src="/recourse.js" data-endpoint="/api/chat" data-call="/api/voice/token"></script>
```

Read that rate limit as part of the feature. Every success is a billable minute
on your account and the button is public, so an unguarded route is a way for a
stranger to spend your money. The built-in limiter is per instance and stops a
script rather than a determined person; pass `rateLimiter` for one that holds
across instances if the budget matters.

Pair it with `elevenLabsToolRoute` on the same agent and the call can do the
thing a recorded menu cannot: look up the actual order while the customer is
still speaking. The voice service keeps the parts that have to happen in
milliseconds, and the facts stay yours. `examples/nextjs` has both routes wired
and the button switched on.

What the visitor sees is one thread. The call is marked where it starts and
where it ends, and what was said appears as messages alongside what was typed,
because a spoken question and a typed one are the same conversation.

### Or carry the call yourself

`browserVoiceRoute` hands the call to a voice service. The other way is to keep
it, which is what `attachCall` is for: the browser opens a socket to your own
server, sends the microphone, and gets speech back.

The difference is not the transport, it is who decides what gets said. On the
vendor path their agent composes the words and yours supplies facts through a
tool. Here the answer comes from the same `createAgent` that answers your chat,
so the persona, the safety classifier and the procedures all still apply. The
cost is that you run a transcriber and a voice, and their speed is yours to own.

```ts
import { attachCall } from '@recourse-ai/core/channels'

// A Worker, where a socket is native and there is no upgrade to negotiate.
const pair = new WebSocketPair()
const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
server.accept()

attachCall(server, { agent, transcriber, voice })

return new Response(null, { status: 101, webSocket: client })
```

Then in the widget, the same button with a different transport:

```html
<script
  src="/recourse.js"
  data-endpoint="/api/chat"
  data-call="/api/voice/call"
  data-call-transport="hosted"
></script>
```

`attachCall` asks only for something that sends and receives, because every
runtime spells a socket differently. The wire is plain: text frames are JSON
control messages, binary frames are audio, and there is no envelope around the
audio because a WebSocket already keeps message boundaries and a header on every
twenty millisecond slice is a header fifty times a second.

Three parts of this are worth knowing before you wire it up. The microphone is
asked for with echo cancellation on, without which it hears the agent through
the speakers and answers its own sentences. Speech is spoken a sentence at a
time as the answer streams, so the caller hears the opening clause while the
rest is still being written. And an interruption abandons the whole answer
rather than the clause in the air, because finishing a sentence nobody is
listening to is worse than saying nothing.

`examples/worker` has it wired, and its bundle guard proves the whole path runs
on the edge with no Node built-ins.

#### What a business gets to set

The parts of a call people ask to change, and where each one lives.

| Setting | Where |
| --- | --- |
| Greeting on connect | `greeting` |
| How eagerly it stops when talked over | `turns.bargeInMs` |
| How long a pause ends a turn | `turns.endOfTurnSilenceMs` |
| What counts as speech rather than a cough | `turns.minSpeechMs` |
| How far above the room's noise speech must be | `turns.marginOverNoise` |
| Longest one turn may run | `turns.maxTurnMs` |
| Longest the whole call may run | `maxCallMs` |
| Which voice, and its speed and stability | the `Voice` you pass |
| Which speech recogniser | the `Transcriber` you pass |
| What it says and refuses to say | the `Agent` you pass |
| Logging, analytics, billing | `onTurn` and `onEnded` |

Two of those deserve saying out loud. **Interruption is the setting people
complain about most**, in both directions: an agent that talks over somebody
mid-sentence, and one that will not stop when interrupted. It is five numbers
here rather than a constant, because the right answer differs between a quiet
office and a phone on a train.

And **`maxCallMs` is a cost control, not a nicety**. A forgotten tab with an
open microphone bills for speech recognition until the browser closes.

```ts
attachCall(socket, {
  agent,
  transcriber,
  voice,
  greeting: 'Hello, Lumen Coffee. How can I help?',
  maxCallMs: 10 * 60_000,
  turns: { bargeInMs: 300, endOfTurnSilenceMs: 700 },
  onTurn: ({ question, answer, ms }) => log(question, answer, ms),
})
```

The greeting is interruptible like anything else, so somebody who already knows
what they want can talk straight over it.

#### Why this is a socket and not WebRTC

WebRTC is the better transport on a bad network. It runs over UDP, so one lost
packet does not stall everything behind it the way it does on a socket, and it
brings a jitter buffer and loss concealment with it. It is not shipped here, and
the reasons are worth stating rather than leaving as an omission.

A Worker cannot terminate a peer connection. Cloudflare's own WebRTC offering is
a separate managed TURN and SFU service, not something the runtime does, so
adding WebRTC would take this feature off the one platform it runs on best.
On Node the pure implementation is four megabytes and nine dependencies, against
a whole core package of three hundred kilobytes. And it needs STUN and TURN
behind it to cross a NAT at all, which is infrastructure to run or a service to
pay for.

None of that stops you using it. `attachCall` asks for anything that sends and
receives, and the widget takes a `connect` that returns anything socket-shaped.
A WebRTC data channel already has `send`, `close` and the four handlers, so it
satisfies both without a line of code changing here; the only adjustment is that
a channel reports `readyState` as a string. The protocol is deliberately
transport-agnostic so that decision stays yours.

### The model is the latency, not the retrieval

Worth knowing before you point this at whatever answers your chat. A voice tool
has a timeout measured in seconds, and when it passes the agent stops talking,
which the caller hears as the line dropping rather than as an error.

Measured here against a 30 second timeout: a local reasoning model took **53
seconds** for a single question, and a smaller local model **37**. Published
work on voice agents puts retrieval at 50 to 300ms and model generation at 500
to 8000ms, which matches: the model is the whole cost.

Two things follow. Give voice its own fast provider rather than sharing the one
answering chat, since the fast option is usually a different host entirely. And
cap the answer with `maxOutputTokens`, because a reply written for a screen can
be skimmed and one read aloud cannot: a wordy paragraph is half a minute of
somebody waiting for their turn to speak.

```ts
import { createAgent } from '@recourse-ai/core'

createAgent({
  index: knowledge,
  model: fastModel,
  // Roughly two or three sentences of speech. The instruction asks for
  // brevity; this is the backstop for a model that ignores it.
  maxOutputTokens: 120,
})
```

Retrieval is not worth optimising here. The index is read from memory in the
same process, so there is no database round trip to remove.

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
import { defaultDisclosure, telegramChannel } from '@recourse-ai/core/channels'

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
import { slackChannel } from '@recourse-ai/core/channels'

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
