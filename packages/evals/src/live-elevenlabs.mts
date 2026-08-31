/**
 * The live half of the ElevenLabs voice verification.
 *
 * The only way to prove the voice path without a phone number, a carrier or a
 * Twilio account. ElevenLabs Agents own the call; this exposes the library as
 * the webhook tool their agent calls mid-conversation, so what gets verified
 * is the seam between them.
 *
 *   npx tsx src/live-elevenlabs.mts --check    # locally, spends nothing
 *   npx tsx src/live-elevenlabs.mts --serve    # then point their agent at it
 *
 * `--check` drives the endpoint with every request shape their tool builder
 * can produce, because picking the wrong one is a silent failure: the agent
 * simply starts saying it does not know, and nothing anywhere reports an
 * error. Run it before configuring anything on their side.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { elevenLabsSystemPrompt, elevenLabsToolRoute } from '@recourse-ai/core/channels'
import { memoryStore } from '@recourse-ai/core/store'
import { models } from '@recourse-ai/core/models'

const env = process.env
const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--check'
const port = Number(env.PORT ?? 8797)
const token = env.ELEVENLABS_TOOL_TOKEN ?? 'recourse-dev-tool-token'

const index = await buildIndex({
  sources: [
    textSource([
      {
        id: 'shipping',
        title: 'Shipping',
        url: 'https://shop.example/shipping',
        text: '# Shipping\n\nUnited Kingdom orders arrive in 1-2 working days. Ireland and the EU take 3-5. Delivery is free over 30 pounds.',
      },
      {
        id: 'refunds',
        title: 'Refunds',
        url: 'https://shop.example/refunds',
        text: '# Refunds\n\nWe refund any order within 30 days of delivery. Refunds reach the card in 5 working days.',
      },
    ]),
  ],
})

const handle = elevenLabsToolRoute({
  agent: createAgent({
    index,
    embedder: false,
    store: memoryStore(),
    model: models.fromEnvironment(env as Record<string, string | undefined>),
    persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: (env.RECOURSE_TONE as 'plain') ?? 'warm' },
  }),
  token,
})

if (mode === '--check') {
  // Every shape their tool builder can send, plus the two that must be
  // refused. Driven against the route directly, so this costs nothing and
  // needs no tunnel.
  const at = `http://localhost:${port}/`
  const authorised = { Authorization: `Bearer ${token}` }

  const cases: Array<{ what: string; request: Request; expect: (body: any, status: number) => boolean }> = [
    {
      what: 'GET with question=, the default their builder produces',
      request: new Request(`${at}?question=${encodeURIComponent('do you ship to Ireland?')}`, { headers: authorised }),
      expect: (body, status) => status === 200 && body.found === true && /3-5|three to five/i.test(body.answer),
    },
    {
      what: 'GET with query=, which their builder also produces',
      request: new Request(`${at}?query=${encodeURIComponent('how long do refunds take?')}`, { headers: authorised }),
      expect: (body, status) => status === 200 && body.found === true && /5|five/i.test(body.answer),
    },
    {
      what: 'POST with a JSON body',
      request: new Request(at, {
        method: 'POST',
        headers: { ...authorised, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'do you ship to the UK?', conversation_id: 'conv-1', caller: '+15551234567' }),
      }),
      expect: (body, status) => status === 200 && body.found === true && /1-2|one to two/i.test(body.answer),
    },
    {
      what: 'the answer is spoken, so no citation markers survive',
      request: new Request(`${at}?question=${encodeURIComponent('do you ship to Ireland?')}`, { headers: authorised }),
      expect: (body) => !/\[\d+\]/.test(body.answer) && Array.isArray(body.sources) && body.sources.length > 0,
    },
    {
      what: 'a question the documentation does not answer reports found: false',
      request: new Request(`${at}?question=${encodeURIComponent('what is the chief executive paid?')}`, { headers: authorised }),
      expect: (body, status) => status === 200 && body.found === false,
    },
    {
      what: 'no token is refused',
      request: new Request(`${at}?question=hello`),
      expect: (_body, status) => status === 401,
    },
    {
      what: 'the wrong token is refused',
      request: new Request(`${at}?question=hello`, { headers: { Authorization: 'Bearer not-the-token' } }),
      expect: (_body, status) => status === 401,
    },
    {
      what: 'an empty question is a 400 rather than a shrug',
      request: new Request(at, { headers: authorised }),
      expect: (_body, status) => status === 400,
    },
  ]

  let failed = 0

  for (const item of cases) {
    const response = await handle(item.request)
    const body = await response.json().catch(() => ({}))
    const ok = item.expect(body, response.status)
    if (!ok) failed += 1

    console.log(`${ok ? 'ok  ' : 'FAIL'} ${item.what}`)
    if (!ok || process.argv.includes('--verbose')) {
      console.log(`     ${response.status} ${JSON.stringify(body).slice(0, 200)}`)
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  if (failed > 0) process.exit(1)

  console.log('\nThe endpoint holds. Next, and only now, is worth paying for:')
  console.log(`  npx tsx src/live-elevenlabs.mts --serve`)
  console.log(`  cloudflared tunnel --url http://localhost:${port}`)
  console.log('\nThen in the ElevenLabs agent, add a webhook tool:')
  console.log('  name:   search_help')
  console.log('  method: GET')
  console.log('  url:    <the tunnel url>?question={{question}}')
  console.log(`  header: Authorization: Bearer ${token}`)
  console.log('\nAnd its system prompt, which is generated rather than written by hand')
  console.log('because an agent not fenced to the tool answers from its own model')
  console.log('knowledge, fluently and wrongly:\n')
  console.log(elevenLabsSystemPrompt({ business: 'Lumen Coffee Roasters', toolName: 'search_help' }))
  process.exit(0)
}

if (mode === '--serve') {
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

    console.log(`${incoming.method} ${incoming.url} -> ${response.status} ${text.slice(0, 160)}`)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    outgoing.writeHead(response.status, headers).end(text)
  }).listen(port, () => {
    console.log(`listening on ${port}`)
    console.log(`tool token: ${token}\n`)
    console.log('Every call their agent makes prints here, which is the only way to')
    console.log('tell a tool that was never called from one that answered badly.')
  })
} else if (mode !== '--check') {
  console.error('usage: live-elevenlabs.mts [--check | --serve]')
  process.exit(1)
}
