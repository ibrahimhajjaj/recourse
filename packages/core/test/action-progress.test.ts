import { describe, expect, it } from 'vitest'
import { actionsToTools } from '../src/actions/define.js'
import type { Action, ActionContext, StreamFrame } from '../src/types.js'

function run(action: Action, input: Record<string, unknown> = {}) {
  const frames: StreamFrame[] = []
  const context = { emit: (frame: StreamFrame) => void frames.push(frame) } as unknown as ActionContext
  const tools = actionsToTools([action], { context })

  return { frames, call: () => (tools[action.name] as any).execute(input, {}) }
}

const slow = (execute: Action['execute'], extra: Partial<Action> = {}): Action => ({
  name: 'look_up_order',
  whenToUse: 'Look an order up.',
  collect: [{ name: 'order', description: 'the order number' }],
  execute,
  ...extra,
})

describe('what the visitor sees while an action runs', () => {
  it('reports a hand-written action starting and finishing', async () => {
    // Nothing here emits anything of its own. Before, that meant three dots for
    // as long as the lookup took, and no way to tell working from broken.
    const { frames, call } = run(slow(async () => ({ status: 'shipped' })))
    await call()

    expect(frames.map((frame) => (frame as any).status)).toEqual(['running', 'done'])
    expect((frames[0] as any).name).toBe('look_up_order')
  })

  it('reports a failure as failed, not as finished', async () => {
    const { frames, call } = run(
      slow(async () => {
        throw new Error('the order service is down')
      }),
    )
    await call()

    expect(frames.map((frame) => (frame as any).status)).toEqual(['running', 'failed'])
  })

  it('carries a summary when the action gives one', async () => {
    const { frames, call } = run(
      slow(async () => ({}), { summarise: (input) => `Looking up ${String(input.order)}` }),
      { order: 'LUM-1234' },
    )
    await call()

    expect((frames[0] as any).summary).toBe('Looking up LUM-1234')
  })

  it('says one thing, not two', async () => {
    // The built-ins used to emit these by hand. Emitting in both places would
    // show the visitor the same label twice.
    const { frames, call } = run(slow(async () => ({})))
    await call()

    expect(frames.filter((frame) => (frame as any).status === 'running')).toHaveLength(1)
  })

  it('runs the action even when the summary throws', async () => {
    let ran = false
    const { frames, call } = run(
      slow(
        async () => {
          ran = true
          return {}
        },
        {
          summarise: () => {
            throw new Error('bad label')
          },
        },
      ),
    )

    await call()

    // A string nobody needed must not cost a lookup that was about to work.
    expect(ran).toBe(true)
    expect((frames[0] as any).summary).toBeUndefined()
  })
})
