import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'

function mount(options: Parameters<typeof createWidget>[0] = { endpoint: '/api/chat' }) {
  const widget = createWidget(options)
  return { widget, root: widget.element.shadowRoot as ShadowRoot }
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/**
 * A chat log that streams is the hard case for a screen reader, and the wrong
 * shape is not a warning anywhere: it is a live region that reads the same
 * answer out again on every token.
 */
describe('the transcript, for somebody who cannot see it', () => {
  it('is a log that announces politely rather than interrupting', () => {
    const { root } = mount()
    const log = root.querySelector('.log') as HTMLElement

    expect(log.getAttribute('role')).toBe('log')
    // Polite, so a screen reader finishes its sentence before the answer.
    expect(log.getAttribute('aria-live')).toBe('polite')
    expect(log.getAttribute('aria-relevant')).toBe('additions text')
  })

  it('goes quiet while an answer is still being written', async () => {
    const { widget, root } = mount()
    const log = root.querySelector('.log') as HTMLElement

    // Held open, so the turn is mid-stream when the assertion runs.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) as unknown as Promise<Response>,
    )

    void widget.ask('do you do refunds?')
    await Promise.resolve()

    // The answer is rebuilt on every delta. Without this the whole growing
    // reply is announced again each time, so a two sentence answer is read
    // out dozens of times.
    expect(log.getAttribute('aria-busy')).toBe('true')
  })

  it('speaks again once the answer is finished and worth hearing', async () => {
    const { widget, root } = mount()
    const log = root.querySelector('.log') as HTMLElement

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: {"type":"delta","text":"We refund within 30 days."}\n\ndata: {"type":"done"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    await widget.ask('do you do refunds?')
    expect(log.getAttribute('aria-busy')).toBe('false')
  })

  it('does not stay silent after the connection drops mid-answer', async () => {
    const { widget, root } = mount()
    const log = root.querySelector('.log') as HTMLElement

    // Not a rejected fetch, which is handled: a stream that opens, delivers
    // nothing and then breaks. That rejects out of the reader, past the line
    // that clears the flag, and leaves the region busy for the whole session.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'))
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )

    await widget.ask('do you do refunds?').catch(() => {})

    expect(log.getAttribute('aria-busy')).toBe('false')
  })

  it('does not stay silent after a failure', async () => {
    const { widget, root } = mount()
    const log = root.querySelector('.log') as HTMLElement

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))

    await widget.ask('do you do refunds?').catch(() => {})

    // A region left busy is a region a screen reader never reads again, so an
    // error would silence the widget for the rest of the session.
    expect(log.getAttribute('aria-busy')).toBe('false')
  })
})

/**
 * The agent is told to reply in the language the customer wrote in, so one
 * conversation can hold both directions at once. Without a direction the text
 * inherits the host page's, and an Arabic answer on an English site renders
 * with its punctuation in the wrong place.
 */
describe('a conversation that is not in English', () => {
  it('lets every message find its own direction', () => {
    const { widget, root } = mount()

    // Through the public path rather than by reaching into internals. The
    // question is Arabic, the page is not, and `auto` is what resolves that
    // per message from its first strong character.
    widget.ask('مرحبا').catch(() => {})

    const bubble = root.querySelector('.bubble') as HTMLElement
    expect(bubble.getAttribute('dir')).toBe('auto')
  })

  it('lets the composer follow what is being typed', () => {
    const { root } = mount()
    const input = root.querySelector('textarea') as HTMLTextAreaElement
    expect(input.getAttribute('dir')).toBe('auto')
  })
})
