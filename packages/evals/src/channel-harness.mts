/**
 * Every channel adapter, over real HTTP, with real signatures.
 *
 * The card for live verification needs accounts that take days to get. This is
 * the half that does not: a local server with the real adapters mounted, and
 * requests signed exactly the way each platform signs them, posted over a
 * socket rather than called in process.
 *
 * What that proves, which unit tests do not:
 *
 * - the whole request path works with real serialisation, real headers and a
 *   real body stream, not an object handed straight to a function
 * - a correctly signed request is accepted
 * - the same request with one byte changed is refused
 * - a replayed old request is refused where the platform expects that
 *
 * What it cannot prove, and nothing local can: that the platform's current
 * signature scheme is still the one implemented here. Platforms drift. That is
 * what the accounts are for, and the card says so.
 *
 *   npx tsx src/channel-harness.mts
 */

import { createServer } from 'node:http'
import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import {
  slackChannel,
  telegramChannel,
  discordChannel,
  twilioChannel,
  whatsappChannel,
  messengerChannel,
  emailChannel,
} from '@recourse-ai/core/channels'
import { memoryStore } from '@recourse-ai/core/store'

const SECRETS = {
  slackSigning: 'slack-signing-secret-for-the-harness',
  metaApp: 'meta-app-secret-for-the-harness',
  twilioAuth: 'twilio-auth-token-for-the-harness',
  emailHeader: 'x-webhook-secret',
  emailSecret: 'email-shared-secret-for-the-harness',
  telegramSecret: 'the-secret-passed-to-setwebhook',
  verifyToken: 'the-token-typed-into-metas-dashboard',
}

const PORT = 8791
const PUBLIC_URL = `http://127.0.0.1:${PORT}`

/** Discord signs with Ed25519, so the harness needs a real key pair. */
const discordKeys = generateKeyPairSync('ed25519')
const discordPublicKey = Buffer.from(
  discordKeys.publicKey.export({ format: 'der', type: 'spki' }),
).subarray(-32).toString('hex')

const index = await buildIndex({
  sources: [
    textSource([
      {
        id: 'shipping',
        title: 'Shipping',
        url: 'https://shop.example/shipping',
        text: '# Shipping\n\nUnited Kingdom orders arrive in 1-2 working days. Delivery is free over 30 pounds.',
      },
    ]),
  ],
})

/** Answers without a real model, so the harness measures transport. */
const agent = createAgent({
  index,
  embedder: false,
  store: memoryStore(),
  model: {
    specificationVersion: 'v3' as const,
    provider: 'harness',
    modelId: 'harness',
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: '0' })
            controller.enqueue({ type: 'text-delta', id: '0', delta: 'Two working days [1].' })
            controller.enqueue({ type: 'text-end', id: '0' })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            })
            controller.close()
          },
        }),
      }
    },
  } as never,
})

const agentOptions = { agent }

/**
 * Every adapter's outbound send is captured rather than sent.
 *
 * The signatures differ per platform, deliberately: Telegram takes a chat id
 * that may be a number, Discord takes an interaction token, email takes a whole
 * reply object. Papering over that with one type would hide the thing the
 * adapters are actually doing.
 */
const sent: Array<{ channel: string; to: string; text: string }> = []

const capture =
  (channel: string) =>
  async (to: string | number, text: string): Promise<void> => {
    sent.push({ channel, to: String(to), text })
  }

const captureEmail =
  (channel: string) =>
  async (reply: { to: string; subject: string; text: string }): Promise<void> => {
    sent.push({ channel, to: reply.to, text: reply.text })
  }

const routes: Record<string, (request: Request) => Promise<Response>> = {
  '/slack': slackChannel({ ...agentOptions, signingSecret: SECRETS.slackSigning, botToken: 'x', send: capture('slack') }),
  '/telegram': telegramChannel({
    ...agentOptions,
    botToken: 'x',
    secretToken: SECRETS.telegramSecret,
    send: capture('telegram'),
  }),
  '/discord': discordChannel({
    ...agentOptions,
    publicKey: discordPublicKey,
    applicationId: 'app_1',
    send: capture('discord'),
  }),
  '/twilio': twilioChannel({
    ...agentOptions,
    accountSid: 'AC0',
    authToken: SECRETS.twilioAuth,
    from: '+15550000000',
    publicUrl: `${PUBLIC_URL}/twilio`,
    send: capture('twilio'),
  }),
  '/whatsapp': whatsappChannel({
    ...agentOptions,
    appSecret: SECRETS.metaApp,
    verifyToken: SECRETS.verifyToken,
    phoneNumberId: '1',
    accessToken: 'x',
    send: capture('whatsapp'),
  }),
  '/messenger': messengerChannel({
    ...agentOptions,
    appSecret: SECRETS.metaApp,
    verifyToken: SECRETS.verifyToken,
    accessToken: 'x',
    send: capture('messenger'),
  }),
  '/email': emailChannel({
    ...agentOptions,
    secret: { header: SECRETS.emailHeader, value: SECRETS.emailSecret },
    send: captureEmail('email'),
  }),
}

const server = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = []
  for await (const chunk of incoming) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)

  const url = new URL(incoming.url ?? '/', PUBLIC_URL)
  const handler = routes[url.pathname]

  if (!handler) {
    outgoing.writeHead(404).end('no such channel')
    return
  }

  const request = new Request(url, {
    method: incoming.method,
    headers: incoming.headers as Record<string, string>,
    ...(body.length > 0 ? { body } : {}),
  })

  const response = await handler(request)
  const text = await response.text()

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  outgoing.writeHead(response.status, headers).end(text)
})

await new Promise<void>((resolve) => server.listen(PORT, resolve))

interface Case {
  channel: string
  path: string
  body: string
  /** Headers for a request the platform would have signed correctly. */
  headers: (body: string) => Record<string, string>
  /** Headers for a request that should be refused, and why. */
  tampered?: (body: string) => Record<string, string>
  replayed?: (body: string) => Record<string, string>
}

const now = () => Math.floor(Date.now() / 1000)

function slackHeaders(body: string, timestamp = now()): Record<string, string> {
  const signature = createHmac('sha256', SECRETS.slackSigning)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')

  return {
    'content-type': 'application/json',
    'x-slack-request-timestamp': String(timestamp),
    'x-slack-signature': `v0=${signature}`,
  }
}

function metaHeaders(body: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': `sha256=${createHmac('sha256', SECRETS.metaApp).update(body).digest('hex')}`,
  }
}

function twilioHeaders(body: string, url = `${PUBLIC_URL}/twilio`): Record<string, string> {
  // Twilio signs the URL with the POST parameters appended in sorted key order.
  const params = new URLSearchParams(body)
  const sorted = [...params.keys()].sort()
  const payload = url + sorted.map((key) => key + params.get(key)).join('')

  return {
    'content-type': 'application/x-www-form-urlencoded',
    'x-twilio-signature': createHmac('sha1', SECRETS.twilioAuth).update(payload).digest('base64'),
  }
}

// `app_mention` rather than `message`: the adapter answers mentions by default
// and ignores everything else said in a channel, which is the right default and
// not something to test around.
const slackBody = JSON.stringify({
  type: 'event_callback',
  event: {
    type: 'app_mention',
    text: '<@U0BOT> how long does delivery take',
    channel: 'C1',
    user: 'U1',
    ts: '1.0',
  },
})

const telegramBody = JSON.stringify({
  update_id: 1,
  message: { message_id: 1, chat: { id: 42 }, from: { id: 42, first_name: 'Amina' }, text: 'how long does delivery take' },
})

const discordBody = JSON.stringify({
  type: 2,
  id: 'i1',
  token: 'tok',
  channel_id: 'c1',
  member: { user: { id: 'u1', username: 'amina' } },
  data: { name: 'ask', options: [{ name: 'question', value: 'how long does delivery take' }] },
})

const twilioBody = new URLSearchParams({
  From: '+15551230000',
  To: '+15550000000',
  Body: 'how long does delivery take',
  MessageSid: 'SM1',
}).toString()

const whatsappBody = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '1' },
            contacts: [{ profile: { name: 'Amina' }, wa_id: '447700900123' }],
            messages: [{ from: '447700900123', id: 'wamid.1', type: 'text', text: { body: 'how long does delivery take' } }],
          },
        },
      ],
    },
  ],
})

const messengerBody = JSON.stringify({
  object: 'page',
  entry: [{ messaging: [{ sender: { id: 'psid1' }, message: { mid: 'm1', text: 'how long does delivery take' } }] }],
})

const emailBody = JSON.stringify({
  from: 'Amina <amina@example.com>',
  subject: 'Delivery',
  text: 'how long does delivery take',
})

const cases: Case[] = [
  {
    channel: 'slack',
    path: '/slack',
    body: slackBody,
    headers: (body) => slackHeaders(body),
    tampered: (body) => ({ ...slackHeaders(body), 'x-slack-signature': 'v0=' + '0'.repeat(64) }),
    // Slack refuses anything older than five minutes.
    replayed: (body) => slackHeaders(body, now() - 400),
  },
  {
    channel: 'telegram',
    path: '/telegram',
    body: telegramBody,
    // Telegram does not sign anything. The secret token you passed to
    // setWebhook comes back on every call and is the whole of the check.
    headers: () => ({
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': SECRETS.telegramSecret,
    }),
    tampered: () => ({
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'wrong',
    }),
  },
  {
    channel: 'twilio',
    path: '/twilio',
    body: twilioBody,
    headers: (body) => twilioHeaders(body),
    tampered: (body) => ({ ...twilioHeaders(body), 'x-twilio-signature': 'nope' }),
    // Twilio signs the exact URL, so the same body called at another path fails.
    replayed: (body) => twilioHeaders(body, `${PUBLIC_URL}/somewhere-else`),
  },
  {
    channel: 'whatsapp',
    path: '/whatsapp',
    body: whatsappBody,
    headers: (body) => metaHeaders(body),
    tampered: (body) => ({ ...metaHeaders(body), 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }),
  },
  {
    channel: 'messenger',
    path: '/messenger',
    body: messengerBody,
    headers: (body) => metaHeaders(body),
    tampered: (body) => ({ ...metaHeaders(body), 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }),
  },
  {
    channel: 'email',
    path: '/email',
    body: emailBody,
    headers: () => ({ 'content-type': 'application/json', [SECRETS.emailHeader]: SECRETS.emailSecret }),
    tampered: () => ({ 'content-type': 'application/json', [SECRETS.emailHeader]: 'wrong' }),
  },
]

let passed = 0
let failed = 0

const check = (label: string, ok: boolean, detail = '') => {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

console.log(`channel adapters over HTTP on ${PUBLIC_URL}\n`)

for (const testCase of cases) {
  console.log(testCase.channel)
  const before = sent.length

  const accepted = await fetch(`${PUBLIC_URL}${testCase.path}`, {
    method: 'POST',
    headers: testCase.headers(testCase.body),
    body: testCase.body,
  })

  check('a correctly signed webhook is accepted', accepted.ok, `${accepted.status}`)

  // The adapters answer asynchronously so the platform gets its 200 first.
  await new Promise((resolve) => setTimeout(resolve, 250))
  check('and an answer went back out', sent.length > before, sent[sent.length - 1]?.text ?? '')

  if (testCase.tampered) {
    const refused = await fetch(`${PUBLIC_URL}${testCase.path}`, {
      method: 'POST',
      headers: testCase.tampered(testCase.body),
      body: testCase.body,
    })
    check('a tampered signature is refused', refused.status === 401, `${refused.status}`)
  }

  if (testCase.replayed) {
    const refused = await fetch(`${PUBLIC_URL}${testCase.path}`, {
      method: 'POST',
      headers: testCase.replayed(testCase.body),
      body: testCase.body,
    })
    check('a replayed or misdirected request is refused', refused.status === 401, `${refused.status}`)
  }

  console.log('')
}

// Discord signs with Ed25519 and needs its own shape, including the PING that
// Discord sends before it will save an endpoint at all.
console.log('discord')
{
  const headersFor = (body: string, timestamp = String(now())) => ({
    'content-type': 'application/json',
    'x-signature-timestamp': timestamp,
    'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), discordKeys.privateKey).toString('hex'),
  })

  const ping = JSON.stringify({ type: 1 })
  const pinged = await fetch(`${PUBLIC_URL}/discord`, {
    method: 'POST',
    headers: headersFor(ping),
    body: ping,
  })
  const pongBody = await pinged.json().catch(() => ({}))
  check('the PING that Discord sends before saving an endpoint gets a PONG', (pongBody as { type?: number }).type === 1)

  const before = sent.length
  const accepted = await fetch(`${PUBLIC_URL}/discord`, {
    method: 'POST',
    headers: headersFor(discordBody),
    body: discordBody,
  })
  check('a correctly signed interaction is accepted', accepted.ok, `${accepted.status}`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  check('and an answer went back out', sent.length > before, sent[sent.length - 1]?.text ?? '')

  const refused = await fetch(`${PUBLIC_URL}/discord`, {
    method: 'POST',
    headers: { ...headersFor(discordBody), 'x-signature-ed25519': '0'.repeat(128) },
    body: discordBody,
  })
  check('a tampered signature is refused', refused.status === 401, `${refused.status}`)
}

console.log('')

// The one-time handshake Meta does before it will deliver anything.
const subscribed = await fetch(
  `${PUBLIC_URL}/whatsapp?hub.mode=subscribe&hub.verify_token=${SECRETS.verifyToken}&hub.challenge=1234`,
)
check('meta subscribe handshake returns the challenge', (await subscribed.text()) === '1234')

const wrongToken = await fetch(
  `${PUBLIC_URL}/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234`,
)
check('meta subscribe with the wrong token is refused', !wrongToken.ok, `${wrongToken.status}`)

console.log(`\n${passed} passed, ${failed} failed`)

server.close()
process.exit(failed > 0 ? 1 : 0)
