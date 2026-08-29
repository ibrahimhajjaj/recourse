import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { detectAndTranslate, looksEnglish } from '../src/helpdesk/translate.js'
import { createHelpdesk } from '../src/helpdesk/index.js'
import { memoryStore } from '../src/store/memory.js'

/** A model that returns one canned reply and counts how often it was asked. */
function canned(text: string) {
  let calls = 0

  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls++
      return {
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text' as const, text }],
        warnings: [],
      }
    },
  })

  return { model, calls: () => calls }
}

describe('the free gate', () => {
  it('recognises plain English', () => {
    expect(looksEnglish('Where is my order? It has not arrived yet.')).toBe(true)
    expect(looksEnglish('Please can you refund the second item on order 4471.')).toBe(true)
  })

  it('recognises a script that is not Latin', () => {
    expect(looksEnglish('أين طلبي؟ لم يصل بعد')).toBe(false)
    expect(looksEnglish('私の注文はどこですか')).toBe(false)
    expect(looksEnglish('Где мой заказ')).toBe(false)
  })

  it('recognises Latin text that is not English', () => {
    expect(looksEnglish('Dónde está mi pedido? Todavía no ha llegado nada.')).toBe(false)
    expect(looksEnglish('Wo ist meine Bestellung? Sie ist noch nicht angekommen.')).toBe(false)
  })

  it('lets a short message through on one marker', () => {
    // Too few words for a ratio to mean anything.
    expect(looksEnglish('is it here')).toBe(true)
    expect(looksEnglish('gracias')).toBe(false)
  })

  it('treats an empty message as nothing to do', () => {
    expect(looksEnglish('')).toBe(true)
    expect(looksEnglish('   ')).toBe(true)
  })
})

describe('translating a message', () => {
  it('costs nothing at all when the message is already English', async () => {
    const { model, calls } = canned('{}')

    const result = await detectAndTranslate('Where is my order 4471?', { target: 'en', model })

    expect(result.skipped).toBe(true)
    expect(result.language).toBe('en')
    expect(calls()).toBe(0)
  })

  it('translates, and says what language it read', async () => {
    const { model } = canned('{"language":"ar","translation":"Where is my order 4471?"}')

    const result = await detectAndTranslate('أين طلبي رقم 4471؟', { target: 'en', model })

    expect(result.skipped).toBe(false)
    expect(result.language).toBe('ar')
    expect(result.translation).toBe('Where is my order 4471?')
  })

  it('reads JSON a model wrapped in a code fence', async () => {
    // Small models do this however firmly they are told not to, and throwing
    // the translation away over a fence helps nobody.
    const { model } = canned('```json\n{"language":"es","translation":"My order is late."}\n```')

    const result = await detectAndTranslate('Mi pedido llega tarde.', { target: 'en', model })

    expect(result.translation).toBe('My order is late.')
  })

  it('reads JSON with a sentence in front of it', async () => {
    const { model } = canned('Sure! Here is the translation:\n{"language":"de","translation":"Where is it?"}')

    expect((await detectAndTranslate('Wo ist es?', { target: 'en', model })).translation).toBe('Where is it?')
  })

  it('skips when the model says it was already the target language', async () => {
    const { model } = canned('{"language":"en","translation":"Where is my order?"}')

    // Not English by the gate, but the model disagrees, and the model has read
    // the whole sentence.
    const result = await detectAndTranslate('Zzz qqq xxx yyy www vvv', { target: 'en', model })

    expect(result.skipped).toBe(true)
  })

  it('gives up quietly on a model that answers with prose', async () => {
    const { model } = canned('I think this says something about an order.')

    const result = await detectAndTranslate('أين طلبي؟', { target: 'en', model })

    expect(result.skipped).toBe(true)
    expect(result.translation).toBeUndefined()
  })

  it('gives up quietly when the model throws', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('the provider is down')
      },
    })

    // A translation service having a bad afternoon must not stop a ticket
    // being filed.
    expect((await detectAndTranslate('أين طلبي؟', { target: 'en', model })).skipped).toBe(true)
  })

  it('passes a very long message through untouched', async () => {
    const { model, calls } = canned('{"language":"ar","translation":"x"}')

    const result = await detectAndTranslate('أ'.repeat(20_000), { target: 'en', model })

    expect(result.skipped).toBe(true)
    expect(calls()).toBe(0)
  })
})

describe('translation through the help desk', () => {
  const translation = (text: string) => {
    const { model, calls } = canned(text)
    return { target: 'en', model, calls }
  }

  it('translates the opening description and keeps the original', async () => {
    const t = translation('{"language":"ar","translation":"My order has not arrived."}')
    const desk = createHelpdesk({ store: memoryStore(), translation: t })

    const ticket = await desk.openTicket({
      subject: 'طلبي',
      description: 'لم يصل طلبي بعد',
      customer: { email: 'a@example.com' },
    })

    expect(ticket.description).toBe('لم يصل طلبي بعد')
    expect(ticket.metadata?.translation).toBe('My order has not arrived.')
    expect(ticket.metadata?.language).toBe('ar')
  })

  it('translates a customer reply and leaves the content alone', async () => {
    const t = translation('{"language":"ar","translation":"Any news?"}')
    const desk = createHelpdesk({ store: memoryStore(), translation: t })

    const ticket = await desk.openTicket({
      subject: 'x',
      description: 'y',
      customer: { email: 'a@example.com' },
    })
    const message = await desk.reply(ticket.ticketNumber, 'هل من جديد؟', { type: 'customer' })

    expect(message?.content).toBe('هل من جديد؟')
    expect(message?.metadata?.translation).toBe('Any news?')
  })

  it('never touches an agent reply', async () => {
    const t = translation('{"language":"ar","translation":"SHOULD NOT APPEAR"}')
    const desk = createHelpdesk({ store: memoryStore(), translation: t })

    const ticket = await desk.openTicket({
      subject: 'x',
      description: 'y',
      customer: { email: 'a@example.com' },
    })
    const before = t.calls()
    const message = await desk.reply(ticket.ticketNumber, 'نعم، سنرسل بديلاً', {
      type: 'agent',
      name: 'Sam',
    })

    // The agent is accountable for the sentence they wrote, so it goes out as
    // they wrote it and no model is asked about it.
    expect(message?.metadata?.translation).toBeUndefined()
    expect(t.calls()).toBe(before)
  })

  it('never touches an internal note', async () => {
    const t = translation('{"language":"ar","translation":"SHOULD NOT APPEAR"}')
    const desk = createHelpdesk({ store: memoryStore(), translation: t })

    const ticket = await desk.openTicket({
      subject: 'x',
      description: 'y',
      customer: { email: 'a@example.com' },
    })
    const note = await desk.note(ticket.ticketNumber, 'ملاحظة داخلية', { type: 'agent', name: 'Sam' })

    expect(note?.metadata?.translation).toBeUndefined()
  })

  it('records the language even when it did not translate', async () => {
    const t = translation('{"language":"en","translation":"Where is my order?"}')
    const desk = createHelpdesk({ store: memoryStore(), translation: t })

    const ticket = await desk.openTicket({
      subject: 'Late order',
      description: 'Where is my order 4471? It has not arrived.',
      customer: { email: 'a@example.com' },
    })

    // English in, nothing sent to a model, and the language is still on record
    // so a drafted reply knows which language to come back in.
    expect(ticket.metadata?.translation).toBeUndefined()
    expect(ticket.metadata?.language).toBe('en')
    expect(t.calls()).toBe(0)
  })
})

describe('drafting a reply for a translated ticket', () => {
  /** Captures the question the agent was handed. */
  function recordingAgent() {
    const asked: string[] = []
    return {
      asked,
      agent: {
        answer: async (question: string) => {
          asked.push(question)
          return { text: 'drafted', unanswered: false, sources: [], matches: [] }
        },
      } as never,
    }
  }

  it('tells the agent which language to reply in', async () => {
    const { model } = canned('{"language":"ar","translation":"My order has not arrived."}')
    const { asked, agent } = recordingAgent()
    const desk = createHelpdesk({
      store: memoryStore(),
      agent,
      translation: { target: 'en', model },
    })

    const ticket = await desk.openTicket({
      subject: 'طلبي',
      description: 'لم يصل طلبي بعد',
      customer: { email: 'a@example.com' },
    })
    await desk.draftReply(ticket.ticketNumber)

    // Without this the model reads an English thread and answers in English,
    // to a customer who wrote in Arabic.
    expect(asked[0]).toContain('ar')
    expect(asked[0]?.toLowerCase()).toContain("customer's own language")
  })

  it('says nothing extra on an English ticket', async () => {
    const { model } = canned('{}')
    const { asked, agent } = recordingAgent()
    const desk = createHelpdesk({
      store: memoryStore(),
      agent,
      translation: { target: 'en', model },
    })

    const ticket = await desk.openTicket({
      subject: 'Late order',
      description: 'Where is my order 4471? It has not arrived yet.',
      customer: { email: 'a@example.com' },
    })
    await desk.draftReply(ticket.ticketNumber)

    expect(asked[0]?.toLowerCase()).not.toContain("customer's own language")
  })
})
