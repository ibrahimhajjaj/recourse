import { describe, expect, it } from 'vitest'
import { actionsToTools, defineAction } from '../src/actions/index.js'
import { redact, shrink } from '../src/actions/shrink.js'
import type { ActionContext } from '../src/actions/types.js'

function ctx(): ActionContext {
  return { emit: () => {} }
}

/** Runs a tool the way the SDK does, without going through a model. */
async function call(tools: ReturnType<typeof actionsToTools>, name: string, input: Record<string, unknown>) {
  const tool = tools[name] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
  return (await tool.execute(input, {})) as { ok: boolean; data?: unknown; error?: string }
}

describe('cutting a result down', () => {
  it('leaves a small result exactly as it was', () => {
    const value = { order: 'A-1', status: 'shipped', items: [{ sku: 'x' }] }
    expect(shrink(value)).toEqual(value)
  })

  it('keeps the first rows of a long list and says how many there were', () => {
    const orders = Array.from({ length: 200 }, (_, position) => ({ id: position }))
    const small = shrink(orders, { maxItems: 3 }) as { total: number; showing: number; items: unknown[] }

    expect(small.total).toBe(200)
    expect(small.showing).toBe(3)
    expect(small.items).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }])
  })

  it('cuts a long string and says how long it was', () => {
    const cut = shrink('x'.repeat(5000), { maxStringChars: 100 }) as string
    expect(cut).toHaveLength(100 + '... [5000 characters, cut]'.length)
    expect(cut).toContain('5000 characters, cut')
  })

  it('trims nested lists, not just the top level', () => {
    const value = { customer: 'ada', orders: Array.from({ length: 50 }, (_, id) => ({ id })) }
    const small = shrink(value, { maxItems: 2 }) as { orders: { total: number } }
    expect(small.orders.total).toBe(50)
  })

  it('describes a result that is wide rather than deep', () => {
    const wide: Record<string, string> = {}
    for (let field = 0; field < 500; field++) wide[`field${field}`] = 'value'

    const small = shrink(wide, { maxChars: 200 }) as { omitted: string; fields: string[] }
    expect(small.omitted).toContain('too large')
    expect(small.fields.length).toBeLessThanOrEqual(40)
  })

  it('survives a result that points at itself', () => {
    const looping: Record<string, unknown> = { name: 'x' }
    looping.self = looping
    expect(() => shrink(looping)).not.toThrow()
  })

  it('removes a credential that rode along in the result', () => {
    const leaked = shrink({ debug: 'called with Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345' }) as {
      debug: string
    }
    expect(leaked.debug).toContain('[redacted]')
    expect(leaked.debug).not.toContain('abcdefghijklmnop')
  })

  it('leaves an order number that merely looks like an id alone', () => {
    expect(redact('order SK-99123 shipped')).toBe('order SK-99123 shipped')
  })
})

describe('an action that failed', () => {
  it('redacts a credential out of an action that threw', async () => {
    const tools = actionsToTools(
      [
        defineAction({
          name: 'charge',
          whenToUse: 'x',
          execute: async () => {
            throw new Error('POST /v1/charges failed with Bearer sk-live-9f8e7d6c5b4a3f2e1d0c9b8a')
          },
        }),
      ],
      { context: ctx() },
    )

    const result = await call(tools, 'charge', {})
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('sk-live-9f8e7d6c')
    expect(result.error).toContain('[redacted]')
  })
})
