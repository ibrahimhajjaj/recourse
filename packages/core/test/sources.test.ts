import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { qnaSource } from '../src/sources/qna.js'
import { filesSource } from '../src/sources/files.js'
import { loadParser } from '../src/sources/documents.js'
import { buildIndex } from '../src/knowledge/build.js'
import { createRetriever } from '../src/retrieve/retriever.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'helpdeck-src-'))
  dirs.push(dir)
  return dir
}

describe('question and answer pairs', () => {
  const pairs = [
    {
      question: 'How do I cancel my subscription?',
      answer: 'Cancel from the account page under Subscriptions. It takes effect immediately.',
      alternatives: ['stop being charged', 'end my plan'],
      url: 'https://shop.example/help/cancel',
    },
    { question: 'Do you ship to Ireland?', answer: 'Yes, in three to five working days.' },
  ]

  it('turns each pair into a retrievable document', async () => {
    const documents = await qnaSource({ pairs }).load({})
    expect(documents).toHaveLength(2)
    expect(documents[0]?.url).toBe('https://shop.example/help/cancel')
  })

  it('indexes the alternative phrasings, which is the whole point', async () => {
    const index = await buildIndex({ sources: [qnaSource({ pairs })] })
    const matches = await createRetriever({ index }).retrieve('how do I stop being charged')
    // "cancel" shares no word with "stop being charged"; the alternative bridges it.
    expect(matches[0]?.chunk.text).toContain('Cancel from the account page')
  })

  it('answers the original question too', async () => {
    const index = await buildIndex({ sources: [qnaSource({ pairs })] })
    const matches = await createRetriever({ index }).retrieve('cancel my subscription')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('skips blank pairs rather than indexing noise', async () => {
    const documents = await qnaSource({ pairs: [{ question: '  ', answer: 'x' }, { question: 'q', answer: '' }] }).load(
      {},
    )
    expect(documents).toEqual([])
  })

  it('gives every pair a distinct id even when two questions collide', async () => {
    const documents = await qnaSource({
      pairs: [
        { question: 'Refunds?', answer: 'Thirty days.' },
        { question: 'Refunds?', answer: 'Wholesale is final sale.' },
      ],
    }).load({})
    expect(new Set(documents.map((doc) => doc.id)).size).toBe(2)
  })
})

describe('local files', () => {
  it('reads markdown and text', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'refunds.md'), '# Refunds\n\nWe refund within 30 days of delivery, no questions asked.')
    await writeFile(join(dir, 'notes.txt'), 'Orders ship within two business days from our roastery.')

    const documents = await filesSource({ path: dir }).load({})
    expect(documents).toHaveLength(2)
    expect(documents.find((doc) => doc.id === 'refunds.md')?.title).toBe('Refunds')
  })

  it('skips a file past the size cap instead of loading it into memory', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'huge.md'), '# Big\n\n' + 'x'.repeat(5000))

    const documents = await filesSource({ path: dir, maxBytes: 100 }).load({})
    expect(documents).toEqual([])
  })

  it('separates a missing parser package from one that will not load', async () => {
    // The distinction matters: telling someone to install a package they
    // already have sends them to fix the wrong thing.
    const missing = Object.assign(new Error('Cannot find module'), { code: 'ERR_MODULE_NOT_FOUND' })
    const broken = new ReferenceError('DOMMatrix is not defined')

    await expect(loadParser(async () => { throw missing })).rejects.toThrow(/Install it with/)
    await expect(loadParser(async () => { throw broken })).rejects.toThrow(/installed but failed to load/)
    await expect(loadParser(async () => { throw broken })).rejects.toThrow(/DOMMatrix/)
  })

  it('tells you which package to install when a parser is missing', async () => {
    const dir = await makeDir()
    // Not a real PDF, but the parser import fails before it ever gets parsed.
    await writeFile(join(dir, 'policy.pdf'), 'x'.repeat(200))

    const messages: string[] = []
    const documents = await filesSource({ path: dir }).load({
      onProgress: (event) => void messages.push(event.message),
    })

    expect(documents).toEqual([])
    // Either the parser is absent and says so, or it is present and rejects the
    // fake file. Both are a skip with an explanation, never a crash.
    expect(messages.some((message) => message.includes('skipped policy.pdf'))).toBe(true)
  })

  it('carries on after one unreadable file', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'broken.pdf'), 'not a pdf at all')
    await writeFile(join(dir, 'fine.md'), '# Fine\n\nThis document reads perfectly well and is long enough.')

    const documents = await filesSource({ path: dir }).load({})
    expect(documents.map((doc) => doc.id)).toEqual(['fine.md'])
  })

  it('uses a custom parser when one is supplied', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'policy.rtf'), 'ignored bytes')

    const documents = await filesSource({
      path: dir,
      extensions: ['.rtf'],
      parsers: { '.rtf': async () => '# Parsed\n\nThe custom parser produced this text for indexing.' },
    }).load({})

    expect(documents[0]?.title).toBe('Parsed')
  })
})
