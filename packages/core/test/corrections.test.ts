import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { correctionFor, memoryCorrections } from '../src/corrections.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { tokenize } from '../src/knowledge/tokenize.js'
import type { KnowledgeIndex } from '../src/types.js'

vi.mock('../src/knowledge/tokenize.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/knowledge/tokenize.js')>()
  return { tokenize: vi.fn(real.tokenize) }
})

let cached: KnowledgeIndex | null = null
const index = async () =>
  (cached ??= await buildIndex({
    sources: [
      textSource([
        { id: 'returns', title: 'Returns', text: 'We refund any order within 30 days of delivery.' },
        { id: 'hours', title: 'Opening hours', text: 'We are open nine to five, Monday to Friday.' },
      ]),
    ],
  }))

/** Reports the sources it was given, so the test can see what reached it. */
function reporter() {
  let sources = ''

  const model = new MockLanguageModelV4({
    doStream: async (options: any) => {
      sources = String(options.prompt.find((entry: any) => entry.role === 'system')?.content ?? '')

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'Answered.' },
            { type: 'text-end' as const, id: '0' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop', raw: 'stop' } as const,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }
    },
  })

  return { model, get sources() { return sources } }
}

describe('matching a correction to a question', () => {
  const corrections = [
    {
      id: '1',
      question: 'how long do I have to return an engraved item',
      answer: 'Engraved items cannot be returned at all.',
      createdAt: '2026-01-01',
    },
  ]

  it('applies to the question it was written about', () => {
    expect(correctionFor('how long do I have to return an engraved item?', corrections)?.id).toBe('1')
  })

  it('does not apply to a different question that shares a word', () => {
    // A correction beats the documentation by construction, so a loose match
    // answers a question nobody checked with an answer written for another one.
    expect(correctionFor('how long does delivery take?', corrections)).toBeUndefined()
    expect(correctionFor('can I return a mug?', corrections)).toBeUndefined()
  })

  it('ignores an empty question rather than matching everything', () => {
    expect(correctionFor('', corrections)).toBeUndefined()
  })

  it('matches an edited correction by its new wording', () => {
    // A new field on the record is the one place a match could silently start
    // behaving differently, and the matcher reads the question either way.
    const edited = [
      {
        id: '2',
        question: 'how long do I have to return an engraved item',
        answer: 'Engraved items can be returned within seven days.',
        createdAt: '2026-01-01',
        updatedAt: '2026-02-01',
      },
    ]

    expect(correctionFor('how long do I have to return an engraved item?', edited)?.id).toBe('2')
  })
})

describe('correcting a wrong answer without a deploy', () => {
  it('puts the team answer in front of the documentation', async () => {
    const corrections = memoryCorrections()
    const first = reporter()

    const before = createAgent({ index: await index(), model: first.model, corrections })
    await before.answer('how do I get a refund?')

    expect(first.sources).toContain('30 days')
    expect(first.sources).not.toContain('Correction from the support team')

    // Somebody on the team notices the answer is wrong and writes the right one.
    await corrections.add({
      question: 'how do I get a refund?',
      answer: 'Refunds now take 14 days, not 30.',
      author: 'sam@shop.example',
    })

    const second = reporter()
    const after = createAgent({ index: await index(), model: second.model, corrections })
    await after.answer('how do I get a refund?')

    // No rebuild, no deploy, effective on the very next message.
    expect(after).toBeDefined()
    expect(second.sources).toContain('Refunds now take 14 days')
    expect(second.sources.indexOf('Refunds now take 14 days')).toBeLessThan(second.sources.indexOf('30 days'))
  })

  it('still answers when the corrections cannot be read', async () => {
    // The customer getting the documentation's answer is what would have
    // happened anyway. Getting nothing is not.
    const broken = {
      list: async () => {
        throw new Error('the corrections table is gone')
      },
    }

    const reported = reporter()
    const agent = createAgent({ index: await index(), model: reported.model, corrections: broken as never })
    const { text } = await agent.answer('how do I get a refund?')

    expect(text).toBe('Answered.')
    expect(reported.sources).toContain('30 days')
  })

  it('stops applying once it is removed', async () => {
    const corrections = memoryCorrections()
    const saved = await corrections.add({ question: 'how do I get a refund?', answer: 'Fourteen days.' })

    expect(await corrections.remove(saved.id)).toBe(true)
    expect(await corrections.remove(saved.id)).toBe(false)

    const reported = reporter()
    await createAgent({ index: await index(), model: reported.model, corrections }).answer('how do I get a refund?')

    expect(reported.sources).not.toContain('Fourteen days')
  })
})

describe('correcting an answer over the management API', () => {
  const call = async (
    handler: (request: Request) => Promise<Response>,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    handler(
      new Request(`https://api.example${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    )

  const api = async (corrections?: unknown) => {
    const { createApiHandler } = await import("../src/api/index.js")
    const { memoryStore } = await import('../src/store/memory.js')

    return createApiHandler({ store: memoryStore(), ...(corrections ? { corrections } : {}) } as never)
  }

  it('writes one, lists it, and removes it', async () => {
    const { memoryCorrections } = await import('../src/corrections.js')
    const store = memoryCorrections()
    const handler = await api(store)

    const created = await call(handler, 'POST', '/corrections', {
      question: 'how do I get a refund?',
      answer: 'Refunds now take 14 days.',
      author: 'sam@shop.example',
    })
    expect(created.status).toBe(201)

    const saved = ((await created.json()) as any).data
    expect(saved.answer).toBe('Refunds now take 14 days.')

    const listed = (await (await call(handler, 'GET', '/corrections')).json()) as any
    expect(listed.data).toHaveLength(1)

    expect((await call(handler, 'DELETE', `/corrections/${saved.id}`)).status).toBe(200)
    expect((await call(handler, 'DELETE', `/corrections/${saved.id}`)).status).toBe(404)
  })

  it('refuses a correction with half of it missing', async () => {
    const { memoryCorrections } = await import('../src/corrections.js')
    const handler = await api(memoryCorrections())

    // An answer with no question matches nothing; a question with no answer
    // replaces a wrong answer with an empty one.
    expect((await call(handler, 'POST', '/corrections', { answer: 'Fourteen days.' })).status).toBe(400)
    expect((await call(handler, 'POST', '/corrections', { question: 'refund?' })).status).toBe(400)
    expect((await call(handler, 'POST', '/corrections', { question: '  ', answer: '  ' })).status).toBe(400)
  })

  it('says plainly when no correction store is configured', async () => {
    const handler = await api()
    const response = await call(handler, 'GET', '/corrections')

    expect(response.status).toBe(501)
    expect(((await response.json()) as any).error.code).toBe('not_configured')
  })

  it('edits one in place, keeping its id and its author', async () => {
    const { memoryCorrections } = await import('../src/corrections.js')
    const handler = await api(memoryCorrections())

    const saved = ((await (
      await call(handler, 'POST', '/corrections', {
        question: 'how do I get a refund?',
        answer: 'Refunds now take 14 days.',
        author: 'sam@shop.example',
      })
    ).json()) as any).data

    const response = await call(handler, 'PATCH', `/corrections/${saved.id}`, { answer: 'Refunds take 21 days.' })
    expect(response.status).toBe(200)

    const edited = ((await response.json()) as any).data

    // The whole point: the record of who decided this and when survives the
    // act of fixing what they wrote.
    expect(edited.id).toBe(saved.id)
    expect(edited.author).toBe('sam@shop.example')
    expect(edited.createdAt).toBe(saved.createdAt)
    expect(edited.answer).toBe('Refunds take 21 days.')
    expect(edited.question).toBe('how do I get a refund?')

    // One correction, not the two remove-then-add would have left behind.
    const listed = (await (await call(handler, 'GET', '/corrections')).json()) as any
    expect(listed.data).toHaveLength(1)
  })

  it('sets updatedAt only once it has been edited', async () => {
    const { memoryCorrections } = await import('../src/corrections.js')
    const handler = await api(memoryCorrections())

    const saved = ((await (
      await call(handler, 'POST', '/corrections', { question: 'where is my order?', answer: 'Check the tracking link.' })
    ).json()) as any).data

    expect(saved.updatedAt).toBeUndefined()

    const edited = ((await (
      await call(handler, 'PATCH', `/corrections/${saved.id}`, { answer: 'Check the dispatch email.' })
    ).json()) as any).data

    expect(typeof edited.updatedAt).toBe('string')
  })

  it('refuses a change that would blank a field', async () => {
    const { memoryCorrections } = await import('../src/corrections.js')
    const handler = await api(memoryCorrections())

    const saved = ((await (
      await call(handler, 'POST', '/corrections', { question: 'where is my order?', answer: 'Check the tracking link.' })
    ).json()) as any).data

    // An empty answer replaces one that was at least wrong in a useful
    // direction, and an empty body asks for nothing at all.
    expect((await call(handler, 'PATCH', `/corrections/${saved.id}`, { answer: '  ' })).status).toBe(400)
    expect((await call(handler, 'PATCH', `/corrections/${saved.id}`, {})).status).toBe(400)
  })

  it('404s an edit to a correction that is not there', async () => {
    const { memoryCorrections } = await import('../src/corrections.js')
    const handler = await api(memoryCorrections())

    expect((await call(handler, 'PATCH', '/corrections/cor_nope', { answer: 'Anything.' })).status).toBe(404)
  })

  it('says plainly when the store cannot edit', async () => {
    // The interface publishes `update` as optional, so a store written against
    // its own database is free not to have one. Which of the two problems it
    // is matters: the correction exists, the editing does not.
    const cannotEdit = {
      list: async () => [],
      add: async (correction: unknown) => ({ ...(correction as object), id: 'cor_1', createdAt: '2026-01-01' }),
      remove: async () => true,
    }

    const handler = await api(cannotEdit as never)
    const response = await call(handler, 'PATCH', '/corrections/cor_1', { answer: 'Anything.' })

    expect(response.status).toBe(501)
    expect(((await response.json()) as any).error.code).toBe('not_supported')
  })
})

describe('what a correction costs on every turn', () => {
  // Wording that appears nowhere else in this file: the memo lives as long as
  // the module does, so a question another test already asked would have been
  // tokenised before this one runs.
  const stored = [
    { id: 'a', question: 'is the canvas holdall waterproof', answer: 'Showerproof, not waterproof.', createdAt: '2026-01-01' },
    { id: 'b', question: 'do you monogram a wallet', answer: 'Yes, three letters.', createdAt: '2026-01-01' },
  ]

  it('tokenises a stored correction once, whatever the customer asks', () => {
    vi.mocked(tokenize).mockClear()

    correctionFor('is the canvas holdall waterproof?', stored)
    correctionFor('do you monogram a wallet?', stored)
    correctionFor('how much is delivery?', stored)

    // Three turns and two corrections. Only the customer's own question is
    // new each time, and it is the only thing that has to be split again.
    for (const correction of stored) {
      const runs = vi.mocked(tokenize).mock.calls.filter(([text]) => text === correction.question)
      expect(runs, correction.question).toHaveLength(1)
    }
  })
})
