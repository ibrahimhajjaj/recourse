import { describe, expect, it, vi } from 'vitest'
import { notionSource, toMarkdown } from '../src/sources/notion.js'

describe('converting Notion blocks', () => {
  it('keeps headings, so chunking can split on them', () => {
    const markdown = toMarkdown([
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Refunds' }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'We refund within 30 days.' }] } },
    ])
    expect(markdown).toBe('# Refunds\n\nWe refund within 30 days.')
  })

  it('renders lists, quotes, code and checkboxes', () => {
    const markdown = toMarkdown([
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'One' }] } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'Two' }] } },
      { type: 'to_do', to_do: { rich_text: [{ plain_text: 'Three' }], checked: true } },
      { type: 'quote', quote: { rich_text: [{ plain_text: 'Four' }] } },
      { type: 'code', code: { rich_text: [{ plain_text: 'npm i' }], language: 'sh' } },
    ])

    expect(markdown).toContain('- One')
    expect(markdown).toContain('1. Two')
    expect(markdown).toContain('- [x] Three')
    expect(markdown).toContain('> Four')
    expect(markdown).toContain('```sh\nnpm i\n```')
  })

  it('carries inline formatting and links', () => {
    const markdown = toMarkdown([
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { plain_text: 'See ' },
            { plain_text: 'the policy', href: 'https://shop.example/policy' },
            { plain_text: ' now', annotations: { bold: true } },
          ],
        },
      },
    ])
    // The space stays outside the asterisks, or it is not bold at all.
    expect(markdown).toBe('See [the policy](https://shop.example/policy) **now**')
  })

  it('drops blocks with nothing to retrieve on', () => {
    expect(toMarkdown([{ type: 'image', image: {} }, { type: 'unsupported' }])).toBe('')
  })
})

describe('reading pages from Notion', () => {
  const original = globalThis.fetch

  function mock(handler: (url: string) => Response) {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => handler(String(url))) as unknown as typeof fetch
  }

  it('lists pages then reads each one', async () => {
    mock((url) => {
      if (url.endsWith('/search')) {
        return Response.json({
          results: [
            {
              id: 'page-1',
              url: 'https://notion.so/page-1',
              properties: { Name: { type: 'title', title: [{ plain_text: 'Refund policy' }] } },
            },
          ],
        })
      }
      return Response.json({
        results: [
          { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Refunds' }] } },
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'We refund any order within 30 days of delivery.' }] },
          },
        ],
      })
    })

    try {
      const documents = await notionSource({ token: 'secret_x' }).load({})
      expect(documents).toHaveLength(1)
      expect(documents[0]).toMatchObject({ title: 'Refund policy', url: 'https://notion.so/page-1' })
      expect(documents[0]?.text).toContain('# Refunds')
    } finally {
      globalThis.fetch = original
    }
  })

  it('sends the pinned api version, since Notion changes shapes between them', async () => {
    let headers: Headers | undefined
    globalThis.fetch = vi.fn(async (_url, init) => {
      headers = new Headers((init as RequestInit).headers)
      return Response.json({ results: [] })
    }) as unknown as typeof fetch

    try {
      await notionSource({ token: 'secret_x' }).load({})
      expect(headers?.get('notion-version')).toBe('2022-06-28')
      expect(headers?.get('authorization')).toBe('Bearer secret_x')
    } finally {
      globalThis.fetch = original
    }
  })

  it('skips a page the integration cannot read and keeps the rest', async () => {
    let call = 0
    mock((url) => {
      if (url.endsWith('/search')) {
        return Response.json({
          results: [
            { id: 'ok', properties: { Name: { type: 'title', title: [{ plain_text: 'Readable' }] } } },
            { id: 'no', properties: { Name: { type: 'title', title: [{ plain_text: 'Private' }] } } },
          ],
        })
      }
      call++
      if (url.includes('/blocks/no/')) return new Response('forbidden', { status: 403 })
      return Response.json({
        results: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'A readable page with enough text to index.' }] },
          },
        ],
      })
    })

    const messages: string[] = []
    try {
      const documents = await notionSource({ token: 'secret_x' }).load({
        onProgress: (event) => void messages.push(event.message),
      })
      expect(documents.map((d) => d.title)).toEqual(['Readable'])
      expect(messages.some((m) => m.includes('skipped Private'))).toBe(true)
      expect(call).toBeGreaterThan(1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('falls back to Untitled rather than failing on a page with no title', async () => {
    mock((url) =>
      url.endsWith('/search')
        ? Response.json({ results: [{ id: 'p', properties: {} }] })
        : Response.json({
            results: [
              {
                type: 'paragraph',
                paragraph: { rich_text: [{ plain_text: 'Long enough content here to clear the indexing threshold.' }] },
              },
            ],
          }),
    )

    try {
      const documents = await notionSource({ token: 'secret_x' }).load({})
      expect(documents[0]?.title).toBe('Untitled')
    } finally {
      globalThis.fetch = original
    }
  })
})
