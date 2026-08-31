/**
 * The live half of the Telegram verification.
 *
 * Cheaper to get than any other channel here: message @BotFather, send
 * /newbot, and the token is yours in under a minute. No account to create, no
 * business to verify, no card, no review.
 *
 *   TELEGRAM_BOT_TOKEN=... npx tsx src/live-telegram.mts --whoami
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_SECRET=... \
 *     PUBLIC_URL=https://xyz.trycloudflare.com npx tsx src/live-telegram.mts --hook
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_SECRET=... npx tsx src/live-telegram.mts --serve
 *
 * Unlike Meta, Telegram signs nothing. The whole security model is a secret
 * you invent, pass to setWebhook, and check on every update, which is why
 * `--serve` refuses to start without one.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from 'recourse'
import { telegramChannel } from 'recourse/channels'
import { memoryStore } from 'recourse/store'
import { models } from 'recourse/models'

const env = process.env
const need = (name: string): string => {
  const value = env[name]
  if (!value) {
    console.error(`missing ${name}. See examples/nextjs/.env.example for what each one is.`)
    process.exit(1)
  }
  return value
}

const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--whoami'
const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`

if (mode === '--whoami') {
  const token = need('TELEGRAM_BOT_TOKEN')
  const me = (await (await fetch(api(token, 'getMe'))).json()) as {
    ok?: boolean
    result?: { id?: number; username?: string; first_name?: string }
    description?: string
  }

  if (!me.ok) {
    console.error(`getMe failed: ${me.description ?? 'unknown'}`)
    process.exit(1)
  }

  console.log(`bot @${me.result?.username} (${me.result?.first_name}), id ${me.result?.id}`)

  const hook = (await (await fetch(api(token, 'getWebhookInfo'))).json()) as {
    result?: { url?: string; pending_update_count?: number; last_error_message?: string }
  }

  console.log(`webhook: ${hook.result?.url || 'none set'}`)
  if (hook.result?.pending_update_count) {
    console.log(`  ${hook.result.pending_update_count} update(s) queued`)
  }
  // Telegram keeps delivering to a dead URL and remembers why it failed, which
  // is the fastest way to find out the tunnel died an hour ago.
  if (hook.result?.last_error_message) {
    console.log(`  last error: ${hook.result.last_error_message}`)
  }

  process.exit(0)
}

if (mode === '--hook') {
  const token = need('TELEGRAM_BOT_TOKEN')
  const url = need('PUBLIC_URL')

  const response = (await (
    await fetch(api(token, 'setWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: need('TELEGRAM_SECRET'),
        allowed_updates: ['message'],
        // Anything queued while the last tunnel was down is addressed to a URL
        // that no longer exists, and replaying it looks like the bot answering
        // messages at random.
        drop_pending_updates: true,
      }),
    })
  ).json()) as { ok?: boolean; description?: string }

  console.log(response.ok ? `webhook set to ${url}` : `setWebhook failed: ${response.description}`)
  process.exit(response.ok ? 0 : 1)
}

if (mode === '--serve') {
  const port = Number(env.PORT ?? 8793)

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
  // gets printed is what the library actually recorded. The reply is written
  // after the response has gone back to Telegram, which is why this polls.
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

  const handle = telegramChannel({
    agent: createAgent({
      index,
      embedder: false,
      store,
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters' },
    }),
    botToken: need('TELEGRAM_BOT_TOKEN'),
    secretToken: need('TELEGRAM_SECRET'),
    onError: (error) => console.error('turn failed:', error),
  })

  createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)

    const request = new Request(new URL(incoming.url ?? '/', `http://localhost:${port}`), {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      ...(body.length > 0 ? { body } : {}),
    })

    const response = await handle(request)
    const text = await response.text()

    console.log(`${incoming.method} ${incoming.url} -> ${response.status}${text ? ` ${text.slice(0, 60)}` : ''}`)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    outgoing.writeHead(response.status, headers).end(text)
  }).listen(port, () => {
    console.log(`listening on ${port}\n`)
    console.log('Now, in another terminal:')
    console.log(`  cloudflared tunnel --url http://localhost:${port}`)
    console.log('\nThen point Telegram at it:')
    console.log(`  PUBLIC_URL=<the tunnel url> npx tsx src/live-telegram.mts --hook`)
    console.log('\nThen message the bot. Telegram signs nothing, so the secret token is')
    console.log('the only thing separating your bot from anyone who guesses the URL.')
  })
} else if (mode !== '--whoami' && mode !== '--hook') {
  console.error('usage: live-telegram.mts [--whoami | --hook | --serve]')
  process.exit(1)
}
