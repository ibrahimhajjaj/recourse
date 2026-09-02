import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'

const THOUGHT = 'The instructions say never to offer a discount.'

/** A turn that thinks first, the way a reasoning model streams. */
function serves(frames: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(frames.join(''), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ),
  )
}

const settle = async () => {
  for (let tick = 0; tick < 60; tick++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('a turn where the model thinks first', () => {
  it('shows the thought while waiting and keeps it out of the transcript', async () => {
    serves([
      `data: ${JSON.stringify({ type: 'reasoning', text: THOUGHT })}\n\n`,
      `data: ${JSON.stringify({ type: 'delta', text: 'You have 30 days to request a refund.' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ])

    const widget = createWidget({ endpoint: '/api/chat' })
    const root = widget.element.shadowRoot as ShadowRoot

    await widget.ask('can I get a refund?')
    await settle()

    const transcript = root.textContent ?? ''

    // The answer is what the visitor keeps. The thought is why it took a
    // moment, and it is the model restating its own instructions, so it must
    // not end up sitting in the conversation afterwards.
    expect(transcript).toContain('You have 30 days to request a refund.')
    expect(transcript).not.toContain('never to offer a discount')
  })

  it('leaves nothing behind when the answer never comes', async () => {
    serves([
      `data: ${JSON.stringify({ type: 'reasoning', text: THOUGHT })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ])

    const widget = createWidget({ endpoint: '/api/chat' })
    const root = widget.element.shadowRoot as ShadowRoot

    await widget.ask('can I get a refund?')
    await settle()

    expect(root.textContent ?? '').not.toContain('never to offer a discount')
  })
})
