import { beforeEach, describe, expect, it } from 'vitest'
import { createWidget } from '../src/widget.js'
import { DEFAULT_STRINGS } from '../src/strings.js'
import type { VoiceRuntime } from '../src/call.js'

function mount(options: Parameters<typeof createWidget>[0]) {
  const widget = createWidget(options)

  return { widget, root: widget.element.shadowRoot as ShadowRoot }
}

const dial = (root: ShadowRoot) => root.querySelector('button.call') as HTMLButtonElement | null
const notices = (root: ShadowRoot) => [...root.querySelectorAll('.notice')].map((n) => n.textContent)
const line = (root: ShadowRoot) => root.querySelector('.status') as HTMLElement | null
/** Lets the dial chain finish: a fetch, a json parse, a load, then a session. */
const settle = async () => {
  for (let tick = 0; tick < 12; tick++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const said = (root: ShadowRoot) =>
  [...root.querySelectorAll('.msg')].map((m) => ({
    role: (m as HTMLElement).dataset.role,
    text: m.textContent?.trim(),
  }))

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the call button', () => {
  it('is absent unless the host pointed it at an endpoint', () => {
    // It costs the host money per press, so it is never on by accident.
    const { root } = mount({ endpoint: '/api/chat' })
    expect(dial(root)).toBeNull()
  })

  it('appears when given a path, and says what it does', () => {
    const { root } = mount({ endpoint: '/api/chat', call: '/api/voice/token' })
    const button = dial(root)

    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe(DEFAULT_STRINGS.call)
  })

  it('takes the longer object form too', () => {
    const { root } = mount({ endpoint: '/api/chat', call: { endpoint: '/voice' } })
    expect(dial(root)).not.toBeNull()
  })

  it('sits in the composer, next to the other controls', () => {
    const { root } = mount({ endpoint: '/api/chat', call: '/api/voice/token' })
    expect(dial(root)?.closest('.composer')).not.toBeNull()
  })
})

describe('what the thread shows during a call', () => {
  /**
   * Drives a real widget through a call, with the network and the voice
   * runtime replaced. The point is what lands in the panel, not the transport.
   */
  function calling() {
    const runtime: VoiceRuntime & {
      handlers: { connect?: () => void; message?: (m: { source?: string; message?: string }) => void }
    } = {
      handlers: {},
      startSession(options) {
        runtime.handlers.connect = options.onConnect
        runtime.handlers.message = options.onMessage
        return Promise.resolve({ endSession() {} })
      },
    }

    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ signedUrl: 'wss://voice.example/s' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch

    const { root } = mount({
      endpoint: '/api/chat',
      // `load` is what a site with a strict content policy uses to supply its
      // own runtime, and what lets this run with no audio anywhere.
      call: { endpoint: '/api/voice/token', load: async () => runtime },
    } as Parameters<typeof createWidget>[0])

    return { root, runtime, restore: () => void (globalThis.fetch = original) }
  }

  it('marks the start and the end of the call in the thread', async () => {
    const { root, runtime, restore } = calling()

    dial(root)?.click()
    await settle()
    runtime.handlers.connect?.()

    expect(notices(root)).toContain(DEFAULT_STRINGS.callStarted)

    dial(root)?.click()
    await settle()

    expect(notices(root)).toContain(DEFAULT_STRINGS.callEnded)
    restore()
  })

  it('puts what was spoken in the same thread as what was typed', async () => {
    // One conversation, not two. Splitting them makes the visitor read twice.
    const { root, runtime, restore } = calling()

    dial(root)?.click()
    await settle()
    runtime.handlers.connect?.()
    runtime.handlers.message?.({ source: 'user', message: 'where is my order' })
    runtime.handlers.message?.({ source: 'ai', message: 'It shipped on Tuesday.' })

    const thread = said(root)
    expect(thread).toContainEqual({ role: 'user', text: 'where is my order' })
    expect(thread).toContainEqual({ role: 'assistant', text: 'It shipped on Tuesday.' })
    restore()
  })

  it('turns into a hang-up control once the call is up', async () => {
    const { root, runtime, restore } = calling()

    dial(root)?.click()
    await settle()
    runtime.handlers.connect?.()

    expect(dial(root)?.dataset.state).toBe('live')
    expect(dial(root)?.getAttribute('aria-label')).toBe(DEFAULT_STRINGS.endCall)
    restore()
  })

  it('says under the composer that it is placing the call, and for how long it has run', async () => {
    // The button turning colour is the only other signal, and colour on its own
    // reaches neither a screen reader nor everybody looking at it.
    const { root, runtime, restore } = calling()

    expect(line(root)?.hidden).toBe(true)

    dial(root)?.click()
    await settle()

    expect(line(root)?.hidden).toBe(false)
    expect(line(root)?.dataset.kind).toBe('connecting')
    expect(line(root)?.textContent).toContain(DEFAULT_STRINGS.calling)

    runtime.handlers.connect?.()

    expect(line(root)?.dataset.kind).toBe('live')
    expect(line(root)?.textContent).toContain('0:00')

    dial(root)?.click()
    await settle()

    expect(line(root)?.hidden).toBe(true)
    restore()
  })

  it('announces the line rather than only colouring the button', () => {
    const { root } = mount({ endpoint: '/api/chat', call: '/api/voice/token' })

    expect(line(root)?.getAttribute('role')).toBe('status')
    expect(line(root)?.getAttribute('aria-live')).toBe('polite')
  })

  it('leaves a mark on the button when a call never connected', async () => {
    // The error box above is cleared by the next thing that happens. That it
    // failed is the one fact somebody needs before pressing again.
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('no', { status: 503 })) as unknown as typeof globalThis.fetch

    const { root } = mount({
      endpoint: '/api/chat',
      call: { endpoint: '/api/voice/token', load: async () => ({ startSession: async () => ({ endSession() {} }) }) },
    } as Parameters<typeof createWidget>[0])
    const button = dial(root) as HTMLButtonElement

    button.click()
    await settle()

    expect(button.dataset.state).toBe('failed')
    expect(button.querySelector('.failed')).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe(DEFAULT_STRINGS.callAgain)
    // The line is for something that is happening. A failure is not.
    expect(line(root)?.hidden).toBe(true)

    globalThis.fetch = original
  })
})

describe('choosing who carries the call', () => {
  it('uses the vendor path by default, which needs no transcriber of your own', () => {
    const { root } = mount({ endpoint: '/api/chat', call: '/api/voice/token' })
    expect(dial(root)).not.toBeNull()
  })

  it('takes the hosted path when asked for it', () => {
    // Same button, same states, same thread. Only the transport differs.
    const { root } = mount({
      endpoint: '/api/chat',
      call: { endpoint: '/api/voice/call', transport: 'hosted' },
    } as Parameters<typeof createWidget>[0])

    const button = dial(root)
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe(DEFAULT_STRINGS.call)
  })
})
