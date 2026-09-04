import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'

/**
 * Changing what the widget says while it is running.
 *
 * A single-page app moves between a billing page and a checkout without ever
 * rebuilding the widget, and the header, the starters and the placeholder that
 * suit one do not suit the other.
 */

function mount(options: Partial<Parameters<typeof createWidget>[0]> = {}) {
  const target = document.createElement('div')
  document.body.appendChild(target)

  const widget = createWidget({
    endpoint: 'https://example.com/api/chat',
    target,
    open: true,
    persist: false,
    title: 'Ask us anything',
    suggestions: ['Where is my order?'],
    ...options,
  })

  const root = target.querySelector('div')?.shadowRoot as ShadowRoot
  return { widget, root }
}

const heading = (root: ShadowRoot) => root.querySelector('.header h2')?.textContent
const sub = (root: ShadowRoot) => root.querySelector('.header p') as HTMLElement
const note = (root: ShadowRoot) => root.querySelector('.footnote') as HTMLElement
const box = (root: ShadowRoot) => root.querySelector('textarea') as HTMLTextAreaElement
const chips = (root: ShadowRoot) => [...root.querySelectorAll('.suggestions button')].map((b) => b.textContent)

beforeEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('what a change must not take away', () => {
  it('leaves the controls on answers already on screen', async () => {
    // The thumbs and the retry control are attached as each answer arrives and
    // never restored afterwards, so a blanket rebuild for a renamed header
    // would silently strip them off the whole conversation.
    const { widget, root } = mount()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: {"type":"delta","text":"We refund within 30 days."}\n\ndata: {"type":"done"}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      ),
    )

    ;(root.querySelector('textarea') as HTMLTextAreaElement).value = 'do you do refunds?'
    ;(root.querySelector('form.composer') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
    for (let tick = 0; tick < 60; tick++) await new Promise((resolve) => setTimeout(resolve, 5))

    const before = root.querySelectorAll('.feedback button').length
    expect(before).toBeGreaterThan(0)

    widget.setOptions({ title: 'Acme billing' })

    expect(root.querySelectorAll('.feedback button')).toHaveLength(before)
    expect(root.textContent).toContain('We refund within 30 days.')
  })

  it('still redraws the greeting, which only shows on an empty panel', () => {
    const { widget, root } = mount({ greeting: 'Ask us anything about billing.' })

    expect(root.textContent).toContain('Ask us anything about billing.')
    widget.setOptions({ greeting: 'Ask us anything about delivery.' })

    expect(root.textContent).toContain('Ask us anything about delivery.')
    expect(root.textContent).not.toContain('about billing')
  })
})

describe('changing what the widget says', () => {
  it('moves only the keys it was given', () => {
    const { widget, root } = mount()
    widget.setOptions({ title: 'Acme billing' })

    expect(heading(root)).toBe('Acme billing')
    expect(chips(root)).toEqual(['Where is my order?'])
  })

  it('adds a subtitle and a footnote that were never there to begin with', () => {
    // Both nodes exist from the start for exactly this: a widget built without
    // them cannot grow one otherwise.
    const { widget, root } = mount()

    expect(sub(root).hidden).toBe(true)
    widget.setOptions({ subtitle: 'Billing and invoices', footnote: 'Chats may be recorded.' })

    expect(sub(root).textContent).toBe('Billing and invoices')
    expect(sub(root).hidden).toBe(false)
    expect(note(root).textContent).toBe('Chats may be recorded.')
    expect(note(root).hidden).toBe(false)
  })

  it('renames what a screen reader hears, not just what is drawn', () => {
    const { widget, root } = mount()
    widget.setOptions({ title: 'Acme billing' })

    expect(root.querySelector('.panel')?.getAttribute('aria-label')).toBe('Acme billing')
  })

  it('changes the placeholder and the starters', () => {
    const { widget, root } = mount()
    widget.setOptions({ placeholder: 'Ask about your invoice', suggestions: ['Download an invoice'] })

    expect(box(root).placeholder).toBe('Ask about your invoice')
    expect(chips(root)).toEqual(['Download an invoice'])
  })

  it('puts everything back', () => {
    const { widget, root } = mount()
    widget.setOptions({ title: 'Acme billing', subtitle: 'Invoices', suggestions: ['Download an invoice'] })
    widget.resetOptions()

    expect(heading(root)).toBe('Ask us anything')
    expect(sub(root).hidden).toBe(true)
    expect(chips(root)).toEqual(['Where is my order?'])
  })

  it('puts back only what it was asked to', () => {
    const { widget, root } = mount()
    widget.setOptions({ title: 'Acme billing', placeholder: 'Ask about your invoice' })
    widget.resetOptions({ title: true })

    expect(heading(root)).toBe('Ask us anything')
    expect(box(root).placeholder).toBe('Ask about your invoice')
  })
})

/** Streams one answer back, recording what was asked. */
function stub(sent: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> }
      sent.push(body.messages.filter((message) => message.role === 'user').map((m) => m.content).join('|'))
      return new Response('data: {"type":"delta","text":"Our plans start at £9."}\n\ndata: {"type":"done"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }),
  )
}

const settle = async () => {
  for (let tick = 0; tick < 60; tick++) await new Promise((resolve) => setTimeout(resolve, 5))
}

function floating() {
  // No `target`: an inline widget has no panel to open, it is the panel.
  const widget = createWidget({ endpoint: 'https://example.com/api/chat', persist: false })
  const root = widget.element.shadowRoot as ShadowRoot
  return { widget, root }
}

describe('opening with a question already in it', () => {
  it('opens and shows what was asked', async () => {
    const sent: string[] = []
    stub(sent)
    const { widget, root } = floating()

    widget.open({ ask: 'what does it cost?' })
    await settle()

    expect(sent).toEqual(['what does it cost?'])
    expect(root.textContent).toContain('what does it cost?')
    expect((root.querySelector('.panel') as HTMLElement).dataset.open).toBe('true')
  })

  it('asks quietly, so it reads as the agent speaking first', async () => {
    // The visitor never typed it, so showing it puts words in their mouth, and
    // the panel stays shut until there is something worth opening it for.
    const sent: string[] = []
    stub(sent)
    const { widget, root } = floating()

    widget.open({ ask: 'what does it cost?', quietly: true })
    expect((root.querySelector('.panel') as HTMLElement).dataset.open).toBe('false')

    await settle()

    expect(sent).toEqual(['what does it cost?'])
    expect(root.textContent).not.toContain('what does it cost?')
    expect(root.textContent).toContain('Our plans start at £9.')
    expect((root.querySelector('.panel') as HTMLElement).dataset.open).toBe('true')
  })

  it('stays shut when the quiet ask fails, and does not open on the next one', async () => {
    // The listener that opens the panel has to go whatever happened, or a
    // failed proactive message opens the panel on whatever the visitor asks
    // next, which reads as the widget opening itself at random.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const { widget, root } = floating()
    const panel = () => (root.querySelector('.panel') as HTMLElement).dataset.open

    widget.open({ ask: 'what does it cost?', quietly: true })
    await settle()
    expect(panel()).toBe('false')

    const sent: string[] = []
    stub(sent)
    await widget.ask('and delivery?')
    await settle()

    expect(panel()).toBe('false')
  })

  it('just opens when given nothing', () => {
    const { widget, root } = floating()
    widget.open()

    expect((root.querySelector('.panel') as HTMLElement).dataset.open).toBe('true')
  })
})

describe('opening with more than one message', () => {
  it('draws each as its own bubble rather than one paragraph', () => {
    const { root } = mount({ greeting: ['Hi there.', 'I can help with orders and returns.'] })

    expect(root.textContent).toContain('Hi there.')
    expect(root.textContent).toContain('I can help with orders and returns.')
    expect(root.querySelectorAll('.msg[data-role="assistant"]').length).toBeGreaterThanOrEqual(2)
  })

  it('still takes a single greeting', () => {
    const { root } = mount({ greeting: 'Ask us anything.' })

    expect(root.textContent).toContain('Ask us anything.')
    expect(root.querySelectorAll('.msg[data-role="assistant"]')).toHaveLength(1)
  })

  it('drops an empty one rather than drawing a blank bubble', () => {
    const { root } = mount({ greeting: ['Hi there.', '   ', ''] })

    expect(root.querySelectorAll('.msg[data-role="assistant"]')).toHaveLength(1)
  })

  it('can be replaced and put back at runtime', () => {
    const { widget, root } = mount({ greeting: 'Ask us anything.' })

    widget.setOptions({ greeting: ['Looking at our pricing?', 'I can talk you through the plans.'] })
    expect(root.textContent).toContain('talk you through the plans')

    widget.resetOptions({ greeting: true })
    expect(root.textContent).toContain('Ask us anything.')
    expect(root.textContent).not.toContain('talk you through the plans')
  })
})
