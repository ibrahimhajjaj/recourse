import { describe, expect, it } from 'vitest'
import { actionsToTools } from '../src/actions/define.js'
import type { Action } from '../src/actions/types.js'
import type { StreamFrame } from '../src/types.js'

/**
 * What the page is told about an action that ran.
 *
 * A name and a status by default, because that is all a spinner needs and the
 * result of a lookup has no business in JavaScript on somebody's marketing
 * page. Everything, on a deployment that asked for it.
 */

const lookup: Action = {
  name: 'order_status',
  whenToUse: 'Look up an order.',
  collect: [{ name: 'orderNumber', type: 'string', description: 'Their order number.' }],
  execute: async () => ({ status: 'Delivered', address: '4 Mill Lane', token: 'sk-live-abcdefghijklmno' }),
}

async function run(actionDetail?: boolean) {
  const frames: StreamFrame[] = []
  const tools = actionsToTools([lookup], {
    context: { emit: (frame) => frames.push(frame) },
    ...(actionDetail === undefined ? {} : { actionDetail }),
  })

  const tool = tools.order_status as unknown as { execute: (input: unknown) => Promise<unknown> }
  await tool.execute({ orderNumber: 'LUM-1' })

  return frames.filter((frame) => frame.type === 'action') as Array<
    Extract<StreamFrame, { type: 'action' }>
  >
}

describe('what an action tells the page', () => {
  it('says only that it ran', async () => {
    const [started, finished] = await run()

    expect(started).toMatchObject({ name: 'order_status', status: 'running' })
    expect(started).not.toHaveProperty('input')
    expect(finished).toMatchObject({ name: 'order_status', status: 'done' })
    expect(finished).not.toHaveProperty('result')
  })

  it('sends the arguments and the result where the deployment asked for them', async () => {
    const [started, finished] = await run(true)

    expect(started?.input).toEqual({ orderNumber: 'LUM-1' })
    expect(finished?.result).toMatchObject({ status: 'Delivered', address: '4 Mill Lane' })
  })

  it('sends the redacted result, not the raw one', async () => {
    // The page gets exactly what the model got. Two redaction passes are two
    // things to keep in agreement, and a credential in a field belongs in
    // neither of them.
    const [, finished] = await run(true)

    expect(JSON.stringify(finished?.result)).not.toContain('sk-live-abcdefghijklmno')
  })
})
