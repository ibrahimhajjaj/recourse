/**
 * The live half of the Discord verification.
 *
 * Free and quick, with one step the other channels do not have: a slash
 * command has to be registered with Discord before anybody can type it, and
 * until it is, the bot appears to do nothing at all.
 *
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... npx tsx src/live-discord.mts --register
 *
 *   DISCORD_APP_ID=... DISCORD_PUBLIC_KEY=... npx tsx src/live-discord.mts --serve
 *
 * Discord verifies differently from everyone else here. Meta signs the payload
 * with a shared secret, Twilio signs the URL, Telegram signs nothing; Discord
 * signs with Ed25519, and you hold only the public key. Nothing you have can
 * forge a request, which is the nicest of the four to be on the receiving end
 * of, and the only one where a leaked key is not a breach.
 *
 * Discord also refuses to save an interactions URL until it has sent an
 * unsigned PING and watched it be rejected, so the endpoint has to be up and
 * verifying before the portal will accept it.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { discordChannel } from '@recourse-ai/core/channels'
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

const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--serve'
const COMMAND = env.DISCORD_COMMAND ?? 'ask'

if (mode === '--register') {
  const applicationId = need('DISCORD_APP_ID')

  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${need('DISCORD_BOT_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: COMMAND,
      description: 'Ask a question and get an answer from the help pages',
      // Type 3 is a string option. The adapter reads the first one by value
      // rather than by name, so the name here is only what users see.
      options: [{ type: 3, name: 'question', description: 'What do you want to know?', required: true }],
    }),
  })

  const body = (await response.json()) as { name?: string; id?: string; message?: string }

  if (!response.ok) {
    console.error(`could not register /${COMMAND}: ${body.message ?? response.status}`)
    process.exit(1)
  }

  console.log(`registered /${body.name} (${body.id})`)
  // Global commands are cached by Discord's clients. Per-guild registration is
  // instant, which is worth knowing before spending an hour on a working bot
  // that appears not to exist.
  console.log('Global commands can take up to an hour to appear. Register per guild for an instant one.')
  process.exit(0)
}

if (mode === '--serve') {
  const port = Number(env.PORT ?? 8794)

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

  const handle = discordChannel({
    agent: createAgent({
      index,
      embedder: false,
      store,
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: (env.RECOURSE_TONE as 'plain') ?? 'warm' },
    }),
    publicKey: need('DISCORD_PUBLIC_KEY'),
    applicationId: need('DISCORD_APP_ID'),
    ...(env.DISCORD_BOT_TOKEN ? { botToken: env.DISCORD_BOT_TOKEN } : {}),
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
    console.log('\nThen in the Discord developer portal, General Information:')
    console.log('  Interactions Endpoint URL: <the tunnel url>')
    console.log('\nSaving it sends an unsigned PING and expects a 401, so this has to be')
    console.log(`running first. Then register the command and type /${COMMAND} in a server.`)
  })
} else if (mode !== '--register') {
  console.error('usage: live-discord.mts [--register | --serve]')
  process.exit(1)
}
