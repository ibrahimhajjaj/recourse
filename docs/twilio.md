# Answering a phone number

Two ways, and the choice is not close: **use Conversation Relay unless you
cannot.** The other one is here because it works on any account this afternoon
with no socket to host.

> Neither of these has been run against a live Twilio account by the author.
> The code follows Twilio's documentation as of September 2026 and is covered by
> tests against recorded shapes, but the first person to point a real number at
> it will find something. Please open an issue when you do.

## Before any code

Conversation Relay is gated behind a term you have to accept, and nothing works
until you do.

1. Twilio Console, **Products & Services** then **Voice**, **Settings**,
   **Privacy & Security**.
2. Accept the predictive and generative AI features addendum. Save.

Then point a number at your server. **Numbers & senders**, pick the number,
**Voice Configuration**, set **A call comes in** to **Webhook**, and paste your
URL. That is the whole setup. No allowlist, no feature flag, nobody to email.

## Conversation Relay

Twilio holds the call and runs the voice. Your server answers one HTTP request
to open the socket, then talks to Twilio over that socket for the rest of the
call. The caller can interrupt, and speech starts before the answer is finished.

Two routes. The first is the number's webhook:

```ts
import { voiceChannel } from '@recourse-ai/core/channels'

export const POST = voiceChannel({
  websocketUrl: 'wss://agent.example.com/voice/relay',
  welcomeGreeting: 'Hello, Lumen Coffee. How can I help?',
  authToken: process.env.TWILIO_AUTH_TOKEN as string,
  // The exact public url Twilio calls. Behind a proxy your framework will
  // rebuild this wrongly and every signature check will fail.
  publicUrl: 'https://agent.example.com/voice/answer',
  // Terms the transcriber should expect. The cheapest quality win here: an
  // agent retrieving on a misheard product name answers the wrong question
  // confidently.
  hints: ['Lumen', 'Ethiopia Guji', 'LUM-1234'],
})
```

The second is the socket, and it is where the conversation happens:

```ts
import { createVoiceSession, verifyRelayHandshake } from '@recourse-ai/core/channels'

// Check the handshake before you accept it. See below: this is the step
// everybody skips.
const ok = await verifyRelayHandshake({
  signature: request.headers.get('x-twilio-signature'),
  url: 'wss://agent.example.com/voice/relay',
  authToken: process.env.TWILIO_AUTH_TOKEN as string,
})
if (!ok) return new Response('no', { status: 403 })

const session = createVoiceSession({ agent })
```

### Verify the socket, not just the webhook

The upgrade request carries `x-twilio-signature` exactly like the webhook does.
An unverified socket answers anybody who learns the url, and every turn on it is
a model call and a synthesis you pay for.

**Sign the `wss://` string from your TwiML, character for character.** Not the
`https://` one your framework rebuilds from the request. No trailing slash. No
explicit `:443`. Empty parameters, because an upgrade has no form body.

Twilio does not document which url string to use. This is the one that works,
established by people who brute-forced the alternatives, and it is worth knowing
because getting it wrong does not look like a rejected signature. The caller
gets error **64102, "Unable to Connect to Websocket URL"**, which reads like the
network is down.

### The settings people actually change

| What | Attribute | Default |
| --- | --- | --- |
| Who speaks | `ttsProvider`, `voice` | ElevenLabs |
| Who listens | `transcriptionProvider` | Deepgram |
| Whether the caller can talk over it | `interruptible` | `any` |
| How twitchy that is | `interruptSensitivity` | `high` |
| Ignoring "uh-huh" and "yeah" | `ignoreBackchannel` | off |
| Words to expect | `hints` | none |

One thing worth knowing because it changed and old tutorials are wrong about it:
**Twilio stops the speech itself when the caller interrupts**, and tells you
afterwards. There is no message you can send to stop playback. What you get is
how far it got before being cut off, which is what your history should record,
because that is all the caller heard.

Separately, `reportInputDuringAgentSpeech` decides whether you are *told* about
speech during the agent's turn, and its default flipped to off in May 2025. It
is independent of whether playback stops.

### What it costs

$0.07 a minute on top of normal voice charges. The model and any voice you bring
are billed separately. See [costs](costs.md) for how that compares to the other
ways of running a call.

## The plain call-and-response loop

One HTTP request per turn. No socket to host, works on any account immediately.

```ts
import { gatherVoiceChannel } from '@recourse-ai/core/channels'

export const POST = gatherVoiceChannel({
  agent,
  greeting: 'Hello, Lumen Coffee. How can I help?',
  authToken: process.env.TWILIO_AUTH_TOKEN as string,
  publicUrl: 'https://agent.example.com/voice/turn',
  hints: ['Lumen', 'LUM-1234'],
})
```

What you give up is real and you should know it before choosing this:

**The caller cannot talk over it.** Only a keypress cuts the prompt short.
Speech does not.

**Every turn is a full stop-and-wait.** The prompt plays to the end, then Twilio
listens, then a silence has to elapse, then it posts to you, then you answer.
There is no speaking while thinking.

**A caller cannot speak for more than sixty seconds**, and it cannot hear
individual letters and digits like "ABC123" reliably.

Take this to get a number answering today, and move to Conversation Relay when
the latency starts to matter.

### One thing to leave alone

By default this does not pin a speech model, and that is deliberate. Twilio
picks one and can switch to another provider when one is having a bad day.
Pinning gives that up.

If you pin one anyway, you must also give it a timeout, because Twilio rejects a
pinned model alongside the automatic end-of-speech detection this otherwise
uses:

```ts
gatherVoiceChannel({ agent, speechModel: 'deepgram_nova-3', speechTimeoutMs: 1200 })
```

Automatic is usually better regardless. It cuts as soon as the caller pauses
rather than waiting out a timer.

## Trying it without a phone

You cannot point Twilio at `localhost`, so put a tunnel in front:

```bash
ngrok http 3000
twilio phone-numbers:update "+18005550100" \
  --voice-url https://your-tunnel.ngrok-free.app/voice/answer
```

Then make it ring, from the terminal, with no handset involved:

```bash
twilio api:core:calls:create \
  --from "+18005550100" --to "+18005550101" \
  --url "https://your-tunnel.ngrok-free.app/voice/answer"
```

ngrok's inspector at `http://127.0.0.1:4040` shows you the raw request including
the signature header, which is where you go when validation fails.

There is no simulator for the Conversation Relay socket. Test that half by
sending it the message shapes directly, which is what this library's own tests
do.

## When it will not connect

**Error 64102.** Usually the signature, not the network. See above.

**Signatures failing behind a proxy.** Your load balancer terminated the
encryption, so your app sees `http://` where Twilio signed `https://`. Pass the
real public url explicitly rather than letting the framework guess.

**Nothing happens at all.** Check you accepted the AI addendum. Conversation
Relay is inert until you do.

---

[Back to the README](../README.md)
