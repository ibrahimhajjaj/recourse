import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createAgent } from '../src/agent.js'
import type { KnowledgeIndex } from '../src/types.js'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

async function index(embedModel?: string): Promise<KnowledgeIndex> {
  const built = await buildIndex({
    sources: [
      textSource([
        { id: 'ship', title: 'Shipping', text: 'Delivery to the United States takes four to seven working days.' },
      ]),
    ],
  })

  // The index records what it was embedded with, and that is what the choice
  // is made from.
  return embedModel
    ? ({ ...built, vectors: { model: embedModel, dimensions: 3, rows: '', count: 0 } } as unknown as KnowledgeIndex)
    : built
}

/** A model that records every prompt it is asked to translate. */
function watcher(asked: string[]) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      asked.push(JSON.stringify(options.prompt))

      return { finishReason: { unified: 'stop', raw: 'stop' } as const, usage, content: [{ type: 'text' as const, text: 'delivery time' }], warnings: [] }
    },
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '0' },
          { type: 'text-delta' as const, id: '0', delta: 'Four to seven days.' },
          { type: 'text-end' as const, id: '0' },
          { type: 'finish' as const, finishReason: { unified: 'stop', raw: 'stop' } as const, usage },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  })
}

const ask = async (agent: ReturnType<typeof createAgent>, question: string) => {
  for await (const _ of agent.stream([{ role: 'user', content: question }])) void _
}

describe('searching content written in another language', () => {
  it('translates the search key for an English-centric embedder', async () => {
    // The case that started this: nomic-embed-text, an Arabic question, and an
    // English index that answers it in full.
    const asked: string[] = []
    const model = watcher(asked)

    await ask(
      createAgent({
        index: await index('nomic-embed-text'),
        model,
        classifier: false,
        embedder: false,
        searchLanguage: { language: 'English', model },
      }),
      'كم يستغرق التوصيل إلى لوس أنجلوس؟',
    )

    expect(asked.some((p) => p.includes('Translate'))).toBe(true)
  })

  it('spends nothing when the embedder already spans languages', async () => {
    // Translating first would pay for a call to arrive where retrieval is.
    const asked: string[] = []
    const model = watcher(asked)

    await ask(
      createAgent({
        index: await index('text-embedding-3-small'),
        model,
        classifier: false,
        embedder: false,
        searchLanguage: { language: 'English', model },
      }),
      'كم يستغرق التوصيل إلى لوس أنجلوس؟',
    )

    expect(asked.some((p) => p.includes('Translate'))).toBe(false)
  })

  it('translates nothing at all when the option is not set', async () => {
    const asked: string[] = []
    const model = watcher(asked)

    await ask(
      createAgent({ index: await index('nomic-embed-text'), model, classifier: false, embedder: false }),
      'كم يستغرق التوصيل؟',
    )

    expect(asked.some((p) => p.includes('Translate'))).toBe(false)
  })

  it('lets a caller override what the index says about its embedder', async () => {
    const asked: string[] = []
    const model = watcher(asked)

    await ask(
      createAgent({
        index: await index('some-in-house-multilingual-model'),
        model,
        classifier: false,
        embedder: false,
        searchLanguage: { language: 'English', model, multilingualEmbeddings: true },
      }),
      'كم يستغرق التوصيل؟',
    )

    expect(asked.some((p) => p.includes('Translate'))).toBe(false)
  })
})
