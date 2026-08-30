import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import {
  discordChannel,
  emailChannel,
  instagramChannel,
  messengerChannel,
  parseCommonEmail,
  slackChannel,
  stripQuoted,
  teamsChannel,
  telegramChannel,
  twilioChannel,
  whatsappChannel,
  defaultDisclosure,
} from '../src/channels/index.js'
import { split } from '../src/channels/sms.js'
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

// EU AI Act Article 50(5) wants the disclosure at or before the first
// interaction, and the exception for cases where it is obvious does not cover a
// support assistant. Answering honestly when asked is a different obligation
// and does not satisfy this one.
//
// A messaging channel has no interface to put it in, so it has to be a message.
describe('telling somebody they are talking to software', () => {
  const base = { botToken: 'bot-token', secretToken: 'secret' }
  const update = {
    message: {
      message_id: 1,
      text: 'do you do refunds?',
      chat: { id: 42, type: 'private' },
      from: { id: 42, first_name: 'Sam', is_bot: false },
    },
  }

  function post(body: unknown, secret = 'secret'): Request {
    return new Request('https://api.example/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify(body),
    })
  }

  /**
   * Answering happens after the webhook has been acknowledged, so a test that
   * sleeps is a test that fails on a loaded machine. `waitUntil` is the seam
   * the serverless platforms use for the same reason, and it hands back the
   * promise this needs.
   */
  function collector() {
    const pending: Array<Promise<unknown>> = []
    return {
      waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
      settle: () => Promise.all(pending),
    }
  }

  it('says it once, before the first answer, and not again', async () => {
    const { agent } = await agentFor()
    const sent: string[] = []

    const background = collector()
    const handle = telegramChannel({
      ...base,
      agent,
      disclosure: defaultDisclosure,
      waitUntil: background.waitUntil,
      send: async (_chatId, text) => {
        sent.push(text)
      },
    })

    await handle(post(update))
    await background.settle()
    await handle(post(update))
    await background.settle()

    expect(sent.filter((text) => text === defaultDisclosure)).toHaveLength(1)
    // First out, so nobody reads an answer before knowing what wrote it.
    expect(sent[0]).toBe(defaultDisclosure)
  })

  it('says nothing when no disclosure is configured', async () => {
    const { agent } = await agentFor()
    const sent: string[] = []

    const background = collector()
    const handle = telegramChannel({
      ...base,
      agent,
      waitUntil: background.waitUntil,
      send: async (_chatId, text) => {
        sent.push(text)
      },
    })

    await handle(post(update))
    await background.settle()

    expect(sent).not.toContain(defaultDisclosure)
  })

  // Without a transcript there is no way to know it has been said. Saying it
  // twice is mildly annoying; never saying it is the thing the law is about.
  it('repeats it rather than risk skipping it when there is no store', async () => {
    const agent = createAgent({ index: await index(), model: model() })
    const sent: string[] = []

    const background = collector()
    const handle = telegramChannel({
      ...base,
      agent,
      disclosure: defaultDisclosure,
      waitUntil: background.waitUntil,
      send: async (_chatId, text) => {
        sent.push(text)
      },
    })

    await handle(post(update))
    await background.settle()
    await handle(post(update))
    await background.settle()

    expect(sent.filter((text) => text === defaultDisclosure)).toHaveLength(2)
  })
})

// Live on Discord: "Delivery to Ireland takes 3-5 working days. [1]" and no
// way to find out what [1] was. The prompt asks for the marker, the widget
// renders the list beside the text, and a messaging channel was handed the
// string on its own with the list thrown away.
describe('the [1] in a message', () => {
  const base = { botToken: 'bot-token', secretToken: 'secret' }
  const update = {
    message: {
      message_id: 1,
      text: 'do you do refunds?',
      chat: { id: 77, type: 'private' },
      from: { id: 77, first_name: 'Sam', is_bot: false },
    },
  }

  function post(body: unknown): Request {
    return new Request('https://api.example/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify(body),
    })
  }

  async function answered(citations?: 'list' | 'none') {
    const pending: Array<Promise<unknown>> = []
    const sent: string[] = []
    const handle = telegramChannel({
      ...base,
      agent: createAgent({
        index: await index(),
        model: model('You have 30 days to request a refund [1].'),
        store: memoryStore(),
      }),
      ...(citations ? { citations } : {}),
      waitUntil: (promise) => void pending.push(promise),
      send: async (_chatId, text) => {
        sent.push(text)
      },
    })

    await handle(post(update))
    await Promise.all(pending)
    return sent.join('\n')
  }

  it('names what the marker points at', async () => {
    const reply = await answered()

    expect(reply).toContain('[1]')
    expect(reply).toContain('Refunds')
  })

  it('says nothing extra when the answer cited nothing', async () => {
    const pending: Array<Promise<unknown>> = []
    const sent: string[] = []
    const handle = telegramChannel({
      ...base,
      agent: createAgent({
        index: await index(),
        model: model('Hello! How can I help?'),
        store: memoryStore(),
      }),
      waitUntil: (promise) => void pending.push(promise),
      send: async (_chatId, text) => {
        sent.push(text)
      },
    })

    await handle(post(update))
    await Promise.all(pending)

    expect(sent.join('\n')).toBe('Hello! How can I help?')
  })

  it('can be turned off for a channel where the links are noise', async () => {
    expect(await answered('none')).not.toContain('Refunds')
  })
})

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
    // The source list rides along, because a [1] with nothing behind it is a
    // footnote marker with no footnote. The text source here has no URL, so
    // its title is what there is to give.
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('447700900000')
    expect(sent[0]?.text).toContain('We refund within 30 days [1].')
    expect(sent[0]?.text).toContain('[1] Refunds')

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

  it('answers a direct message without being told to listen to everything', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const quiet = slackChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    // Same event type as the channel chatter above. What separates them is
    // channel_type, and a person in a private conversation with the bot has
    // already made it as clear as it gets who they are talking to.
    await quiet(
      await post(
        JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', channel_type: 'im', text: 'do you ship to Ireland?', user: 'U9', channel: 'D1', ts: '1' },
        }),
      ),
    )
    await pending.settled()
    expect(sent).toEqual([1])
  })

  it('keeps a whole direct message exchange as one conversation', async () => {
    const { agent, store } = await agentFor()
    const pending = collector()
    const handle = slackChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => {} })

    const dm = (ts: string, text: string) =>
      JSON.stringify({
        type: 'event_callback',
        event: { type: 'message', channel_type: 'im', text, user: 'U9', channel: 'D1', ts },
      })

    // Two messages typed one after the other. Each carries its own ts, so
    // keying on it would have made the second question a stranger.
    await handle(await post(dm('1', 'do you ship to Ireland?')))
    await pending.settled()
    await handle(await post(dm('2', 'and how long does it take?')))
    await pending.settled()

    const found = await store.getConversation('slack:D1')
    expect(found?.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
      'do you ship to Ireland?',
      'and how long does it take?',
    ])
  })

  it('answers in the direct message itself, not folded into a thread', async () => {
    const sent: Array<string | undefined> = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = slackChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (_channel, _text, threadTs) => void sent.push(threadTs),
    })

    await handle(
      await post(
        JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', channel_type: 'im', text: 'hello?', user: 'U9', channel: 'D1', ts: '1' },
        }),
      ),
    )
    await pending.settled()
    expect(sent).toEqual([undefined])
  })

  it('still answers inside a thread when the question was asked in one', async () => {
    const sent: Array<string | undefined> = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = slackChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (_channel, _text, threadTs) => void sent.push(threadTs),
    })

    await handle(
      await post(
        JSON.stringify({
          type: 'event_callback',
          event: { type: 'message', channel_type: 'im', text: 'following up', user: 'U9', channel: 'D1', ts: '2', thread_ts: '1' },
        }),
      ),
    )
    await pending.settled()
    expect(sent).toEqual(['1'])
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

describe('what Twilio says when a send fails', () => {
  async function sendFailing(code: number, message: string) {
    const { agent } = await agentFor()
    const pending = collector()
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code, message }), { status: 400 }),
    )

    const handle = twilioChannel({
      agent,
      authToken: 'auth-token',
      from: '+15551112222',
      accountSid: 'AC1',
      publicUrl: 'https://shop.example/webhooks/sms',
      waitUntil: pending.waitUntil,
      onError: (error) => void errors.push(error),
    })

    const body = new URLSearchParams({ From: '+15559998888', Body: 'do you do refunds?' }).toString()
    await handle(
      new Request('https://shop.example/webhooks/sms', {
        method: 'POST',
        headers: {
          'x-twilio-signature': await signTwilio('https://shop.example/webhooks/sms', { From: '+15559998888', Body: 'do you do refunds?' }, 'auth-token'),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      }),
    )
    await pending.settled()

    fetchSpy.mockRestore()
    spy.mockRestore()
    return String((errors[0] as Error)?.message ?? '')
  }

  // The one that reads as a bug and is not. Retrying an opt-out is wrong, and
  // in several countries unlawful, so the message has to say so rather than
  // leave a number in a log.
  it('says a STOP is an opt-out, not a failure to retry', async () => {
    const said = await sendFailing(21610, 'The message From/To pair violates a blacklist rule.')
    expect(said).toContain('texted STOP')
    expect(said).toContain('Do not retry')
    expect(said).toContain('START')
  })

  // What a trial account really returns, taken from a live send rather than
  // from the error list, which describes a different code for this case and
  // does not mention this one at all.
  it('explains the trial error Twilio actually sends', async () => {
    const said = await sendFailing(
      572002,
      "No Twilio trial phone number is assigned for messaging to this destination number. Please add the 'to' number as a verified recipient.",
    )
    expect(said).toContain('verified recipients')
    expect(said).toContain('needs a trial phone number of its own')
    // Twilio's message ends in a full stop and ours continues the sentence.
    expect(said).not.toContain('..')
  })

  it('says where to verify a number on a trial account', async () => {
    const said = await sendFailing(21608, 'The number is unverified.')
    expect(said).toContain('Verified Caller IDs')
  })

  it('names geo permissions rather than leaving a bare code', async () => {
    const said = await sendFailing(21408, 'Permission to send an SMS has not been enabled.')
    expect(said).toContain('Geo permissions')
  })

  it('still reports a code it has nothing to add to', async () => {
    const said = await sendFailing(30007, 'Message filtered.')
    expect(said).toContain('Message filtered')
  })
})

describe('an answer too long for one SMS', () => {
  const long = 'Delivery to the United Kingdom takes one to two working days. '.repeat(40)

  it('is sent as several messages rather than cut short', () => {
    const parts = split(long)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.length <= 1600)).toBe(true)
  })

  it('loses not one word of the answer', () => {
    const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()
    expect(normalise(split(long).join(' '))).toBe(normalise(long))
  })

  it('breaks between sentences, not through a word', () => {
    expect(split(long).every((part) => part.endsWith('.'))).toBe(true)
  })

  it('leaves a short answer as one message', () => {
    expect(split('Yes, we ship to Ireland.')).toEqual(['Yes, we ship to Ireland.'])
  })

  it('still sends something when there is no break to be found', () => {
    // No spaces at all, so every candidate boundary is missing. The answer
    // still has to arrive, even if the seam lands mid-word.
    const parts = split('x'.repeat(4000))
    expect(parts.join('')).toBe('x'.repeat(4000))
    expect(parts.every((part) => part.length <= 1600)).toBe(true)
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

describe('Telegram', () => {
  const secretToken = 'super-secret'
  const base = { botToken: 'bot123', secretToken }

  function post(body: unknown, secret = secretToken) {
    return new Request('https://shop.example/webhooks/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify(body),
    })
  }

  const update = {
    message: {
      message_id: 7,
      text: 'do you do refunds?',
      chat: { id: 4242, type: 'private' },
      from: { id: 99, first_name: 'Sam', is_bot: false },
    },
  }

  it('rejects an update without the secret token, which is the only auth there is', async () => {
    const { agent } = await agentFor()
    const handle = telegramChannel({ agent, ...base })
    expect((await handle(post(update, 'guessed'))).status).toBe(401)
  })

  it('answers and replies to the original message', async () => {
    const sent: Array<{ chatId: number | string; text: string; replyTo?: number }> = []
    const { agent, store } = await agentFor()
    const pending = collector()

    const handle = telegramChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (chatId, text, replyTo) => void sent.push({ chatId, text, replyTo }),
    })

    expect((await handle(post(update))).status).toBe(200)
    await pending.settled()

    expect(sent[0]).toMatchObject({ chatId: '4242', replyTo: 7 })
    expect((await store.getConversation('telegram:4242'))?.conversation.contact?.name).toBe('Sam')
  })

  it('ignores another bot, which would otherwise loop forever', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = telegramChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    await handle(post({ message: { ...update.message, from: { id: 1, is_bot: true } } }))
    await pending.settled()
    expect(sent).toEqual([])
  })
})

describe('Discord', () => {
  /** A real Ed25519 keypair, so the signature path is genuinely exercised. */
  async function keypair() {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const publicKey = [...raw].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return { pair, publicKey }
  }

  async function signed(body: unknown, pair: CryptoKeyPair) {
    const raw = JSON.stringify(body)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = new Uint8Array(
      await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(timestamp + raw)),
    )

    return new Request('https://shop.example/webhooks/discord', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': [...signature].map((b) => b.toString(16).padStart(2, '0')).join(''),
        'x-signature-timestamp': timestamp,
      },
      body: raw,
    })
  }

  it('answers a ping with a pong', async () => {
    const { pair, publicKey } = await keypair()
    const { agent } = await agentFor()
    const handle = discordChannel({ agent, publicKey, applicationId: 'app1' })

    const response = await handle(await signed({ type: 1 }, pair))
    expect(await response.json()).toEqual({ type: 1 })
  })

  it('rejects an invalid signature, which Discord requires or it disables the endpoint', async () => {
    const { publicKey } = await keypair()
    const other = await keypair()
    const { agent } = await agentFor()
    const handle = discordChannel({ agent, publicKey, applicationId: 'app1' })

    // Signed with a different key entirely.
    const response = await handle(await signed({ type: 1 }, other.pair))
    expect(response.status).toBe(401)
  })

  it('rejects a request with no signature headers', async () => {
    const { publicKey } = await keypair()
    const { agent } = await agentFor()
    const handle = discordChannel({ agent, publicKey, applicationId: 'app1' })

    const response = await handle(
      new Request('https://shop.example/d', { method: 'POST', body: '{"type":1}' }),
    )
    expect(response.status).toBe(401)
  })

  it('defers, then edits in the real answer', async () => {
    const { pair, publicKey } = await keypair()
    const sent: Array<{ token: string; text: string }> = []
    const { agent } = await agentFor()
    const pending = collector()

    const handle = discordChannel({
      agent,
      publicKey,
      applicationId: 'app1',
      waitUntil: pending.waitUntil,
      send: async (token, text) => void sent.push({ token, text }),
    })

    const response = await handle(
      await signed(
        {
          type: 2,
          token: 'interaction-token',
          channel_id: 'C1',
          member: { user: { id: 'U1', username: 'sam' } },
          data: { name: 'ask', options: [{ name: 'question', value: 'do you do refunds?' }] },
        },
        pair,
      ),
    )

    // Type 5 is "thinking", which is what keeps Discord's 3 second limit happy.
    expect(await response.json()).toEqual({ type: 5 })

    await pending.settled()
    expect(sent[0]?.token).toBe('interaction-token')
  })
})
