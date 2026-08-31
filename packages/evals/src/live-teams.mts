/**
 * The live half of the Bot Framework verification.
 *
 * Teams is the only channel here where the reply does not go back on the
 * response. The bot posts it to a service URL, holding a bearer token that can
 * act as the bot, and that service URL arrives in the request body. Microsoft's
 * verification list has seven steps and the seventh exists for exactly that
 * reason: the address the token was issued for has to match the address in the
 * body, or the body chooses where the bot sends its own credentials.
 *
 *   npx tsx src/live-teams.mts --token   # the bot identity can authenticate
 *   npx tsx src/live-teams.mts --serve   # then point the bot resource here
 *
 * Web Chat and Direct Line reach this through the same Bot Connector Teams
 * uses, with the same signed tokens and the same reply flow, so everything the
 * adapter does is exercised. What they do not carry is Teams-specific activity
 * shapes, and that difference is worth saying out loud rather than calling the
 * channel done.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { teamsChannel } from '@recourse-ai/core/channels'
import { memoryStore } from '@recourse-ai/core/store'
import { models } from '@recourse-ai/core/models'

const env = process.env
const need = (name: string): string => {
  const value = env[name]
  if (!value) {
    console.error(`missing ${name}`)
    process.exit(1)
  }
  return value
}

const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--token'
const appId = need('TEAMS_APP_ID')
const appPassword = need('TEAMS_APP_PASSWORD')
const tenantId = env.TEAMS_TENANT_ID

if (mode === '--token') {
  // The outbound half on its own. A bot that cannot get this token cannot
  // reply at all, and the failure is silent: the webhook still answers 200.
  const tenant = tenantId ?? 'botframework.com'
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appPassword,
      scope: 'https://api.botframework.com/.default',
    }),
  })

  const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!body.access_token) {
    console.error(`no token: ${body.error_description}`)
    process.exit(1)
  }

  console.log(`bot ${appId} authenticated, token good for ${body.expires_in} seconds`)
  process.exit(0)
}

if (mode === '--serve') {
  const port = Number(env.PORT ?? 8799)

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

  const handle = teamsChannel({
    agent: createAgent({
      index,
      embedder: false,
      store,
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: (env.RECOURSE_TONE as 'plain') ?? 'warm' },
    }),
    appId,
    appPassword,
    ...(tenantId ? { tenantId } : {}),
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

    // The reply address is the interesting field, because it is the one the
    // sender chooses and the one the bot's token would be posted to.
    const where = /"serviceUrl"\s*:\s*"([^"]*)"/.exec(body.toString('utf8'))?.[1]
    const suffix = where ? ` [serviceUrl ${where}]` : ''

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
    console.log('\nThen set the bot resource messaging endpoint to <tunnel>/api/messages.')
    console.log('\nEvery inbound line prints the serviceUrl it asked the reply to go to.')
    console.log('Anything that is not an https Bot Connector host is refused before')
    console.log('the token is ever fetched, whatever the verification mode.')
  })
} else if (mode !== '--token') {
  console.error('usage: live-teams.mts [--token | --serve]')
  process.exit(1)
}
