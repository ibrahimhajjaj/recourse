import { describe, expect, it, vi } from 'vitest'
import { ticketSource, zendeskTickets } from '../src/sources/tickets.js'

/**
 * A support desk that has been running a year is the best documentation a
 * business has, and the least likely to exist as a document.
 */

describe('past tickets as knowledge', () => {
  it('indexes the question and what answered it', async () => {
    const [document] = await ticketSource({
      load: async () => [
        {
          id: 4021,
          subject: 'Charger not covered?',
          question: 'Does the two year warranty cover the charger?',
          answer: 'The charger carries its own twelve month warranty.',
          url: 'https://desk.example/tickets/4021',
        },
      ],
    }).load({})

    expect(document?.id).toBe('ticket:4021')
    expect(document?.url).toBe('https://desk.example/tickets/4021')
    expect(document?.text).toContain('# Charger not covered?')
    expect(document?.text).toContain('Does the two year warranty cover the charger?')
    expect(document?.text).toContain('The charger carries its own twelve month warranty.')
  })

  it('drops a ticket with no answer in it', async () => {
    // A question with no answer teaches the agent to repeat the question.
    const documents = await ticketSource({
      load: async () => [
        { id: 1, subject: 'Still waiting', question: 'Where is my order?', answer: '' },
        { id: 2, subject: 'No question', question: '   ', answer: 'Sorted.' },
      ],
    }).load({})

    expect(documents).toEqual([])
  })

  it('falls back to the question when nobody wrote a subject', async () => {
    const [document] = await ticketSource({
      load: async () => [{ id: 7, subject: '', question: 'Do you ship to Ireland?', answer: 'We do.' }],
    }).load({})

    expect(document?.text.startsWith('# Do you ship to Ireland?')).toBe(true)
  })
})

describe('reading them out of Zendesk', () => {
  it('refuses to start without something to authenticate with', async () => {
    await expect(zendeskTickets({ subdomain: 'acme' })).rejects.toThrow(/accessToken/)
  })

  it('asks only for solved tickets, and takes the last public reply', async () => {
    const asked: string[] = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = vi.fn(async (url: string) => {
      asked.push(String(url))

      if (String(url).includes('/search.json')) {
        return new Response(
          JSON.stringify({
            results: [{ id: 88, subject: 'Charger', description: 'Is the charger covered?' }],
            next_page: null,
          }),
          { status: 200 },
        )
      }

      return new Response(
        JSON.stringify({
          comments: [
            { body: 'Is the charger covered?', public: true },
            { body: 'Ask them for the serial before you promise anything.', public: false },
            { body: 'The charger carries its own twelve month warranty.', public: true },
          ],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    try {
      const tickets = await zendeskTickets({ subdomain: 'acme', accessToken: 'tok' })

      expect(asked[0]).toContain(encodeURIComponent('status:solved'))
      expect(tickets[0]).toMatchObject({
        id: 88,
        question: 'Is the charger covered?',
        answer: 'The charger carries its own twelve month warranty.',
      })
      // The internal note is written between colleagues about a customer, and
      // is exactly the sentence you would not want read back to the next one.
      expect(JSON.stringify(tickets)).not.toContain('promise anything')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('skips a ticket nobody ever replied to in public', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: string) =>
      String(url).includes('/search.json')
        ? new Response(JSON.stringify({ results: [{ id: 9, subject: 'x', description: 'y' }], next_page: null }), {
            status: 200,
          })
        : new Response(JSON.stringify({ comments: [{ body: 'y', public: true }] }), { status: 200 }),
    ) as unknown as typeof fetch

    try {
      expect(await zendeskTickets({ subdomain: 'acme', accessToken: 'tok' })).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('says what went wrong rather than returning an empty knowledge base', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch

    try {
      await expect(zendeskTickets({ subdomain: 'acme', accessToken: 'tok' })).rejects.toThrow(/401/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
