import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'
import { DEFAULT_STRINGS } from '../src/strings.js'

/**
 * A step where the agent has offered the only replies it can act on.
 *
 * The text box goes with them, because a typed answer at that point is one the
 * flow will only ask for again. It has to come back on its own afterwards: a
 * widget a visitor cannot type into is the worst thing this can leave behind.
 */

function mount() {
  const target = document.createElement('div')
  document.body.appendChild(target)

  createWidget({ endpoint: 'https://example.com/api/chat', target, open: true, persist: false })

  const root = target.querySelector('div')?.shadowRoot as ShadowRoot
  if (!root) throw new Error('the widget did not mount a shadow root')

  return root
}

/** Streams back one answer plus a suggestions frame. */
function stub(items: string[], pickOne?: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const frames = [
        `data: ${JSON.stringify({ type: 'delta', text: 'Which one is it?' })}\n\n`,
        `data: ${JSON.stringify({ type: 'suggestions', items, ...(pickOne ? { pickOne: true } : {}) })}\n\n`,
        'data: {"type":"done"}\n\n',
      ]
      return new Response(frames.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }),
  )
}

const box = (root: ShadowRoot) => root.querySelector('textarea') as HTMLTextAreaElement

async function ask(root: ShadowRoot, text = 'I want to return something') {
  box(root).value = text
  ;(root.querySelector('form.composer') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))

  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (root.querySelectorAll('.suggestions button').length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  throw new Error('timed out waiting for the suggestions')
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('suggestions the visitor has to choose from', () => {
  it('closes the box and says why', async () => {
    const root = mount()
    stub(['It arrived damaged', 'I changed my mind'], true)
    await ask(root)

    expect(box(root).disabled).toBe(true)
    expect(box(root).placeholder).toBe(DEFAULT_STRINGS.choosePlaceholder)
    expect((root.querySelector('.composer button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens it again the moment one is chosen', async () => {
    const root = mount()
    stub(['It arrived damaged', 'I changed my mind'], true)
    await ask(root)

    // The next reply carries no suggestions frame at all, which is the ordinary
    // case and the one that leaves the box shut forever if nothing clears the
    // flag on the way out.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: {"type":"delta","text":"Sorry about that."}\n\ndata: {"type":"done"}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      ),
    )
    ;(root.querySelector('.suggestions button') as HTMLButtonElement).click()

    const deadline = Date.now() + 2000
    while (Date.now() < deadline && box(root).disabled) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(box(root).disabled).toBe(false)
    expect(box(root).placeholder).toBe(DEFAULT_STRINGS.placeholder)
  })

  it('leaves the box alone for ordinary suggestions', async () => {
    const root = mount()
    stub(['How long does a refund take?'])
    await ask(root)

    expect(root.querySelectorAll('.suggestions button')).toHaveLength(1)
    expect(box(root).disabled).toBe(false)
  })
})
