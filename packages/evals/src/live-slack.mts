/**
 * The live half of the Slack verification.
 *
 * Free, and the only channel here whose signature covers a timestamp as well
 * as the body. That makes it the only one where replaying a captured request
 * is a real attack with a real defence: Slack signs `v0:{timestamp}:{body}`
 * and expects you to refuse anything older than five minutes. The offline
 * harness already drives that path; this proves it against Slack itself.
 *
 *   SLACK_BOT_TOKEN=... npx tsx src/live-slack.mts --whoami
 *   SLACK_SIGNING_SECRET=... SLACK_BOT_TOKEN=... npx tsx src/live-slack.mts --serve
 *
 * Slack is also the one that will punish a slow answer. It gives three seconds
 * before it calls the delivery failed and retries, and a retry means the
 * customer gets the same reply twice. The adapter acknowledges first and
 * answers afterwards for exactly that reason.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { slackChannel } from '@recourse-ai/core/channels'
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

const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--whoami'

if (mode === '--whoami') {
  const token = need('SLACK_BOT_TOKEN')

  const me = (await (
    await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { ok?: boolean; error?: string; team?: string; user?: string; user_id?: string }

  if (!me.ok) {
    // Slack returns HTTP 200 with ok:false, so a naive check sees success.
    console.error(`auth.test failed: ${me.error}`)
    process.exit(1)
  }

  console.log(`bot ${me.user} (${me.user_id}) in workspace ${me.team}`)
  process.exit(0)
}

if (mode === '--serve') {
  const port = Number(env.PORT ?? 8796)

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

  const handle = slackChannel({
    agent: createAgent({
      index,
      embedder: false,
      store,
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: (env.RECOURSE_TONE as 'plain') ?? 'warm' },
    }),
    signingSecret: need('SLACK_SIGNING_SECRET'),
    botToken: need('SLACK_BOT_TOKEN'),
    ...(env.SLACK_ALL_MESSAGES === 'true' ? { respondToAllMessages: true } : {}),
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

    // Slack's retry header is worth seeing. If it ever appears, the endpoint
    // was too slow to acknowledge and the customer is about to be answered
    // twice.
    const retry = incoming.headers['x-slack-retry-num']
    const suffix = retry ? ` [slack retry ${retry}: ${incoming.headers['x-slack-retry-reason']}]` : ''

    console.log(`${incoming.method} ${incoming.url} -> ${response.status}${suffix}${text ? ` ${text.slice(0, 60)}` : ''}`)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    outgoing.writeHead(response.status, headers).end(text)
  }).listen(port, () => {
    console.log(`listening on ${port}\n`)
    console.log('Now, in another terminal:')
    console.log(`  cloudflared tunnel --url http://localhost:${port}`)
    console.log('\nThen at api.slack.com/apps, in your app:')
    console.log('  Event Subscriptions > Request URL: <the tunnel url>')
    console.log('  Subscribe to bot events: app_mention (and message.im for direct messages)')
    console.log('  OAuth & Permissions > Scopes: app_mentions:read, chat:write, im:history')
    console.log('\nSlack verifies the URL by posting a url_verification challenge, which this')
    console.log('answers. It signs v0:{timestamp}:{body}, so a replayed request older than')
    console.log('five minutes is refused even though its signature is perfectly valid.')
  })
} else if (mode !== '--whoami') {
  console.error('usage: live-slack.mts [--whoami | --serve]')
  process.exit(1)
}
