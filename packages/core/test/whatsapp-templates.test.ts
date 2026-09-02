import { describe, expect, it } from 'vitest'
import {
  listTemplates,
  sendTemplate,
  templateSender,
  type MessageTemplate,
} from '../src/channels/whatsapp-templates.js'
import { memoryStore } from '../src/store/memory.js'
import { runCampaign } from '../src/outbound/index.js'

/**
 * Meta's documented shape for `GET /{waba-id}/message_templates`.
 *
 * Recorded rather than invented: the placeholders live inside the body text
 * and the examples sit in a doubly-nested array, which is the part any
 * reimplementation gets wrong.
 */
const TEMPLATES_RESPONSE = {
  data: [
    {
      name: 'order_update',
      language: 'en_US',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hello {{1}}, your order {{2}} has shipped and arrives {{3}}.',
          example: { body_text: [['Amina', '4471', 'Thursday']] },
        },
      ],
    },
    {
      name: 'order_update',
      language: 'ar',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'مرحبا {{1}}، طلبك {{2}} في الطريق.' }],
    },
    {
      name: 'winback',
      language: 'en_US',
      status: 'PENDING',
      components: [{ type: 'BODY', text: 'We miss you, {{1}}.' }],
    },
    {
      name: 'no_variables',
      language: 'en_US',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Your order is ready to collect.' }],
    },
  ],
}

function responding(body: unknown, ok = true, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = []

  const stub = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response
  }) as unknown as typeof fetch

  return { fetch: stub, calls }
}

describe('listing what Meta approved', () => {
  it('returns only approved templates', async () => {
    const { fetch } = responding(TEMPLATES_RESPONSE)

    const templates = await listTemplates({ wabaId: 'waba_1', accessToken: 't', fetch })

    // The pending one cannot be sent, and offering it is offering a failure a
    // few minutes from now.
    expect(templates.map((template) => template.name)).toEqual([
      'order_update',
      'order_update',
      'no_variables',
    ])
  })

  it('reads the placeholders out of the body text', async () => {
    const { fetch } = responding(TEMPLATES_RESPONSE)

    const templates = await listTemplates({ wabaId: 'waba_1', accessToken: 't', fetch })
    const english = templates.find((template) => template.language === 'en_US')

    expect(english?.variables).toEqual([
      { position: 1, example: 'Amina' },
      { position: 2, example: '4471' },
      { position: 3, example: 'Thursday' },
    ])
  })

  it('handles a template with no placeholders at all', async () => {
    const { fetch } = responding(TEMPLATES_RESPONSE)

    const templates = await listTemplates({ wabaId: 'waba_1', accessToken: 't', fetch })

    expect(templates.find((template) => template.name === 'no_variables')?.variables).toEqual([])
  })

  it('carries the business account on every template', async () => {
    const { fetch } = responding(TEMPLATES_RESPONSE)

    const templates = await listTemplates({ wabaId: 'waba_1', accessToken: 't', fetch })

    // A template can only be sent from a number on its own account, so the
    // account has to travel with it.
    expect(templates.every((template) => template.wabaId === 'waba_1')).toBe(true)
  })

  it('says what Meta said when the call fails', async () => {
    const { fetch } = responding({ error: { message: 'Invalid OAuth access token' } }, false, 401)

    await expect(listTemplates({ wabaId: 'waba_1', accessToken: 'bad', fetch })).rejects.toThrow(
      'Invalid OAuth access token',
    )
  })
})

const KNOWN: MessageTemplate[] = [
  { name: 'order_update', language: 'en_US', status: 'APPROVED', wabaId: 'waba_1', variables: [] },
  { name: 'order_update', language: 'ar', status: 'APPROVED', wabaId: 'waba_1', variables: [] },
  { name: 'ready', language: 'en_US', status: 'APPROVED', wabaId: 'waba_2', variables: [] },
]

describe('sending one', () => {
  it('builds the payload Meta documents', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'wamid.ABC' }] })

    const result = await sendTemplate({
      accessToken: 't',
      phoneNumberId: 'pn_1',
      to: '447700900123',
      template: { name: 'order_update', language: 'en_US', variables: ['Amina', '4471', 'Thursday'] },
      fetch,
    })

    expect(result.messageId).toBe('wamid.ABC')

    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body.messaging_product).toBe('whatsapp')
    expect(body.type).toBe('template')
    expect(body.template.language).toEqual({ code: 'en_US' })
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Amina' },
      { type: 'text', text: '4471' },
      { type: 'text', text: 'Thursday' },
    ])
  })

  it('sends no components when the template has no placeholders', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'wamid.X' }] })

    await sendTemplate({
      accessToken: 't',
      phoneNumberId: 'pn_1',
      to: '447700900123',
      template: { name: 'no_variables', language: 'en_US' },
      fetch,
    })

    expect(JSON.parse(String(calls[0]?.init?.body)).template.components).toBeUndefined()
  })

  it('refuses an ambiguous name rather than guessing the language', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'x' }] })

    // Guessing is worse than failing: the customer gets a message in a
    // language they may not read, and it is billed either way.
    await expect(
      sendTemplate({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        to: '447700900123',
        template: { name: 'order_update' },
        known: KNOWN,
        fetch,
      }),
    ).rejects.toThrow('TEMPLATE_LANGUAGE_REQUIRED')

    expect(calls).toHaveLength(0)
  })

  it('resolves the language when there is only one', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'wamid.Y' }] })

    await sendTemplate({
      accessToken: 't',
      phoneNumberId: 'pn_2',
      to: '447700900123',
      template: { name: 'ready' },
      known: KNOWN,
      fetch,
    })

    expect(JSON.parse(String(calls[0]?.init?.body)).template.language.code).toBe('en_US')
  })

  it('refuses a template from a different business account', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'x' }] })

    // The mistake everybody makes, and Meta's own error does not say so.
    await expect(
      sendTemplate({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        wabaId: 'waba_1',
        to: '447700900123',
        template: { name: 'ready', language: 'en_US' },
        known: KNOWN,
        fetch,
      }),
    ).rejects.toThrow('PHONE_NUMBER_REQUIRED')

    expect(calls).toHaveLength(0)
  })

  it('refuses a name that is not approved at all', async () => {
    const { fetch } = responding({ messages: [{ id: 'x' }] })

    await expect(
      sendTemplate({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        to: '447700900123',
        template: { name: 'invented' },
        known: KNOWN,
        fetch,
      }),
    ).rejects.toThrow('no approved template')
  })

  it('threads the send into the conversation a reply will land in', async () => {
    const { fetch } = responding({ messages: [{ id: 'wamid.Z' }] })
    const store = memoryStore()

    await sendTemplate({
      accessToken: 't',
      phoneNumberId: 'pn_1',
      to: '447700900123',
      template: { name: 'order_update', language: 'en_US', variables: ['Amina', '4471'] },
      store,
      fetch,
    })

    // whatsappChannel keys conversations this way, so the customer's answer
    // continues this thread rather than opening a second one.
    const conversation = await store.getConversation('whatsapp:447700900123')
    expect(conversation?.conversation.channel).toBe('whatsapp')
    expect(conversation?.messages[0]?.content).toContain('order_update')
  })

  it('reports Meta\'s error rather than a bare status', async () => {
    const { fetch } = responding(
      { error: { message: 'Template name does not exist in the translation', code: 132001 } },
      false,
      400,
    )

    await expect(
      sendTemplate({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        to: '447700900123',
        template: { name: 'order_update', language: 'fr' },
        fetch,
      }),
    ).rejects.toThrow('does not exist in the translation')
  })

  // The message Meta actually returns for a number that was created but never
  // registered, copied from a live send. On its own it tells you nothing.
  it('says how to fix a number that was never registered', async () => {
    const { fetch } = responding(
      { error: { message: '(#133010) Account not registered', code: 133010 } },
      false,
      400,
    )

    await expect(
      sendTemplate({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        to: '447700900123',
        template: { name: 'hello_world', language: 'en_US' },
        fetch,
      }),
    ).rejects.toThrow('/register')
  })

  it('says where the allow list is when a test number writes to a stranger', async () => {
    const { fetch } = responding(
      { error: { message: 'Recipient phone number not in allowed list', code: 131030 } },
      false,
      400,
    )

    await expect(
      sendTemplate({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        to: '447700900123',
        template: { name: 'hello_world', language: 'en_US' },
        fetch,
      }),
    ).rejects.toThrow('five at most')
  })
})

describe('opening conversations in a campaign', () => {
  it('sends one template per recipient with their own values', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'wamid.C' }] })

    const result = await runCampaign({
      name: 'Order updates',
      channel: 'whatsapp',
      template: 'ignored on whatsapp',
      recipients: [
        { to: '447700900001', consented: true, variables: { name: 'Amina', order: '4471' } },
        { to: '447700900002', consented: true, variables: { name: 'Yusuf', order: '4472' } },
        { to: '447700900003', consented: false, variables: { name: 'Nope', order: '0' } },
      ],
      send: templateSender({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        template: { name: 'order_update', language: 'en_US', variables: ['name', 'order'] },
        fetch,
      }),
    })

    expect(result.sent).toBe(2)
    // Consent is still ours. Meta approving the wording is not the customer
    // agreeing to hear from you.
    expect(result.skipped).toBe(1)

    const first = JSON.parse(String(calls[0]?.init?.body))
    expect(first.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Amina' },
      { type: 'text', text: '4471' },
    ])
  })

  it('sends an empty string for a value the recipient does not have', async () => {
    const { fetch, calls } = responding({ messages: [{ id: 'wamid.D' }] })

    await runCampaign({
      name: 'Order updates',
      channel: 'whatsapp',
      template: 'x',
      recipients: [{ to: '447700900001', consented: true, variables: { name: 'Amina' } }],
      send: templateSender({
        accessToken: 't',
        phoneNumberId: 'pn_1',
        template: { name: 'order_update', language: 'en_US', variables: ['name', 'order'] },
        fetch,
      }),
    })

    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body.template.components[0].parameters[1]).toEqual({ type: 'text', text: '' })
  })
})
