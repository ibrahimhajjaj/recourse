import { describe, expect, it, vi } from 'vitest'
import { sendWhatsAppTemplate, whatsAppTemplates } from '../src/channels/whatsapp-template.js'

/**
 * WhatsApp will not carry a message you wrote to somebody who has not written
 * to you in a day. Outside that window an approved template is the only thing
 * that goes through, which is why an outbound campaign needs this rather than
 * the ordinary sender.
 */

function stub(body: unknown, status = 200) {
  const seen: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), init })
      return new Response(JSON.stringify(body), { status })
    }),
  )
  return seen
}

const credentials = { phoneNumberId: '123', accessToken: 'tok' }

describe('sending an approved template', () => {
  it('names the template, its language and the values in order', async () => {
    const seen = stub({ messages: [{ id: 'wamid.1' }] })

    const sent = await sendWhatsAppTemplate(credentials, {
      to: '447700900000',
      template: 'order_shipped',
      language: 'en_GB',
      variables: ['Sam', 'LUM-1234'],
    })

    expect(sent.id).toBe('wamid.1')
    const body = JSON.parse(String(seen[0]?.init?.body))
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '447700900000',
      type: 'template',
      template: { name: 'order_shipped', language: { code: 'en_GB' } },
    })
    expect(body.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Sam' }, { type: 'text', text: 'LUM-1234' }] },
    ])
  })

  it('sends a header’s values separately from the body’s', async () => {
    const seen = stub({ messages: [{ id: 'wamid.2' }] })

    await sendWhatsAppTemplate(credentials, {
      to: '447700900000',
      template: 'order_shipped',
      language: 'en_GB',
      headerVariables: ['Acme'],
      variables: ['Sam'],
    })

    const components = JSON.parse(String(seen[0]?.init?.body)).template.components
    expect(components.map((part: { type: string }) => part.type)).toEqual(['header', 'body'])
  })

  it('sends no components at all for a template with no holes in it', async () => {
    const seen = stub({ messages: [{ id: 'wamid.3' }] })

    await sendWhatsAppTemplate(credentials, { to: '447700900000', template: 'hello', language: 'en_GB' })

    expect(JSON.parse(String(seen[0]?.init?.body)).template).not.toHaveProperty('components')
  })

  it('says what Meta said rather than failing quietly', async () => {
    stub({ error: { message: 'template name does not exist' } }, 400)

    await expect(
      sendWhatsAppTemplate(credentials, { to: '447700900000', template: 'nope', language: 'en_GB' }),
    ).rejects.toThrow(/400/)
  })
})

describe('reading the approved list before a campaign', () => {
  it('reports the status and how many values each template needs', async () => {
    // Worth knowing before four thousand sends rather than during them: a
    // template still pending review fails once per recipient.
    stub({
      data: [
        {
          name: 'order_shipped',
          language: 'en_GB',
          status: 'APPROVED',
          category: 'UTILITY',
          components: [
            { type: 'HEADER', text: 'Acme' },
            { type: 'BODY', text: 'Hi {{1}}, order {{2}} is on its way. Thanks {{1}}.' },
          ],
        },
        { name: 'winback', language: 'en_GB', status: 'PENDING', category: 'MARKETING', components: [] },
      ],
    })

    const templates = await whatsAppTemplates({ businessAccountId: '999', accessToken: 'tok' })

    expect(templates[0]).toEqual({
      name: 'order_shipped',
      language: 'en_GB',
      status: 'APPROVED',
      category: 'UTILITY',
      // Two, not three: {{1}} twice is still one value.
      variables: 2,
    })
    expect(templates[1]?.status).toBe('PENDING')
  })

  it('asks the business account, which is not the phone number id', async () => {
    const seen = stub({ data: [] })
    await whatsAppTemplates({ businessAccountId: '999', accessToken: 'tok' })

    expect(seen[0]?.url).toContain('/999/message_templates')
  })
})
