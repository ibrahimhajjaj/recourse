import { describe, expect, it, vi } from 'vitest'
import type { AccessEvent } from '../src/api/index.js'
import { createApiHandler } from '../src/api/index.js'
import { createHelpdesk } from '../src/helpdesk/index.js'
import { memoryStore } from '../src/store/index.js'
import type { Store } from '../src/store/index.js'

function setup(options: { tokens?: string[]; withHelpdesk?: boolean; basePath?: string } = {}) {
  const store: Store = memoryStore()
  const helpdesk =
    options.withHelpdesk === false
      ? undefined
      : createHelpdesk({
          store,
          teams: [{ id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example'] }],
        })

  const handle = createApiHandler({ store, helpdesk, tokens: options.tokens, basePath: options.basePath })
  return { store, helpdesk, handle }
}

function get(path: string, token?: string): Request {
  return new Request(`https://api.example${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

function send(method: string, path: string, body: unknown, token?: string): Request {
  return new Request(`https://api.example${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function bodyOf(response: Response): Promise<any> {
  return response.json()
}

describe('routing and shape', () => {
  it('answers a health check', async () => {
    const { handle } = setup()
    const response = await handle(get('/health'))
    expect(response.status).toBe(200)
    expect((await bodyOf(response)).data.status).toBe('ok')
  })

  it('404s an unknown route with a code a client can branch on', async () => {
    const { handle } = setup()
    const response = await handle(get('/nope'))
    expect(response.status).toBe(404)
    expect((await bodyOf(response)).error.code).toBe('not_found')
  })

  it('does not confuse two routes of the same shape', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {} })

    const ticket = await handle(get('/helpdesk/tickets/1'))
    const messages = await handle(get('/helpdesk/tickets/1/messages'))

    expect((await bodyOf(ticket)).data.ticketNumber).toBe(1)
    expect(Array.isArray((await bodyOf(messages)).data)).toBe(true)
  })

  it('serves from a mount prefix', async () => {
    const { handle } = setup({ basePath: '/api/v1' })
    expect((await handle(get('/api/v1/health'))).status).toBe(200)
  })

  it('answers a preflight without a token', async () => {
    const { handle } = setup({ tokens: ['secret'] })
    const response = await handle(new Request('https://api.example/health', { method: 'OPTIONS' }))
    expect(response.status).toBe(204)
  })
})

describe('authentication', () => {
  it('refuses a request with no token when tokens are configured', async () => {
    const { handle } = setup({ tokens: ['secret'] })
    const response = await handle(get('/health'))
    expect(response.status).toBe(401)
  })

  it('refuses the wrong token', async () => {
    const { handle } = setup({ tokens: ['secret'] })
    expect((await handle(get('/health', 'guess'))).status).toBe(401)
  })

  it('accepts the right one', async () => {
    const { handle } = setup({ tokens: ['secret'] })
    expect((await handle(get('/health', 'secret'))).status).toBe(200)
  })

  it('is open when no tokens are configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await setup().handle(get('/health'))).status).toBe(200)
    warn.mockRestore()
  })

  // Open is a legitimate choice behind a private network and a catastrophe
  // anywhere else, and the difference is invisible from inside the process.
  it('says so out loud when it is mounted with no tokens', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup()

    expect(warn).toHaveBeenCalledTimes(1)
    const said = String(warn.mock.calls[0]?.[0])
    expect(said).toContain('no tokens')
    expect(said).toContain('every conversation, lead and ticket')
    warn.mockRestore()
  })

  it('stays quiet when tokens are configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup({ tokens: ['secret'] })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('accepts any of several, so a token can be rotated without an outage', async () => {
    const { handle } = setup({ tokens: ['old', 'new'] })
    expect((await handle(get('/health', 'old'))).status).toBe(200)
    expect((await handle(get('/health', 'new'))).status).toBe(200)
  })

  // Length is the one thing a constant-time compare is allowed to leak, and
  // these are the shapes that a `startsWith` or an early return would let in.
  it('refuses a token that is only a prefix of a real one', async () => {
    const { handle } = setup({ tokens: ['secret'] })
    expect((await handle(get('/health', 'sec'))).status).toBe(401)
    expect((await handle(get('/health', 'secretly'))).status).toBe(401)
  })

  it('refuses an empty bearer', async () => {
    const { handle } = setup({ tokens: ['secret'] })
    const response = await handle(
      new Request('https://api.example/health', { headers: { authorization: 'Bearer ' } }),
    )
    expect(response.status).toBe(401)
  })
})

describe('conversations', () => {
  async function seeded() {
    const { store, handle } = setup()
    await store.appendMessage('c1', {
      id: 'm1',
      role: 'user',
      content: 'do you sell tea',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    await store.appendMessage('c1', {
      id: 'm2',
      role: 'assistant',
      content: 'I cannot find that',
      createdAt: '2026-01-01T00:00:01.000Z',
      unanswered: true,
    })
    await store.appendMessage('c2', {
      id: 'm3',
      role: 'user',
      content: 'refunds?',
      createdAt: '2026-02-01T00:00:00.000Z',
    })
    return { store, handle }
  }

  it('lists them newest first', async () => {
    const { handle } = await seeded()
    const data = (await bodyOf(await handle(get('/conversations')))).data
    expect(data[0].id).toBe('c2')
  })

  it('filters to the ones the agent could not answer', async () => {
    const { handle } = await seeded()
    const data = (await bodyOf(await handle(get('/conversations?unanswered=true')))).data
    expect(data.map((c: any) => c.id)).toEqual(['c1'])
  })

  it('returns a transcript with its messages', async () => {
    const { handle } = await seeded()
    const data = (await bodyOf(await handle(get('/conversations/c1')))).data
    expect(data.messages).toHaveLength(2)
  })

  it('404s an unknown conversation', async () => {
    const { handle } = await seeded()
    expect((await handle(get('/conversations/nope'))).status).toBe(404)
  })

  it('records feedback on a message', async () => {
    const { store, handle } = await seeded()
    const response = await handle(send('PATCH', '/conversations/c1/messages/m2/feedback', { feedback: 'negative' }))

    expect(response.status).toBe(200)
    const found = await store.getConversation('c1')
    expect(found?.messages[1]?.feedback).toBe('negative')
  })

  it('rejects a feedback value it does not understand', async () => {
    const { handle } = await seeded()
    const response = await handle(send('PATCH', '/conversations/c1/messages/m2/feedback', { feedback: 'meh' }))
    expect(response.status).toBe(400)
  })

  it('404s feedback on a message that is not in that conversation', async () => {
    const { handle } = await seeded()
    const response = await handle(send('PATCH', '/conversations/c1/messages/m3/feedback', { feedback: 'positive' }))
    expect(response.status).toBe(404)
  })

  it('reports the gaps worth writing content for', async () => {
    const { handle } = await seeded()
    const stats = (await bodyOf(await handle(get('/stats')))).data
    expect(stats.unanswered).toBe(1)
    expect(stats.topGaps[0].question).toBe('do you sell tea')
  })

  it('reports whether conversations ended, not just that they replied', async () => {
    const { handle } = await seeded()
    const report = (await bodyOf(await handle(get('/outcomes')))).data

    expect(report.conversations).toBe(2)
    expect(report.unanswered).toBe(1)
  })

  it('takes the return window from the query string', async () => {
    const { handle } = await seeded()
    const response = await handle(get('/outcomes?days=30'))

    expect(response.status).toBe(200)
    expect((await bodyOf(response)).data.conversations).toBe(2)
  })

  it('ignores a return window that is not a number', async () => {
    const { handle } = await seeded()

    // A query parameter nobody can parse falls back to the default window. A
    // read-only report answering 400 because somebody typed the flag wrong
    // gives the reader nothing they can act on.
    expect((await handle(get('/outcomes?days=nonsense'))).status).toBe(200)
  })
})

describe('the ticket queue', () => {
  it('opens a ticket and routes it', async () => {
    const { handle } = setup()
    const response = await handle(
      send('POST', '/helpdesk/tickets', {
        subject: 'Damaged bag',
        description: 'It arrived split open.',
        customer: { email: 'sam@example.com' },
      }),
    )

    expect(response.status).toBe(201)
    const ticket = (await bodyOf(response)).data
    expect(ticket.ticketNumber).toBe(1)
    expect(ticket.teamId).toBe('support')
    expect(ticket.assigneeId).toBe('ana@shop.example')
  })

  it('refuses a ticket with nothing in it', async () => {
    const { handle } = setup()
    expect((await handle(send('POST', '/helpdesk/tickets', { subject: '  ' }))).status).toBe(400)
  })

  it('lists unclaimed work', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {}, teamId: 'nobody' })
    const data = (await bodyOf(await handle(get('/helpdesk/tickets?assigneeId=none')))).data
    expect(data).toHaveLength(1)
  })

  it('moves a ticket through its statuses', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {} })

    const response = await handle(send('PATCH', '/helpdesk/tickets/1', { statusCategory: 'closed' }))
    expect((await bodyOf(response)).data.statusCategory).toBe('closed')
  })

  it('rejects a status that does not exist', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {} })
    expect((await handle(send('PATCH', '/helpdesk/tickets/1', { statusId: 'invented' }))).status).toBe(400)
  })

  it('posts an agent reply and hands the ball to the customer', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {} })

    const response = await handle(
      send('POST', '/helpdesk/tickets/1/messages', { content: 'Refunded, sorry about that.', authorName: 'Ana' }),
    )

    expect(response.status).toBe(201)
    expect((await helpdesk!.getTicket(1))?.statusCategory).toBe('on_customer')
  })

  it('keeps an internal note off the customer clock', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {} })
    await handle(send('POST', '/helpdesk/tickets/1/messages', { type: 'note', content: 'Asked the roastery.' }))
    expect((await helpdesk!.getTicket(1))?.statusCategory).toBe('new')
  })

  it('searches the queue', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'Refund for LUM-1', description: 'charged twice', customer: {} })
    await helpdesk!.openTicket({ subject: 'Grind advice', description: 'french press', customer: {} })

    const data = (await bodyOf(await handle(send('POST', '/helpdesk/tickets/search', { query: 'charged twice' })))).data
    expect(data).toHaveLength(1)
  })

  it('lists teams with their size', async () => {
    const { handle } = setup()
    const data = (await bodyOf(await handle(get('/helpdesk/teams')))).data
    expect(data[0]).toMatchObject({ id: 'support', memberCount: 1 })
  })

  it('says so plainly when no help desk is configured', async () => {
    const { handle } = setup({ withHelpdesk: false })
    const response = await handle(get('/helpdesk/tickets'))
    expect(response.status).toBe(501)
    expect((await bodyOf(response)).error.code).toBe('helpdesk_disabled')
  })

  it('404s a ticket that does not exist', async () => {
    expect((await setup().handle(get('/helpdesk/tickets/999'))).status).toBe(404)
  })

  it('rejects a ticket number that is not a number', async () => {
    expect((await setup().handle(get('/helpdesk/tickets/abc'))).status).toBe(400)
  })
})

describe('error handling', () => {
  it('rejects a malformed JSON body', async () => {
    const { handle } = setup()
    const response = await handle(
      new Request('https://api.example/helpdesk/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(response.status).toBe(400)
  })

  it('never leaks an internal error to the client', async () => {
    const store = memoryStore()
    store.listConversations = async () => {
      throw new Error('the database is on fire at /srv/db.js:12')
    }

    const handle = createApiHandler({ store })
    const response = await handle(get('/conversations'))

    expect(response.status).toBe(500)
    const body = await bodyOf(response)
    expect(JSON.stringify(body)).not.toContain('srv/db.js')
  })

  it('answers in its own shape when the path itself cannot be decoded', async () => {
    const { handle } = setup()

    // `%E0%A4%A` is a truncated escape. The router decodes every `:param`
    // segment, so this throws inside the match rather than inside a handler,
    // and before this it left the API entirely and the host framework
    // answered with its own error page.
    const response = await handle(get('/conversations/%E0%A4%A'))

    expect(response.status).toBe(500)
    expect((await bodyOf(response)).error.code).toBe('internal_error')
  })
})

describe('saved views and drafts over the api', () => {
  it('lists the saved views', async () => {
    const { handle } = setup()
    const data = (await bodyOf(await handle(get('/helpdesk/views')))).data
    expect(data.map((view: any) => view.id)).toContain('unassigned')
  })

  it('runs a view as a queue', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {}, teamId: 'nobody' })

    const data = (await bodyOf(await handle(get('/helpdesk/views/unassigned')))).data
    expect(data).toHaveLength(1)
  })

  it('404s a view that does not exist', async () => {
    const { handle } = setup()
    expect((await handle(get('/helpdesk/views/invented'))).status).toBe(404)
  })

  it('explains that drafting needs an agent, rather than failing opaquely', async () => {
    const { handle, helpdesk } = setup()
    await helpdesk!.openTicket({ subject: 'a', description: 'b', customer: {} })

    const response = await handle(send('POST', '/helpdesk/tickets/1/draft', {}))
    expect(response.status).toBe(501)
    expect((await bodyOf(response)).error.code).toBe('drafting_unavailable')
  })
})

describe('managing sources over the api', () => {
  async function withKnowledge() {
    const { createKnowledgeBase } = await import('../src/knowledge/base.js')
    const store = memoryStore()
    const knowledge = createKnowledgeBase({ store })
    const { createApiHandler } = await import('../src/api/index.js')
    return { knowledge, handle: createApiHandler({ store, knowledge }) }
  }

  it('adds a source and reports it needs training', async () => {
    const { handle } = await withKnowledge()

    const created = await handle(
      send('POST', '/sources', { type: 'text', name: 'Refunds', content: 'We refund within 30 days.' }),
    )
    expect(created.status).toBe(201)

    const summary = (await bodyOf(await handle(get('/sources/summary')))).data
    expect(summary.needsRetrain).toBe(true)
    expect(summary.total.count).toBe(1)
  })

  it('rejects a source that could never be retrieved', async () => {
    const { handle } = await withKnowledge()
    expect((await handle(send('POST', '/sources', { type: 'text', name: 'Empty' }))).status).toBe(400)
  })

  it('rejects a link that would read the server’s own disk', async () => {
    const { handle } = await withKnowledge()
    const response = await handle(
      send('POST', '/sources', { type: 'link', name: 'Bad', url: 'file:///etc/passwd' }),
    )
    expect(response.status).toBe(400)
  })

  it('trains and reports what was built', async () => {
    const { handle } = await withKnowledge()
    await handle(send('POST', '/sources', { type: 'text', name: 'Refunds', content: 'We refund within 30 days.' }))

    const trained = (await bodyOf(await handle(send('POST', '/train', {})))).data
    expect(trained.chunks).toBeGreaterThan(0)

    const summary = (await bodyOf(await handle(get('/sources/summary')))).data
    expect(summary.needsRetrain).toBe(false)
  })

  it('soft deletes and restores', async () => {
    const { handle } = await withKnowledge()
    const created = (await bodyOf(
      await handle(send('POST', '/sources', { type: 'text', name: 'Old', content: 'Outdated text here.' })),
    )).data

    const deleted = await handle(
      new Request(`https://api.example/sources/${created.id}`, { method: 'DELETE' }),
    )
    expect((await bodyOf(deleted)).data.status).toBe('pending_deletion')

    const restored = await handle(send('POST', `/sources/${created.id}/restore`, {}))
    expect((await bodyOf(restored)).data.status).toBe('active')
  })

  it('404s a source that is not there', async () => {
    const { handle } = await withKnowledge()
    expect((await handle(get('/sources/src_text_nope'))).status).toBe(404)
  })

  it('says so plainly when sources are managed at build time', async () => {
    const { handle } = setup()
    const response = await handle(get('/sources'))
    expect(response.status).toBe(501)
    expect((await bodyOf(response)).error.code).toBe('knowledge_disabled')
  })
})

describe('the admin page', () => {
  it('is off unless asked for, because it shows every transcript', async () => {
    const { handle } = setup()
    expect((await handle(get('/admin'))).status).toBe(404)
  })

  it('serves a self-contained page when enabled', async () => {
    const store = memoryStore()
    const { createApiHandler } = await import('../src/api/index.js')
    const handle = createApiHandler({ store, admin: true })

    const response = await handle(get('/admin'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const html = await response.text()

    // No build step and nothing fetched from a CDN: one file, on your origin.
    // Checked on the markup only. The page's own program builds a script tag
    // as text for the operator to copy, and searching the whole document finds
    // that string and calls it a dependency.
    const markup = html.replace(/<script type="module">[\s\S]*?<\/script>/, '')
    expect(markup, 'the admin page loads an external script').not.toMatch(/<script[^>]+src=/)

    // The one exception, and it is deliberate: opening the Widget tab injects
    // the very script tag it is telling you to paste, so the preview is the
    // real widget rather than a drawing of one.
    expect(html).toContain("'/admin/preview?'")
    expect(html).toContain('Answer gaps')
  })

  it('sits behind the same token as everything else', async () => {
    const store = memoryStore()
    const { createApiHandler } = await import('../src/api/index.js')
    const handle = createApiHandler({ store, admin: true, tokens: ['secret'] })

    expect((await handle(get('/admin'))).status).toBe(401)
    expect((await handle(get('/admin', 'secret'))).status).toBe(200)
  })

  it('takes the token from the query, because a browser cannot send a header', async () => {
    const store = memoryStore()
    const handle = createApiHandler({ store, admin: true, tokens: ['secret'] })

    expect((await handle(get('/admin?token=secret'))).status).toBe(200)
    expect((await handle(get('/admin/preview?token=secret'))).status).toBe(200)
    expect((await handle(get('/admin?token=wrong'))).status).toBe(401)
  })

  it('does not send the token onward as a referer', async () => {
    const handle = createApiHandler({ store: memoryStore(), admin: true, tokens: ['secret'] })
    const response = await handle(get('/admin?token=secret'))

    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('reads a query token nowhere else', async () => {
    const handle = createApiHandler({ store: memoryStore(), admin: true, tokens: ['secret'] })

    // Everything but the two pages is called by script, which can set a
    // header, so nothing else pays the cost of a credential in a URL.
    expect((await handle(get('/conversations?token=secret'))).status).toBe(401)
    expect((await handle(get('/stats?token=secret'))).status).toBe(401)
  })

  it('ignores a query token when no admin page is served', async () => {
    const handle = createApiHandler({ store: memoryStore(), tokens: ['secret'] })

    expect((await handle(get('/admin?token=secret'))).status).toBe(401)
  })
})

/**
 * The record of who read what.
 *
 * Three regimes ask for it and none can be satisfied afterwards, so the thing
 * worth testing is that it fires on the refusals too, and that a bearer token
 * never reaches whatever writes the log.
 */
describe('the access log', () => {
  const TOKEN = 'sk-management-abcdefghijklmnop'

  function watched() {
    const seen: AccessEvent[] = []
    const { store } = setup()
    const handle = createApiHandler({ store, tokens: [TOKEN], onAccess: (event) => void seen.push(event) })
    return { handle, seen }
  }

  it('records a read, and names the credential without printing it', async () => {
    const { handle, seen } = watched()

    await handle(get('/conversations', TOKEN))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe('/conversations')
    expect(seen[0]?.status).toBe(200)
    expect(seen[0]?.method).toBe('GET')
    expect(seen[0]?.actor).toMatch(/^[0-9a-f]{12}$/)

    // The whole point of a fingerprint. A log file holding bearer tokens is
    // how bearer tokens get out.
    expect(JSON.stringify(seen)).not.toContain(TOKEN)
  })

  it('records the attempt that was turned away', async () => {
    const { handle, seen } = watched()

    await handle(get('/conversations', 'sk-not-the-token'))

    expect(seen[0]?.status).toBe(401)
    // Fingerprinted too, so repeated attempts on one wrong credential group
    // together instead of looking like many.
    expect(seen[0]?.actor).toMatch(/^[0-9a-f]{12}$/)
  })

  it('gives the same credential the same name every time', async () => {
    const { handle, seen } = watched()

    await handle(get('/conversations', TOKEN))
    await handle(get('/leads', TOKEN))

    expect(seen[0]?.actor).toBe(seen[1]?.actor)
  })

  it('keeps answering when the log throws', async () => {
    const { store } = setup()
    const handle = createApiHandler({
      store,
      tokens: [TOKEN],
      onAccess: () => {
        throw new Error('the log is full')
      },
    })

    // Refusing to answer because an audit sink is down is not the safer
    // failure: it takes the whole API out for a logging problem.
    expect((await handle(get('/conversations', TOKEN))).status).toBe(200)
  })

  it('says nothing when nobody asked for it', async () => {
    const { store } = setup()
    const handle = createApiHandler({ store, tokens: [TOKEN] })
    expect((await handle(get('/conversations', TOKEN))).status).toBe(200)
  })
})

describe('exporting conversations', () => {
  /** Three threads, one of them somebody else's. */
  async function seeded(store: Store) {
    for (const [id, contact] of [
      ['c1', { id: 'u_sam' }],
      ['c2', { id: 'u_sam' }],
      ['c3', { id: 'u_ada' }],
    ] as const) {
      await store.appendMessage(
        id,
        { id: `m_${id}_1`, role: 'user', content: `question on ${id}`, createdAt: new Date().toISOString() },
        { channel: 'web', contact },
      )
      await store.appendMessage(id, {
        id: `m_${id}_2`,
        role: 'assistant',
        content: `answer on ${id}`,
        createdAt: new Date().toISOString(),
      })
    }
  }

  it('hands back whole transcripts, not a list of rows', async () => {
    // The point of the endpoint: the alternative is one request per thread.
    const { store, handle } = setup()
    await seeded(store)

    const body = await bodyOf(await handle(get('/conversations/export')))

    expect(body.data).toHaveLength(3)
    expect(body.data[0].messages.map((message: { content: string }) => message.content)).toEqual([
      expect.stringContaining('question on'),
      expect.stringContaining('answer on'),
    ])
  })

  it('is not mistaken for a conversation called "export"', async () => {
    const { store, handle } = setup()
    await seeded(store)

    expect((await handle(get('/conversations/export'))).status).toBe(200)
    expect((await handle(get('/conversations/c1'))).status).toBe(200)
  })

  it('filters and pages like the list does', async () => {
    const { store, handle } = setup()
    await seeded(store)

    const mine = await bodyOf(await handle(get('/conversations/export?contactId=u_sam')))
    expect(mine.data.map((one: { id: string }) => one.id).sort()).toEqual(['c1', 'c2'])

    const first = await bodyOf(await handle(get('/conversations/export?limit=1')))
    expect(first.data).toHaveLength(1)
    expect(first.pagination.cursor).toBeTruthy()
  })

  it('caps the page, since each item is a whole transcript', async () => {
    const { store, handle } = setup()
    for (let index = 0; index < 25; index++) {
      await store.appendMessage(
        `c${index}`,
        { id: `m${index}`, role: 'user', content: 'hello', createdAt: new Date().toISOString() },
        { channel: 'web' },
      )
    }

    const body = await bodyOf(await handle(get('/conversations/export?limit=500')))
    expect(body.data).toHaveLength(20)
  })
})
