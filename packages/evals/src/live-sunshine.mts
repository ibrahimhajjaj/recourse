/**
 * The live half of the Sunshine Conversations verification.
 *
 * Sunshine is Zendesk's messaging platform, and the reason it is worth wiring
 * is that one integration reaches WhatsApp, Messenger, Instagram, Telegram,
 * LINE, WeChat, Viber and SMS: Zendesk has done the per-platform work and
 * hands every one of them over in the same envelope.
 *
 *   cloudflared tunnel --url http://localhost:8791
 *   PUBLIC_URL=https://xyz.trycloudflare.com npx tsx src/live-sunshine.mts
 *
 * Credentials come from ~/.config/dev-credentials/sunshine.env. The webhook
 * secret is not one you can look up: Sunshine generates it when the webhook is
 * created and returns it exactly once, so this creates the integration, keeps
 * what came back, and writes it into that file for the next run.
 *
 * Sunshine signs nothing. The secret in `X-API-Key` is the entire security
 * model, which is Zendesk's design rather than a shortcut taken here.
 */

import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { sunshineChannel } from '@recourse-ai/core/channels'
import { memoryStore } from '@recourse-ai/core/store'
import { models } from '@recourse-ai/core/models'

const CREDENTIALS = join(homedir(), '.config/dev-credentials/sunshine.env')
const PORT = 8791
const API = 'https://api.smooch.io/v2'
const NAME = 'recourse live check'

function credentials(): Record<string, string> {
  const found: Record<string, string> = {}
  for (const line of readFileSync(CREDENTIALS, 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match) found[match[1] as string] = match[2] as string
  }
  return found
}

function remember(key: string, value: string): void {
  const text = readFileSync(CREDENTIALS, 'utf8')
  writeFileSync(
    CREDENTIALS,
    text.includes(`${key}=`)
      ? text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
      : `${text}${key}=${value}\n`,
    { mode: 0o600 },
  )
}

async function main(): Promise<void> {
  const env = { ...credentials(), ...process.env } as Record<string, string>
  const need = (name: string): string => {
    const value = env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value
  }

  const appId = need('SUNSHINE_APP_ID')
  const keyId = need('SUNSHINE_KEY_ID')
  const keySecret = need('SUNSHINE_KEY_SECRET')
  const publicUrl = need('PUBLIC_URL').replace(/\/+$/, '')
  const auth = `Basic ${btoa(`${keyId}:${keySecret}`)}`

  const api = async (path: string, init: RequestInit = {}): Promise<any> => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  }

  const target = `${publicUrl}/webhooks/sunshine`
  let webhookSecret = ''

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
  const handle = sunshineChannel({
    agent: createAgent({
      index,
      embedder: false,
      store,
      model: models.fromEnvironment(env),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters' },
    }),
    appId,
    keyId,
    keySecret,
    get webhookSecret() {
      return webhookSecret
    },
    onError: (error) => console.error('turn failed:', error),
  })

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(200).end('ok')
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)

    const answered = await handle(
      new Request(`http://localhost${request.url}`, {
        method: request.method,
        headers: request.headers as unknown as HeadersInit,
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      }),
    )

    response.writeHead(answered.status, { 'content-type': 'text/plain' })
    response.end(await answered.text())
  })

  await new Promise<void>((resolve) => server.listen(PORT, resolve))
  console.log(`  ok    listening on ${target}`)

  // A custom integration is what a webhook hangs off. Reused when one is
  // already pointing here, because Sunshine will happily hold several and then
  // deliver every message to all of them.
  const { integrations } = await api(`/apps/${appId}/integrations?types=custom`)
  const ours = (integrations ?? []).filter((one: any) => one.displayName === NAME)
  const existing = ours.find((one: any) => (one.webhooks ?? []).some((hook: any) => hook.target === target))

  webhookSecret = env.SUNSHINE_WEBHOOK_SECRET ?? ''

  if (existing && webhookSecret) {
    console.log(`  ok    reusing the integration already pointing here  ${existing.id}`)
  } else {
    // Every one this script has ever made, not just the one pointing at this
    // URL. A quick tunnel gets a new hostname each time, so matching on the
    // target alone leaves a dead integration behind on every run and Sunshine
    // delivers each message to all of them.
    for (const stale of ours) {
      await api(`/apps/${appId}/integrations/${stale.id}`, { method: 'DELETE' })
      console.log(`  ok    removed a previous run's integration  ${stale.id}`)
    }

    const created = await api(`/apps/${appId}/integrations`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'custom',
        displayName: NAME,
        webhooks: [{ target, triggers: ['conversation:message'] }],
      }),
    })

    webhookSecret = created.integration?.webhooks?.[0]?.secret
    if (!webhookSecret) throw new Error('Sunshine created the webhook but returned no secret')

    remember('SUNSHINE_WEBHOOK_SECRET', webhookSecret)
    console.log(`  ok    created the integration and kept its secret  ${created.integration.id}`)
  }


  // A customer, and a message from them. Sunshine delivers it to the webhook,
  // which is the whole point: nothing here posts to the adapter directly.
  const externalId = `live-${Date.now()}`
  const { user } = await api(`/apps/${appId}/users`, {
    method: 'POST',
    body: JSON.stringify({ externalId, profile: { givenName: 'Sam' } }),
  })

  const { conversation } = await api(`/apps/${appId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ type: 'personal', participants: [{ userId: user.id }] }),
  })

  await api(`/apps/${appId}/conversations/${conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      author: { type: 'user', userId: user.id },
      content: { type: 'text', text: 'How long is delivery to Ireland?' },
    }),
  })
  console.log('  ok    a customer message went in through Sunshine')

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const { messages } = await api(`/apps/${appId}/conversations/${conversation.id}/messages`)
    const reply = (messages ?? []).find((one: any) => one.author?.type === 'business')

    if (reply) {
      console.log('  ok    the answer came back out through Sunshine\n')
      console.log(`  ${String(reply.content?.text ?? '').trim().replace(/\n/g, '\n  ')}\n`)
      server.close()
      return
    }
  }

  server.close()
  throw new Error('no answer arrived within a minute')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
