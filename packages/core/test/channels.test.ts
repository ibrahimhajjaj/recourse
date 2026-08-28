import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import {
  emailChannel,
  instagramChannel,
  messengerChannel,
  parseCommonEmail,
  slackChannel,
  stripQuoted,
  twilioChannel,
  whatsappChannel,
} from '../src/channels/index.js'
import { signMeta, signSlack, signTwilio } from '../src/channels/verify.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { memoryStore } from '../src/store/index.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        { id: 'refunds', title: 'Refunds', text: '# Refunds\n\nWe refund any order within 30 days of delivery.' },
      ]),
    ],
  })
  return cached
}

function model(text = 'We refund within 30 days [1].') {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '0' },
          { type: 'text-delta' as const, id: '0', delta: text },
          { type: 'text-end' as const, id: '0' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop', raw: 'stop' } as const,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  })
}

/** Collects the background work so a test can await what the webhook started. */
function collector() {
  const pending: Promise<unknown>[] = []
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settled: () => Promise.all(pending) }
}

async function agentFor(store = memoryStore()) {
  return { agent: createAgent({ index: await index(), model: model(), store }), store }
}

describe('WhatsApp', () => {
  const appSecret = 'app-secret'
  const base = { appSecret, verifyToken: 'my-token', phoneNumberId: '123', accessToken: 'token' }

  const payload = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: '447700900000', profile: { name: 'Sam' } }],
              messages: [{ from: '447700900000', id: 'wamid.1', type: 'text', text: { body: 'do you do refunds?' } }],
            },
          },
        ],
      },
    ],
  })

  async function post(body: string, secret = appSecret) {
    return new Request('https://shop.example/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-hub-signature-256': await signMeta(body, secret), 'content-type': 'application/json' },
      body,
    })
  }

  it('completes the subscription handshake', async () => {
    const { agent } = await agentFor()
    const handle = whatsappChannel({ agent, ...base })
    const response = await handle(
      new Request('https://shop.example/w?hub.mode=subscribe&hub.verify_token=my-token&hub.challenge=42'),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('42')
  })

  it('refuses the handshake with the wrong token', async () => {
    const { agent } = await agentFor()
    const handle = whatsappChannel({ agent, ...base })
    const response = await handle(
      new Request('https://shop.example/w?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=42'),
    )
    expect(response.status).toBe(401)
  })

  it('rejects an unsigned webhook, which is anyone on the internet', async () => {
    const { agent } = await agentFor()
    const handle = whatsappChannel({ agent, ...base })
    const response = await handle(
      new Request('https://shop.example/w', { method: 'POST', body: payload }),
    )
    expect(response.status).toBe(401)
  })

  it('rejects a webhook signed with the wrong secret', async () => {
    const { agent } = await agentFor()
    const handle = whatsappChannel({ agent, ...base })
    expect((await handle(await post(payload, 'wrong-secret'))).status).toBe(401)
  })

  it('answers a genuine message and sends the reply back', async () => {
    const sent: Array<{ to: string; text: string }> = []
    const { agent, store } = await agentFor()
    const pending = collector()

    const handle = whatsappChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (to, text) => void sent.push({ to, text }),
    })

    const response = await handle(await post(payload))
    expect(response.status).toBe(200)

    await pending.settled()
    expect(sent).toEqual([{ to: '447700900000', text: 'We refund within 30 days [1].' }])

    // The transcript is filed under the phone number, on the whatsapp channel.
    const found = await store.getConversation('whatsapp:447700900000')
    expect(found?.conversation.channel).toBe('whatsapp')
    expect(found?.conversation.contact?.name).toBe('Sam')
  })

  it('ignores a photo, which has nothing to answer from', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = whatsappChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    const imageOnly = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: '44770', type: 'image', id: 'x' }] } }] }],
    })
    expect((await handle(await post(imageOnly))).status).toBe(200)
    await pending.settled()
    expect(sent).toEqual([])
  })

  it('still returns 200 for a payload it cannot parse, or Meta retries for a day', async () => {
    const { agent } = await agentFor()
    const handle = whatsappChannel({ agent, ...base })
    expect((await handle(await post('{not json'))).status).toBe(200)
  })
})

describe('Slack', () => {
  const signingSecret = 'signing-secret'
  const base = { signingSecret, botToken: 'xoxb-1' }

  async function post(body: string) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    return new Request('https://shop.example/webhooks/slack', {
      method: 'POST',
      headers: {
        'x-slack-signature': await signSlack(body, timestamp, signingSecret),
        'x-slack-request-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body,
    })
  }

  it('answers the url verification handshake', async () => {
    const { agent } = await agentFor()
    const handle = slackChannel({ agent, ...base })
    const response = await handle(await post(JSON.stringify({ type: 'url_verification', challenge: 'abc' })))
    expect(await response.json()).toEqual({ challenge: 'abc' })
  })

  it('rejects an unsigned request', async () => {
    const { agent } = await agentFor()
    const handle = slackChannel({ agent, ...base })
    const response = await handle(
      new Request('https://shop.example/s', { method: 'POST', body: '{}' }),
    )
    expect(response.status).toBe(401)
  })

  it('answers a mention in a thread', async () => {
    const sent: Array<{ channel: string; text: string; threadTs?: string }> = []
    const { agent } = await agentFor()
    const pending = collector()

    const handle = slackChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (channel, text, threadTs) => void sent.push({ channel, text, threadTs }),
    })

    await handle(
      await post(
        JSON.stringify({
          type: 'event_callback',
          event: { type: 'app_mention', text: '<@U123> do you do refunds?', user: 'U9', channel: 'C1', ts: '111.1' },
        }),
      ),
    )
    await pending.settled()

    expect(sent[0]?.channel).toBe('C1')
    expect(sent[0]?.threadTs).toBe('111.1')
  })

  it('never answers its own messages, which would loop forever', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = slackChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    await handle(
      await post(
        JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', text: 'hello', channel: 'C1', ts: '1', bot_id: 'B1' },
        }),
      ),
    )
    await pending.settled()
    expect(sent).toEqual([])
  })

  it('ignores plain channel chatter unless asked to listen to everything', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const quiet = slackChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    const chatter = JSON.stringify({
      type: 'event_callback',
      event: { type: 'message', text: 'lunch?', user: 'U9', channel: 'C1', ts: '1' },
    })

    await quiet(await post(chatter))
    await pending.settled()
    expect(sent).toEqual([])
  })

  it('strips the bot handle so the model does not read it as the question', async () => {
    const { agent, store } = await agentFor()
    const pending = collector()
    const handle = slackChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => {} })

    await handle(
      await post(
        JSON.stringify({
          type: 'event_callback',
          event: { type: 'app_mention', text: '<@U123> refunds please', user: 'U9', channel: 'C1', ts: '2' },
        }),
      ),
    )
    await pending.settled()

    const found = await store.getConversation('slack:C1:2')
    expect(found?.messages[0]?.content).toBe('refunds please')
  })
})

describe('SMS over Twilio', () => {
  const authToken = 'auth-token'
  const url = 'https://shop.example/webhooks/sms'
  const base = { authToken, from: '+15551112222', accountSid: 'AC1', publicUrl: url }

  async function post(params: Record<string, string>) {
    const body = new URLSearchParams(params).toString()
    return new Request(url, {
      method: 'POST',
      headers: {
        'x-twilio-signature': await signTwilio(url, params, authToken),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
  }

  it('rejects an unsigned request', async () => {
    const { agent } = await agentFor()
    const handle = twilioChannel({ agent, ...base })
    const response = await handle(new Request(url, { method: 'POST', body: 'From=%2B1&Body=hi' }))
    expect(response.status).toBe(401)
  })

  it('acknowledges with empty TwiML and answers out of band', async () => {
    const sent: Array<{ to: string; text: string }> = []
    const { agent } = await agentFor()
    const pending = collector()

    const handle = twilioChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (to, text) => void sent.push({ to, text }),
    })

    const response = await handle(await post({ From: '+15559998888', To: base.from, Body: 'refunds?' }))
    expect(response.headers.get('content-type')).toContain('text/xml')
    expect(await response.text()).toContain('<Response></Response>')

    await pending.settled()
    expect(sent[0]?.to).toBe('+15559998888')
  })
})

describe('email', () => {
  it('pulls the address out of a display-name From', () => {
    const email = parseCommonEmail({ From: 'Sam Fletcher <sam@example.com>', TextBody: 'hello', Subject: 'Hi' })
    expect(email?.from).toBe('sam@example.com')
    expect(email?.fromName).toBe('Sam Fletcher')
  })

  it('reads the field names different providers use', () => {
    expect(parseCommonEmail({ sender: 'a@b.co', 'body-plain': 'hi', subject: 'S' })?.from).toBe('a@b.co')
    expect(parseCommonEmail({ from: 'a@b.co', text: 'hi', subject: 'S' })?.text).toBe('hi')
  })

  it('returns null when there is nothing to answer', () => {
    expect(parseCommonEmail({ Subject: 'no body' })).toBeNull()
  })

  it('drops the quoted history below a reply', () => {
    const body = 'Any update?\n\nOn Tue, Sam wrote:\n> the original question\n> more of it'
    expect(stripQuoted(body)).toBe('Any update?')
  })

  it('answers and replies on the same thread', async () => {
    const sent: Array<{ to: string; subject: string; inReplyTo?: string }> = []
    const { agent, store } = await agentFor()
    const pending = collector()

    const handle = emailChannel({
      agent,
      waitUntil: pending.waitUntil,
      send: async (reply) => void sent.push(reply),
    })

    const response = await handle(
      new Request('https://shop.example/webhooks/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: 'Sam <sam@example.com>',
          Subject: 'Refund question',
          TextBody: 'Do you do refunds?',
          MessageID: '<abc@mail>',
        }),
      }),
    )

    expect(response.status).toBe(200)
    await pending.settled()

    expect(sent[0]?.to).toBe('sam@example.com')
    expect(sent[0]?.subject).toBe('Re: Refund question')
    expect(sent[0]?.inReplyTo).toBe('<abc@mail>')
    expect((await store.getConversation('email:sam@example.com'))?.conversation.channel).toBe('email')
  })

  it('does not add a second Re: to a reply', async () => {
    const sent: Array<{ subject: string }> = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = emailChannel({ agent, waitUntil: pending.waitUntil, send: async (r) => void sent.push(r) })

    await handle(
      new Request('https://shop.example/e', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ From: 'a@b.co', Subject: 'Re: Refund question', TextBody: 'still waiting' }),
      }),
    )
    await pending.settled()
    expect(sent[0]?.subject).toBe('Re: Refund question')
  })

  it('refuses a request without the shared secret', async () => {
    const { agent } = await agentFor()
    const handle = emailChannel({
      agent,
      secret: { header: 'x-webhook-secret', value: 'shh' },
      send: async () => {},
    })

    const response = await handle(
      new Request('https://shop.example/e', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ From: 'a@b.co', TextBody: 'hi', Subject: 'S' }),
      }),
    )
    expect(response.status).toBe(401)
  })
})

describe('a channel whose delivery fails', () => {
  it('reports it rather than crashing the worker', async () => {
    const errors: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handle = emailChannel({
      agent,
      waitUntil: pending.waitUntil,
      onError: (error) => void errors.push(error),
      send: async () => {
        throw new Error('smtp is down')
      },
    })

    const response = await handle(
      new Request('https://shop.example/e', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ From: 'a@b.co', TextBody: 'hi there', Subject: 'S' }),
      }),
    )

    expect(response.status).toBe(200)
    await pending.settled()
    expect((errors[0] as Error).message).toBe('smtp is down')
    spy.mockRestore()
  })
})

describe('Messenger and Instagram', () => {
  const appSecret = 'app-secret'
  const base = { appSecret, verifyToken: 'tok', accessToken: 'page-token' }

  const payload = JSON.stringify({
    entry: [{ messaging: [{ sender: { id: 'PSID-1' }, message: { mid: 'm1', text: 'do you do refunds?' } }] }],
  })

  async function post(body: string) {
    return new Request('https://shop.example/webhooks/messenger', {
      method: 'POST',
      headers: { 'x-hub-signature-256': await signMeta(body, appSecret), 'content-type': 'application/json' },
      body,
    })
  }

  it('answers a Messenger message and files it under messenger', async () => {
    const sent: Array<{ to: string; text: string }> = []
    const { agent, store } = await agentFor()
    const pending = collector()

    const handle = messengerChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (to, text) => void sent.push({ to, text }),
    })

    expect((await handle(await post(payload))).status).toBe(200)
    await pending.settled()

    expect(sent[0]?.to).toBe('PSID-1')
    expect((await store.getConversation('messenger:PSID-1'))?.conversation.channel).toBe('messenger')
  })

  it('files an Instagram message under instagram, from the same payload shape', async () => {
    const { agent, store } = await agentFor()
    const pending = collector()
    const handle = instagramChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => {} })

    await handle(await post(payload))
    await pending.settled()

    expect((await store.getConversation('instagram:PSID-1'))?.conversation.channel).toBe('instagram')
  })

  it('ignores the page’s own echoed message, which would loop', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = messengerChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    const echo = JSON.stringify({
      entry: [{ messaging: [{ sender: { id: 'PAGE' }, message: { text: 'our reply', is_echo: true } }] }],
    })
    await handle(await post(echo))
    await pending.settled()
    expect(sent).toEqual([])
  })

  it('rejects an unsigned webhook', async () => {
    const { agent } = await agentFor()
    const handle = messengerChannel({ agent, ...base })
    expect((await handle(new Request('https://shop.example/m', { method: 'POST', body: payload }))).status).toBe(401)
  })
})
