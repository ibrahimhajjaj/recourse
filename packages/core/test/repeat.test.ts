import { describe, expect, it, vi } from 'vitest'
import { actionsToTools, defineAction } from '../src/actions/index.js'
import type { ActionContext } from '../src/actions/types.js'

function ctx(): ActionContext {
  return { emit: () => {} }
}

/** Runs a tool the way the SDK does, without going through a model. */
async function call(tools: ReturnType<typeof actionsToTools>, name: string, input: Record<string, unknown>) {
  const tool = tools[name] as { execute: (input: unknown, options: unknown) => Promise<unknown> }
  return (await tool.execute(input, {})) as { ok: boolean; data?: unknown; error?: string }
}

describe('an action that keeps being called the same way', () => {
  it('runs it once, allows one retry, then refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let ran = 0
    const tools = actionsToTools(
      [
        defineAction({
          name: 'find_order',
          whenToUse: 'x',
          execute: async () => {
            ran++
            return { found: false }
          },
        }),
      ],
      { context: ctx() },
    )

    expect((await call(tools, 'find_order', { id: '1' })).ok).toBe(true)
    expect((await call(tools, 'find_order', { id: '1' })).ok).toBe(true)

    const third = await call(tools, 'find_order', { id: '1' })
    expect(third.ok).toBe(false)
    expect(third.error).toContain('Do not call it again')
    // The point of the whole thing: the third request never left the building.
    expect(ran).toBe(2)
    warn.mockRestore()
  })

  it('treats the same arguments in a different order as the same call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let ran = 0
    const tools = actionsToTools(
      [defineAction({ name: 'lookup', whenToUse: 'x', execute: async () => { ran++; return {} } })],
      { context: ctx(), repeatLimit: 1 },
    )

    await call(tools, 'lookup', { a: '1', b: '2' })
    const second = await call(tools, 'lookup', { b: '2', a: '1' })

    expect(second.ok).toBe(false)
    expect(ran).toBe(1)
    warn.mockRestore()
  })

  it('counts a different argument as a different call', async () => {
    let ran = 0
    const tools = actionsToTools(
      [defineAction({ name: 'lookup', whenToUse: 'x', execute: async () => { ran++; return {} } })],
      { context: ctx(), repeatLimit: 1 },
    )

    await call(tools, 'lookup', { id: '1' })
    await call(tools, 'lookup', { id: '2' })
    expect(ran).toBe(2)
  })

  it('can be turned off', async () => {
    let ran = 0
    const tools = actionsToTools(
      [defineAction({ name: 'lookup', whenToUse: 'x', execute: async () => { ran++; return {} } })],
      { context: ctx(), repeatLimit: 0 },
    )

    for (let attempt = 0; attempt < 5; attempt++) await call(tools, 'lookup', { id: '1' })
    expect(ran).toBe(5)
  })

  it('starts counting again on the next turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let ran = 0
    const action = defineAction({ name: 'lookup', whenToUse: 'x', execute: async () => { ran++; return {} } })

    // A turn is one actionsToTools call, so a customer asking the same thing
    // twice in a conversation must not be refused the second time.
    for (const _turn of [1, 2]) {
      const tools = actionsToTools([action], { context: ctx(), repeatLimit: 1 })
      await call(tools, 'lookup', { id: '1' })
      await call(tools, 'lookup', { id: '1' })
    }

    expect(ran).toBe(2)
    warn.mockRestore()
  })

})
