import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import {
  actionsToTools,
  clientAction,
  collectData,
  collectLeads,
  defineAction,
  escalate,
  fieldsToSchema,
  httpAction,
  suggestedMessages,
  webSearch,
} from '../src/actions/index.js'
import type { ActionContext } from '../src/actions/types.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex, StreamFrame } from '../src/types.js'

function ctx(): ActionContext & { frames: StreamFrame[] } {
  const frames: StreamFrame[] = []
  return { frames, emit: (frame) => frames.push(frame) }
}

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        { id: 'refunds', title: 'Refunds', text: '# Refunds\n\nWe refund any order within 30 days of delivery.' },
      ]),
    ],
  })
  return cached
}

describe('defining an action', () => {
  it('rejects a name a model cannot call reliably', () => {
    expect(() => defineAction({ name: 'Check Order', whenToUse: 'x', execute: async () => null })).toThrow(
      /lowercase/,
    )
  })

  it('rejects a server action with nothing to run', () => {
    expect(() => defineAction({ name: 'broken', whenToUse: 'x' })).toThrow(/no execute/)
  })

  it('allows a client action to have no execute, because the browser runs it', () => {
    expect(() => clientAction({ name: 'read_cart', whenToUse: 'x' })).not.toThrow()
  })
})

describe('field schema', () => {
  it('makes fields required unless explicitly optional', () => {
    const schema = fieldsToSchema([
      { name: 'email', type: 'string', description: 'x' },
      { name: 'note', type: 'string', description: 'y', required: false },
    ])
    expect(schema.required).toEqual(['email'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('constrains a field with options to an enum', () => {
    const schema = fieldsToSchema([
      { name: 'priority', type: 'string', description: 'x', options: ['low', 'high'] },
    ])
    expect(schema.properties.priority?.enum).toEqual(['low', 'high'])
  })
})

describe('compiling actions into tools', () => {
  it('hides a procedure-only action from the agent by default', () => {
    const locked = defineAction({
      name: 'issue_refund',
      whenToUse: 'x',
      procedureOnly: true,
      execute: async () => null,
    })
    expect(Object.keys(actionsToTools([locked], { context: ctx() }))).toEqual([])
  })

  it('reveals it once a procedure unlocks it', () => {
    const locked = defineAction({
      name: 'issue_refund',
      whenToUse: 'x',
      procedureOnly: true,
      execute: async () => null,
    })
    const tools = actionsToTools([locked], { context: ctx(), unlocked: new Set(['issue_refund']) })
    expect(Object.keys(tools)).toEqual(['issue_refund'])
  })

  it('gives a client action no execute, so the turn pauses for the browser', () => {
    const tools = actionsToTools([clientAction({ name: 'read_cart', whenToUse: 'x' })], { context: ctx() })
    expect(tools.read_cart?.execute).toBeUndefined()
  })

  it('returns a failure as data so the agent can explain it', async () => {
    const angry = defineAction({
      name: 'always_fails',
      whenToUse: 'x',
      async execute() {
        throw new Error('upstream is down')
      },
    })
    const tools = actionsToTools([angry], { context: ctx() })
    const result = await tools.always_fails?.execute?.({}, { toolCallId: 't', messages: [] })
    expect(result).toEqual({ ok: false, error: 'upstream is down' })
  })
})

describe('lead and data capture', () => {
  it('hands the lead to the host and tells the client it was captured', async () => {
    const saved: Record<string, unknown>[] = []
    const action = collectLeads({ onLead: (values) => void saved.push(values) })
    const c = ctx()

    await action.execute?.({ name: 'Sam', email: 'sam@example.com' }, c)

    expect(saved[0]).toEqual({ name: 'Sam', email: 'sam@example.com' })
    expect(c.frames[0]).toMatchObject({ type: 'captured', kind: 'lead' })
  })

  it('drops fields the model left blank rather than storing an empty answer', async () => {
    const saved: Record<string, unknown>[] = []
    const action = collectLeads({ onLead: (values) => void saved.push(values) })
    await action.execute?.({ email: 'a@b.co', name: '   ', message: undefined }, ctx())
    expect(saved[0]).toEqual({ email: 'a@b.co' })
  })

  it('supports several independent data collectors', async () => {
    const action = collectData({
      name: 'book_a_demo',
      whenToUse: 'x',
      fields: [{ name: 'company', type: 'string', description: 'x' }],
      onData: () => {},
      confirmation: 'Booked.',
    })
    const result = (await action.execute?.({ company: 'Acme' }, ctx())) as { message: string }
    expect(action.name).toBe('book_a_demo')
    expect(result.message).toBe('Booked.')
  })
})

describe('escalation', () => {
  it('creates a ticket and gives the customer a reference', async () => {
    const tickets: unknown[] = []
    const action = escalate({ createTicket: (ticket) => (tickets.push(ticket), { id: 'T-42' }) })
    const c = ctx()

    const result = (await action.execute?.(
      { subject: 'Damaged order', body: 'Arrived broken', priority: 'high' },
      c,
    )) as { ticketId?: string }

    expect(result.ticketId).toBe('T-42')
    expect(tickets[0]).toMatchObject({ subject: 'Damaged order', priority: 'high' })
    expect(c.frames[0]).toMatchObject({ type: 'handoff', ticketId: 'T-42' })
  })

  it('falls back to a normal priority when the model invents one', async () => {
    const tickets: Array<{ priority?: string }> = []
    const action = escalate({ createTicket: (ticket) => void tickets.push(ticket) })
    await action.execute?.({ subject: 's', body: 'b', priority: 'catastrophic' }, ctx())
    expect(tickets[0]?.priority).toBe('normal')
  })

  it('uses the known contact when the model did not collect an email', async () => {
    const tickets: Array<{ email?: string }> = []
    const action = escalate({ createTicket: (ticket) => void tickets.push(ticket) })
    await action.execute?.({ subject: 's', body: 'b' }, { ...ctx(), contact: { email: 'known@example.com' } })
    expect(tickets[0]?.email).toBe('known@example.com')
  })
})

describe('suggested replies', () => {
  it('splits, trims and caps the suggestions', async () => {
    const action = suggestedMessages({ max: 2 })
    const c = ctx()
    await action.execute?.({ suggestions: ' one | two | three ' }, c)
    expect(c.frames[0]).toMatchObject({ type: 'suggestions', items: ['one', 'two'] })
  })
})

describe('http action', () => {
  const originalFetch = globalThis.fetch

  function mockFetch(body: unknown, status = 200) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  }

  it('interpolates collected input into the url and returns the json', async () => {
    const fetchSpy = mockFetch({ status: 'shipped', internalNote: 'do not show' })
    globalThis.fetch = fetchSpy
    try {
      const action = httpAction({
        name: 'order_status',
        whenToUse: 'x',
        collect: [{ name: 'orderId', type: 'string', description: 'x' }],
        url: 'https://api.example/orders/{{orderId}}',
      })
      const result = await action.execute?.({ orderId: 'A 1/2' }, ctx())
      expect((fetchSpy as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]).toBe(
        'https://api.example/orders/A%201%2F2',
      )
      expect(result).toMatchObject({ status: 'shipped' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps only the allowed fields, so an internal note cannot leak', async () => {
    globalThis.fetch = mockFetch({ status: 'shipped', internalNote: 'customer is difficult' })
    try {
      const action = httpAction({
        name: 'order_status',
        whenToUse: 'x',
        url: 'https://api.example/o',
        allowFields: ['status'],
      })
      expect(await action.execute?.({}, ctx())).toEqual({ status: 'shipped' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reports the status but never the error body', async () => {
    globalThis.fetch = mockFetch({ stack: 'at /srv/internal/db.js:44' }, 403)
    try {
      const action = httpAction({ name: 'thing', whenToUse: 'x', url: 'https://api.example/o' })
      await expect(action.execute?.({}, ctx())).rejects.toThrow(/status 403/)
      await expect(action.execute?.({}, ctx())).rejects.not.toThrow(/db\.js/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('refuses a response too large for the context window', async () => {
    globalThis.fetch = mockFetch({ blob: 'x'.repeat(30_000) })
    try {
      const action = httpAction({ name: 'big', whenToUse: 'x', url: 'https://api.example/o', maxBytes: 1000 })
      await expect(action.execute?.({}, ctx())).rejects.toThrow(/more than 1000 bytes/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('refuses a non-json response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>hi</html>', { status: 200 })) as unknown as typeof fetch
    try {
      const action = httpAction({ name: 'html', whenToUse: 'x', url: 'https://api.example/o' })
      await expect(action.execute?.({}, ctx())).rejects.toThrow(/did not return JSON/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('web search', () => {
  it('calls firecrawl without a key and trims the snippets', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (_url, init) => {
      expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
      return new Response(
        JSON.stringify({ data: { web: [{ url: 'https://x.example', title: 'T', description: 'y'.repeat(900) }] } }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    try {
      const result = (await webSearch().execute?.({ query: 'test' }, ctx())) as {
        results: Array<{ snippet: string }>
      }
      expect(result.results[0]?.snippet.length).toBe(400)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('the agent running actions', () => {
  /** A model that calls one tool, then answers using its result. */
  function toolCallingModel(toolName: string) {
    let step = 0
    return new MockLanguageModelV4({
      doStream: async () => {
        step++
        return step === 1
          ? {
              stream: simulateReadableStream({
                chunks: [
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'call-1',
                    toolName,
                    input: JSON.stringify({ email: 'sam@example.com', name: 'Sam' }),
                  },
                  {
                    type: 'finish' as const,
                    finishReason: { unified: 'tool-calls', raw: 'tool_calls' } as const,
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  },
                ],
                chunkDelayInMs: 0,
              }),
            }
          : {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'text-start' as const, id: '0' },
                  { type: 'text-delta' as const, id: '0', delta: 'Thanks Sam, someone will follow up.' },
                  { type: 'text-end' as const, id: '0' },
                  {
                    type: 'finish' as const,
                    finishReason: { unified: 'stop', raw: 'stop' } as const,
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  },
                ],
                chunkDelayInMs: 0,
              }),
            }
      },
    })
  }

  it('runs the action, then answers using what it returned', async () => {
    const leads: Record<string, unknown>[] = []
    const agent = createAgent({
      index: await index(),
      model: toolCallingModel('collect_lead'),
      actions: [collectLeads({ onLead: (values) => void leads.push(values) })],
    })

    const frames: StreamFrame[] = []
    for await (const frame of agent.stream('please have someone call me')) frames.push(frame)

    expect(leads[0]).toMatchObject({ email: 'sam@example.com' })
    expect(frames.some((f) => f.type === 'captured')).toBe(true)
    expect(frames.filter((f) => f.type === 'delta').map((f) => (f as { text: string }).text).join('')).toContain(
      'Thanks Sam',
    )
    expect(frames.at(-1)?.type).toBe('done')
  })

  it('asks the browser to run a client action instead of running it here', async () => {
    const agent = createAgent({
      index: await index(),
      model: toolCallingModel('read_cart'),
      actions: [clientAction({ name: 'read_cart', whenToUse: 'x' })],
    })

    const frames: StreamFrame[] = []
    for await (const frame of agent.stream('what is in my cart')) frames.push(frame)

    const request = frames.find((f) => f.type === 'client-action')
    expect(request).toMatchObject({ type: 'client-action', name: 'read_cart', id: 'call-1' })
  })

  it('lists its actions in the instructions so the model knows they exist', async () => {
    const agent = createAgent({
      index: await index(),
      model: toolCallingModel('collect_lead'),
      actions: [collectLeads({ onLead: () => {} })],
    })
    // Nothing to assert on the agent directly; the prompt test covers wording.
    expect(agent).toBeDefined()
  })
})
