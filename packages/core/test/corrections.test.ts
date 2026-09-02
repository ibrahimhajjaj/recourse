import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { correctionFor, memoryCorrections } from '../src/corrections.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex } from '../src/types.js'

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
})
