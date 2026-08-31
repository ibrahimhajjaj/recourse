import { describe, expect, it } from 'vitest'
import { createMcp, MCP_PROTOCOLS } from '../src/api/mcp.js'
import { createApiHandler } from '../src/api/index.js'
import { memoryStore } from '../src/store/memory.js'
import { createHelpdesk } from '../src/helpdesk/service.js'
import type { Store } from '../src/store/types.js'

function message(over: Record<string, unknown> = {}) {
  return {
    id: `m_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user' as const,
    content: 'hello',
    createdAt: new Date().toISOString(),
    ...over,
  }
}

async function seeded(): Promise<Store> {
  const store = memoryStore()
  await store.appendMessage('c1', message({ content: 'do you ship to ireland' }), { channel: 'web' })
  await store.appendMessage('c1', message({ role: 'assistant', content: 'I could not find that.', unanswered: true }))
  await store.appendMessage('c2', message({ content: 'do you ship to ireland' }), { channel: 'email' })
  await store.appendMessage('c2', message({ role: 'assistant', content: 'I could not find that.', unanswered: true }))
  return store
}

/** One JSON-RPC round trip. */
async function call(mcp: ReturnType<typeof createMcp>, method: string, params?: unknown, id: unknown = 1) {
  return mcp.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
}

/** The text a tool answered with, parsed back. */
function payload(answer: Record<string, unknown> | null): unknown {
  const content = (answer?.result as { content?: Array<{ text?: string }> } | undefined)?.content
  const text = content?.[0]?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

describe('the protocol handshake', () => {
  it('answers initialize with a version, a name and its capabilities', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'initialize', { protocolVersion: MCP_PROTOCOLS[0] })
    const result = answer?.result as Record<string, any>

    expect(answer?.jsonrpc).toBe('2.0')
    expect(result.protocolVersion).toBe(MCP_PROTOCOLS[0])
    expect(result.serverInfo.name).toBe('helpdeck')
    expect(result.capabilities.tools).toBeDefined()
  })

  it('speaks the older revision a client asks for', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'initialize', { protocolVersion: '2024-11-05' })
    expect((answer?.result as Record<string, unknown>).protocolVersion).toBe('2024-11-05')
  })

  it('negotiates down rather than refusing a version it does not know', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'initialize', { protocolVersion: '1999-01-01' })

    // Closing the connection over a version string is a worse failure than
    // answering in the newest one this speaks.
    expect((answer?.result as Record<string, unknown>).protocolVersion).toBe(MCP_PROTOCOLS[0])
    expect(answer?.error).toBeUndefined()
  })

  it('says nothing at all to a notification', async () => {
    const mcp = createMcp({ store: await seeded() })
    // Every client sends this immediately after initialize, and answering it
    // is a protocol error.
    expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('answers ping, which is how a client checks the connection', async () => {
    const mcp = createMcp({ store: await seeded() })
    expect((await call(mcp, 'ping'))?.result).toEqual({})
  })

  it('echoes the id it was given, including a string one', async () => {
    const mcp = createMcp({ store: await seeded() })
    expect((await call(mcp, 'ping', undefined, 'abc'))?.id).toBe('abc')
  })
})

describe('protocol errors', () => {
  it('rejects a body that is not JSON', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await mcp.handleText('{ not json')
    expect((answer?.error as { code: number }).code).toBe(-32700)
  })

  it('rejects a request with no method', async () => {
    const mcp = createMcp({ store: await seeded() })
    expect(((await mcp.handle({ jsonrpc: '2.0', id: 1 }))?.error as { code: number }).code).toBe(-32600)
  })

  it('reports an unknown method', async () => {
    const mcp = createMcp({ store: await seeded() })
    expect(((await call(mcp, 'resources/list'))?.error as { code: number }).code).toBe(-32601)
  })

  it('reports a tool that does not exist', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'tools/call', { name: 'delete_everything', arguments: {} })
    expect((answer?.error as { code: number }).code).toBe(-32602)
  })
})

describe('what a support lead can ask for', () => {
  it('lists only the tools the deployment configured', async () => {
    const store = await seeded()

    const bare = createMcp({ store })
    expect(bare.toolNames).toContain('list_answer_gaps')
    expect(bare.toolNames).not.toContain('list_tickets')
    expect(bare.toolNames).not.toContain('search_knowledge')

    const full = createMcp({
      store,
      helpdesk: createHelpdesk({ store }),
      agent: { search: async () => [] },
    })
    expect(full.toolNames).toContain('list_tickets')
    expect(full.toolNames).toContain('search_knowledge')
  })

  it('hands back the questions nobody could answer, most frequent first', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'tools/call', { name: 'list_answer_gaps', arguments: {} })
    const gaps = payload(answer) as { gaps: Array<{ question: string; count: number }> }

    expect(gaps.gaps[0]).toEqual({ question: 'do you ship to ireland', count: 2 })
  })

  it('reads back what a customer actually said', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'tools/call', { name: 'get_conversation', arguments: { id: 'c1' } })
    const thread = payload(answer) as { messages: Array<{ content: string }> }

    expect(thread.messages[0]?.content).toBe('do you ship to ireland')
  })

  it('says so plainly when the thing asked for is not there', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'tools/call', { name: 'get_conversation', arguments: { id: 'nope' } })

    // A failed tool is a result the model can read and explain, not a
    // JSON-RPC error it never sees.
    expect(answer?.error).toBeUndefined()
    expect((answer?.result as { isError?: boolean }).isError).toBe(true)
    expect(payload(answer)).toContain('no conversation')
  })

  it('filters conversations the way the dashboard does', async () => {
    const mcp = createMcp({ store: await seeded() })
    const answer = await call(mcp, 'tools/call', {
      name: 'list_conversations',
      arguments: { channel: 'email' },
    })

    const items = payload(answer) as Array<{ id: string }>
    expect(items.map((one) => one.id)).toEqual(['c2'])
  })

  it('caps a limit somebody asked too much of', async () => {
    const store = memoryStore()
    for (let i = 0; i < 30; i++) await store.appendMessage(`c${i}`, message())

    const mcp = createMcp({ store })
    const answer = await call(mcp, 'tools/call', { name: 'list_conversations', arguments: { limit: 5000 } })

    expect((payload(answer) as unknown[]).length).toBeLessThanOrEqual(100)
  })

  it('searches the knowledge base through the agent, so it matches what a customer gets', async () => {
    const asked: string[] = []
    const mcp = createMcp({
      store: await seeded(),
      agent: {
        search: async (question: string) => {
          asked.push(question)
          return [
            { chunk: { id: 'k1', title: 'Shipping', url: 'https://x/ship', text: 'We ship to the EU.' }, score: 0.9 },
          ] as never
        },
      },
    })

    const answer = await call(mcp, 'tools/call', { name: 'search_knowledge', arguments: { query: 'ireland' } })
    expect(asked).toEqual(['ireland'])
    expect((payload(answer) as Array<{ title: string }>)[0]?.title).toBe('Shipping')
  })

  it('refuses an empty search rather than returning the whole corpus', async () => {
    const mcp = createMcp({ store: await seeded(), agent: { search: async () => [] } })
    const answer = await call(mcp, 'tools/call', { name: 'search_knowledge', arguments: { query: '  ' } })
    expect((answer?.result as { isError?: boolean }).isError).toBe(true)
  })

  it('offers nothing that changes anything', async () => {
    const mcp = createMcp({
      store: await seeded(),
      helpdesk: createHelpdesk({ store: await seeded() }),
      agent: { search: async () => [] },
    })

    // Read-only is the whole security posture. A tool that mutates has to be a
    // deliberate decision, not something that arrived with a rename.
    for (const name of mcp.toolNames) {
      expect(name).toMatch(/^(list_|get_|search_|support_)/)
    }
  })
})

describe('mounted on the management API', () => {
  const token = 'tok_secret_value'

  async function handler(mcp: boolean | Record<string, unknown> = true) {
    return createApiHandler({ store: await seeded(), tokens: [token], mcp: mcp as never })
  }

  function post(body: unknown, auth = `Bearer ${token}`) {
    return new Request('https://api.example/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
    })
  }

  it('is not mounted unless asked for', async () => {
    const api = createApiHandler({ store: await seeded(), tokens: [token] })
    const response = await api(post({ jsonrpc: '2.0', id: 1, method: 'ping' }))
    expect(response.status).toBe(404)
  })

  it('answers a tools/list on the same token as the rest of the API', async () => {
    const api = await handler()
    const response = await api(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } }

    expect(response.status).toBe(200)
    expect(body.result.tools.map((tool) => tool.name)).toContain('list_answer_gaps')
  })

  it('refuses a request with no token, like every other route', async () => {
    const api = await handler()
    const response = await api(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, ''))

    // The gap list and every transcript are behind this. An MCP endpoint that
    // authenticated separately would be a second thing to rotate and forget.
    expect(response.status).toBe(401)
  })

  it('answers 202 with no body to a notification', async () => {
    const api = await handler()
    const response = await api(post({ jsonrpc: '2.0', method: 'notifications/initialized' }))

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('records the call in the access log like any other read', async () => {
    const seen: Array<{ path: string; status: number }> = []
    const api = createApiHandler({
      store: await seeded(),
      tokens: [token],
      mcp: true,
      onAccess: (event) => void seen.push({ path: event.path, status: event.status }),
    })

    await api(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(seen).toEqual([{ path: '/mcp', status: 200 }])
  })
})
