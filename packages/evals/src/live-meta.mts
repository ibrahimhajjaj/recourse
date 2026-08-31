/**
 * The live half of the Messenger and Instagram verification.
 *
 * One server for both, because they are one product wearing two logos: the
 * same app secret, the same HMAC over the raw body, the same verify handshake,
 * and the same `/me/messages` send. What differs is the page token and which
 * `object` Meta puts in the envelope.
 *
 * So the callback URL is the same URL, and the routing is by object:
 *
 *   { "object": "page", ... }      -> Messenger
 *   { "object": "instagram", ... } -> Instagram
 *
 *   MESSENGER_PAGE_TOKEN=... npx tsx src/live-meta.mts --serve
 *
 * Both need a Facebook Page. Instagram additionally needs a professional
 * account linked to that page, which is a setting on the Instagram side rather
 * than anything in the developer portal.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { instagramChannel, messengerChannel } from '@recourse-ai/core/channels'
import { memoryStore } from '@recourse-ai/core/store'
import { models } from '@recourse-ai/core/models'

const env = process.env
const need = (name: string): string => {
  const value = env[name]
  if (!value) {
    console.error(`missing ${name}. See examples/nextjs/.env.example for what each one is.`)
    process.exit(1)
  }
  return value
}

const port = Number(env.PORT ?? 8795)

const index = await buildIndex({
  sources: [
    textSource([
      {
        id: 'shipping',
        title: 'Shipping',
        url: 'https://shop.example/shipping',
        text: '# Shipping\n\nUnited Kingdom orders arrive in 1-2 working days. Ireland and the EU take 3-5. Delivery is free over 30 pounds.',
      },
    ]),
  ],
})

// Read back out of the store rather than logged on the way through, so what
// gets printed is what the library actually recorded.
const store = memoryStore()
const seen = new Set<string>()

setInterval(async () => {
  const { items } = await store.listConversations({ limit: 20 })

  for (const conversation of items) {
    const thread = await store.getConversation(conversation.id)
    for (const message of thread?.messages ?? []) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      console.log(`  ${message.role === 'user' ? '<-' : '->'} ${message.content.replace(/\s+/g, ' ').slice(0, 300)}`)
    }
  }
}, 2000).unref()

function agent() {
  return createAgent({
    index,
    embedder: false,
    store,
    model: models.fromEnvironment(env as Record<string, string | undefined>),
    persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: (env.RECOURSE_TONE as 'plain') ?? 'warm' },
  })
}

const shared = {
  appSecret: need('META_APP_SECRET'),
  verifyToken: need('META_VERIFY_TOKEN'),
  onError: (error: unknown) => console.error('turn failed:', error),
}

const messenger = messengerChannel({
  ...shared,
  agent: agent(),
  accessToken: need('MESSENGER_PAGE_TOKEN'),
})

const instagram = instagramChannel({
  ...shared,
  agent: agent(),
  // Instagram replies through the page it is linked to, so the page token is
  // the token unless a separate one has been issued.
  accessToken: env.INSTAGRAM_TOKEN ?? need('MESSENGER_PAGE_TOKEN'),
})

createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = []
  for await (const chunk of incoming) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)

  // Which adapter gets it is decided by the envelope, not by the path, so one
  // callback URL can be pasted into both dashboards. The body is read as text
  // rather than parsed here: the signature covers the raw bytes, and parsing
  // before verifying is how you end up checking a signature over something the
  // sender never sent.
  const object = body.length > 0 ? /"object"\s*:\s*"([a-z_]+)"/.exec(body.toString('utf8'))?.[1] : undefined
  const handle = object === 'instagram' ? instagram : messenger

  const request = new Request(new URL(incoming.url ?? '/', `http://localhost:${port}`), {
    method: incoming.method,
    headers: incoming.headers as Record<string, string>,
    ...(body.length > 0 ? { body } : {}),
  })

  const response = await handle(request)
  const text = await response.text()

  const which = object ? ` [${object}]` : ''
  console.log(`${incoming.method} ${incoming.url}${which} -> ${response.status}${text ? ` ${text.slice(0, 60)}` : ''}`)

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  outgoing.writeHead(response.status, headers).end(text)
}).listen(port, () => {
  console.log(`listening on ${port}\n`)
  console.log('Now, in another terminal:')
  console.log(`  cloudflared tunnel --url http://localhost:${port}`)
  console.log('\nThen in the app dashboard, under Messenger API Settings and again')
  console.log('under Instagram settings, paste the same tunnel URL as the callback and')
  console.log(`  verify token: ${env.META_VERIFY_TOKEN}`)
  console.log('  subscribe to: messages')
  console.log('\nMeta signs the payload rather than the URL, so a tunnel subdomain that')
  console.log('changes between runs is fine. You do have to redo the verify step.')
})
