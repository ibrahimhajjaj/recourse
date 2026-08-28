import { describe, expect, it } from 'vitest'
import { createHelpPage } from '../src/api/helppage.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        {
          id: 'refunds',
          title: 'Refunds and returns',
          url: 'https://shop.example/refunds',
          text: '# Refunds\n\nWe refund any order within 30 days of delivery. Engraved items are final sale.',
        },
        {
          id: 'shipping',
          title: 'Shipping',
          text: '# Shipping\n\nOrders ship within two business days from the roastery in London.',
        },
        {
          id: 'xss',
          title: '<script>alert(1)</script>',
          text: '# Danger\n\nThis page title contains markup that must never be rendered as html.',
        },
      ]),
    ],
  })
  return cached
}

async function html(path: string, options: Record<string, unknown> = {}): Promise<string> {
  const handle = createHelpPage({ index: await index(), business: 'Lumen Coffee', ...options })
  return (await handle(new Request(`https://help.example${path}`))).text()
}

describe('the help page', () => {
  it('invites a search when there is no query', async () => {
    const page = await html('/')
    expect(page).toContain('Lumen Coffee')
    expect(page).toContain('Search the help pages')
    expect(page).toContain('<input type="search"')
  })

  it('answers a search from the same index the agent uses', async () => {
    const page = await html('/?q=refund+window')
    expect(page).toContain('Refunds and returns')
    expect(page).toContain('30 days')
  })

  it('links a result through to the real page', async () => {
    const page = await html('/?q=refund+window')
    expect(page).toContain('href="https://shop.example/refunds"')
  })

  it('says so plainly when nothing matched', async () => {
    const page = await html('/?q=quantum+chromodynamics')
    expect(page).toContain('Nothing matched')
  })

  it('groups several passages of one article into a single result', async () => {
    const page = await html('/?q=refund')
    // One heading for the refunds page, not one per chunk.
    expect(page.match(/Refunds and returns/g)?.length).toBe(1)
  })

  it('escapes content, so a page title cannot inject script', async () => {
    const page = await html('/?q=markup+html+title')
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;')
  })

  it('escapes the query itself, which comes straight from the url', async () => {
    const page = await html('/?q=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    expect(page).not.toContain('"><script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;')
  })

  it('caches the empty page but never a search', async () => {
    const handle = createHelpPage({ index: await index() })
    const empty = await handle(new Request('https://help.example/'))
    const search = await handle(new Request('https://help.example/?q=refund'))

    expect(empty.headers.get('cache-control')).toContain('public')
    expect(search.headers.get('cache-control')).toContain('no-store')
  })

  it('mounts the chat widget when an endpoint is given', async () => {
    const page = await html('/', { chatEndpoint: '/api/chat' })
    expect(page).toContain('data-endpoint="/api/chat"')
  })

  it('carries a description, since the point is being findable', async () => {
    expect(await html('/')).toContain('<meta name="description"')
  })

  it('refuses anything but GET', async () => {
    const handle = createHelpPage({ index: await index() })
    const response = await handle(new Request('https://help.example/', { method: 'POST' }))
    expect(response.status).toBe(405)
  })
})
