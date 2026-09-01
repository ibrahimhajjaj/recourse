import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'
import { DEFAULT_STRINGS, fill, resolveStrings } from '../src/strings.js'

function mount(options: Parameters<typeof createWidget>[0]) {
  const widget = createWidget(options)
  const root = widget.element.shadowRoot as ShadowRoot
  return { widget, root }
}

/** Everything a visitor can see or press, by its label. */
function labelled(root: ShadowRoot, label: string): HTMLElement | null {
  return root.querySelector(`[aria-label="${label}"]`)
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the string table', () => {
  it('keeps every default when nothing is overridden', () => {
    expect(resolveStrings()).toEqual(DEFAULT_STRINGS)
  })

  it('takes a partial override without losing the rest', () => {
    const strings = resolveStrings({ send: 'Versturen' })

    expect(strings.send).toBe('Versturen')
    expect(strings.placeholder).toBe(DEFAULT_STRINGS.placeholder)
  })

  it('ignores an empty override rather than rendering it', () => {
    // These arrive from a data attribute or a global on somebody's page, and a
    // control with no label is one a screen reader cannot announce.
    expect(resolveStrings({ send: '   ' }).send).toBe(DEFAULT_STRINGS.send)
    expect(resolveStrings({ send: undefined }).send).toBe(DEFAULT_STRINGS.send)
  })

  it('fills a placeholder, and leaves an unknown one alone', () => {
    expect(fill('Remove {name}', { name: 'photo.png' })).toBe('Remove photo.png')
    expect(fill('Remove {other}', { name: 'x' })).toBe('Remove {other}')
  })
})

describe('speaking the customer\'s language', () => {
  it('renders every chrome string the host supplied', () => {
    const { root } = mount({
      endpoint: '/api/chat',
      open: true,
      strings: {
        title: 'Vraag ons alles',
        placeholder: 'Typ uw vraag',
        send: 'Versturen',
        close: 'Sluit de chat',
        inputLabel: 'Uw vraag',
      },
    })

    expect(root.querySelector('h2, .heading strong, strong')?.textContent).toBe('Vraag ons alles')
    expect(root.querySelector('textarea')?.placeholder).toBe('Typ uw vraag')
    expect(labelled(root, 'Versturen')).not.toBeNull()
    expect(labelled(root, 'Sluit de chat')).not.toBeNull()
    expect(labelled(root, 'Uw vraag')).not.toBeNull()
  })

  it('leaves an English deployment exactly as it was', () => {
    const { root } = mount({ endpoint: '/api/chat', open: true })

    expect(root.querySelector('textarea')?.placeholder).toBe('Type your question')
    expect(labelled(root, 'Send')).not.toBeNull()
  })
})

describe('deleting your own conversation', () => {
  it('is absent unless the host turns it on', () => {
    const { root } = mount({ endpoint: '/api/chat', open: true })

    expect(labelled(root, DEFAULT_STRINGS.deleteConversation)).toBeNull()
  })

  it('appears when it is turned on', () => {
    const { root } = mount({ endpoint: '/api/chat', open: true, allowDelete: true })

    expect(labelled(root, DEFAULT_STRINGS.deleteConversation)).not.toBeNull()
  })

  it('asks first, and does nothing when the answer is no', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', () => false)

    const { root } = mount({ endpoint: '/api/chat', open: true, allowDelete: true })
    labelled(root, DEFAULT_STRINGS.deleteConversation)?.click()
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('tells the server which conversation to forget', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', () => true)

    const { root } = mount({ endpoint: '/api/chat', open: true, allowDelete: true })
    labelled(root, DEFAULT_STRINGS.deleteConversation)?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(typeof body.deleteConversation).toBe('string')
    expect(body.deleteConversation.startsWith('c_')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('empties the panel even when the request fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('confirm', () => true)

    const { widget, root } = mount({ endpoint: '/api/chat', open: true, allowDelete: true })
    await widget.forget()

    // The visitor asked for their words to go. Telling them it failed is worse
    // than the transcript outliving it on a server they cannot see.
    expect(root.querySelectorAll('.msg')).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('starts a new conversation id afterwards', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)).deleteConversation)
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('confirm', () => true)

    const { widget } = mount({ endpoint: '/api/chat', open: true, allowDelete: true })

    await widget.forget()
    await widget.forget()

    // Two deletions must not name the same conversation, or the second one
    // deletes something that was never written and the visitor's new
    // conversation is still on the server under the old id.
    expect(seen).toHaveLength(2)
    expect(new Set(seen).size).toBe(2)
    vi.unstubAllGlobals()
  })
})

describe('showing what the agent is doing', () => {
  /**
   * A turn held open, so the panel can be inspected mid-flight.
   *
   * The indicator only exists while the agent is working, so a stream that
   * finishes before the assertion runs proves nothing: the cleanup on `done`
   * has already removed it.
   */
  function turn() {
    const encoder = new TextEncoder()
    let push!: (frame: unknown) => void
    let finish!: () => void

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (frame) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        finish = () => {
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
          controller.close()
        }
      },
    })

    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as typeof globalThis.fetch

    const { widget, root } = mount({ endpoint: '/api/chat' })
    void widget.ask('where is my order')

    const settle = async () => {
      for (let tick = 0; tick < 40; tick++) await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    return { root, push, finish, settle, restore: () => void (globalThis.fetch = original) }
  }

  it('says what it is checking instead of showing three dots', async () => {
    // The frame already crossed the whole stack to get here. Before this it
    // reached the browser, fired a host event, and rendered nothing at all.
    const call = turn()
    await call.settle()

    call.push({ type: 'action', name: 'look_up_billing', status: 'running' })
    await call.settle()

    expect(call.root.querySelector('.working')?.textContent).toBe('Checking look up billing')
    expect(call.root.querySelector('.typing')).toBeNull()
    call.finish()
    call.restore()
  })

  it('prefers the summary the action wrote over its name', async () => {
    const call = turn()
    await call.settle()

    call.push({ type: 'action', name: 'look_up_billing', status: 'running', summary: 'invoice 1234' })
    await call.settle()

    expect(call.root.querySelector('.working')?.textContent).toBe('Checking invoice 1234')
    call.finish()
    call.restore()
  })

  it('goes back to the dots when the action finishes with nothing said yet', async () => {
    const call = turn()
    await call.settle()

    call.push({ type: 'action', name: 'look_up_billing', status: 'running' })
    await call.settle()
    call.push({ type: 'action', name: 'look_up_billing', status: 'done' })
    await call.settle()

    expect(call.root.querySelector('.working')).toBeNull()
    expect(call.root.querySelector('.typing')).not.toBeNull()
    call.finish()
    call.restore()
  })

  it('gets out of the way once the answer starts', async () => {
    // A status line under a half-written sentence reads as a fault.
    const call = turn()
    await call.settle()

    call.push({ type: 'action', name: 'look_up_billing', status: 'running' })
    await call.settle()
    call.push({ type: 'delta', text: 'Your invoice is paid.' })
    await call.settle()

    expect(call.root.querySelector('.working')).toBeNull()
    expect(call.root.textContent).toContain('Your invoice is paid.')
    call.finish()
    call.restore()
  })

  it('renders a summary as text, never as markup', async () => {
    // The summary comes from an action a deployment wrote, and this is a
    // customer's screen.
    const call = turn()
    await call.settle()

    call.push({ type: 'action', name: 'x', status: 'running', summary: '<img src=x onerror=alert(1)>' })
    await call.settle()

    expect(call.root.querySelector('.working img')).toBeNull()
    expect(call.root.querySelector('.working')?.textContent).toContain('<img')
    call.finish()
    call.restore()
  })
})

describe('a card that changes while you watch', () => {
  function turn() {
    const encoder = new TextEncoder()
    let push!: (frame: unknown) => void

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (frame) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      },
    })

    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as typeof globalThis.fetch

    const { widget, root } = mount({ endpoint: '/api/chat' })
    void widget.ask('where is my refund')

    const settle = async () => {
      for (let tick = 0; tick < 40; tick++) await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    return { root, push, settle, restore: () => void (globalThis.fetch = original) }
  }

  const cards = (root: ShadowRoot) => root.querySelectorAll('[data-ui-id]')

  it('replaces a card sent again under the same id', async () => {
    // The id was passed through and ignored, so a refund going from requested
    // to approved left three cards stacked in the thread instead of one that
    // changed.
    const call = turn()
    await call.settle()

    call.push({ type: 'ui', kind: 'card', id: 'refund_88', data: { title: 'Refund', subtitle: 'Requested' } })
    await call.settle()
    call.push({ type: 'ui', kind: 'card', id: 'refund_88', data: { title: 'Refund', subtitle: 'Approved' } })
    await call.settle()

    expect(cards(call.root)).toHaveLength(1)
    expect(call.root.textContent).toContain('Approved')
    expect(call.root.textContent).not.toContain('Requested')
    call.restore()
  })

  it('keeps two cards apart when the ids differ', async () => {
    const call = turn()
    await call.settle()

    call.push({ type: 'ui', kind: 'card', id: 'refund_88', data: { title: 'Refund' } })
    await call.settle()
    call.push({ type: 'ui', kind: 'card', id: 'order_12', data: { title: 'Order' } })
    await call.settle()

    expect(cards(call.root)).toHaveLength(2)
    call.restore()
  })

  it('updates in place rather than moving the card to the end', async () => {
    // Otherwise the thread jumps under somebody who is reading it.
    const call = turn()
    await call.settle()

    call.push({ type: 'ui', kind: 'card', id: 'a', data: { title: 'First' } })
    await call.settle()
    call.push({ type: 'ui', kind: 'card', id: 'b', data: { title: 'Second' } })
    await call.settle()
    call.push({ type: 'ui', kind: 'card', id: 'a', data: { title: 'First, updated' } })
    await call.settle()

    const order = [...cards(call.root)].map((node) => node.getAttribute('data-ui-id'))
    expect(order).toEqual(['a', 'b'])
    expect(call.root.textContent).toContain('First, updated')
    call.restore()
  })

  it('is not fooled by an id that looks like a selector', async () => {
    // The id arrives from the server, so it reaches the browser untrusted.
    const call = turn()
    await call.settle()

    call.push({ type: 'ui', kind: 'card', id: 'a"] , [data-ui-id="b', data: { title: 'Odd' } })
    await call.settle()
    call.push({ type: 'ui', kind: 'card', id: 'b', data: { title: 'Innocent' } })
    await call.settle()

    expect(cards(call.root)).toHaveLength(2)
    expect(call.root.textContent).toContain('Innocent')
    call.restore()
  })
})

describe('the disclosure line', () => {
  it('shows what the deployment set', () => {
    // It was declared in the string table and rendered nowhere, so a shop that
    // set this to say the customer is talking to a machine got nothing on
    // screen and no error to tell them.
    const { root } = mount({
      endpoint: '/api/chat',
      strings: { footnote: 'You are chatting with an AI assistant.' },
    } as Parameters<typeof createWidget>[0])

    expect(root.querySelector('.footnote')?.textContent).toBe('You are chatting with an AI assistant.')
  })

  it('shows nothing when none was set', () => {
    const { root } = mount({ endpoint: '/api/chat' })

    expect(root.querySelector('.footnote')).toBeNull()
  })

  it('renders it as text, never as markup', () => {
    // It arrives from a data attribute on somebody's page.
    const { root } = mount({
      endpoint: '/api/chat',
      strings: { footnote: '<img src=x onerror=alert(1)>' },
    } as Parameters<typeof createWidget>[0])

    expect(root.querySelector('.footnote img')).toBeNull()
    expect(root.querySelector('.footnote')?.textContent).toContain('<img')
  })
})
