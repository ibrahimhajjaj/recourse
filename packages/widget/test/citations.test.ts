import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'

/**
 * The number a reader sees against a source.
 *
 * Only the cited pages are listed, so a page's place in that list is not the
 * number the answer used. A visitor reading "[3]" against a list of two has to
 * be able to tell which one it means.
 */

function mount() {
  const target = document.createElement('div')
  document.body.appendChild(target)

  createWidget({ endpoint: 'https://example.com/api/chat', target, open: true, persist: false })

  const root = target.querySelector('div')?.shadowRoot as ShadowRoot
  if (!root) throw new Error('the widget did not mount a shadow root')

  return root
}

const SIX = [
  { title: 'One' },
  { title: 'Two' },
  { title: 'Three', section: 'What it costs' },
  { title: 'Four' },
  { title: 'Five' },
  { title: 'Six' },
]

/** Streams the given answer back with a fixed six-source list in front of it. */
function stub(answer: string, sources: unknown[] = SIX) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const frames = [
        `data: ${JSON.stringify({ type: 'sources', sources })}\n\n`,
        `data: ${JSON.stringify({ type: 'delta', text: answer })}\n\n`,
        'data: {"type":"done"}\n\n',
      ]
      return new Response(frames.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }),
  )
}

async function ask(root: ShadowRoot, text = 'what it costs'): Promise<string[]> {
  const input = root.querySelector('textarea') as HTMLTextAreaElement
  input.value = text
  ;(root.querySelector('form.composer') as HTMLFormElement).dispatchEvent(
    new Event('submit', { cancelable: true }),
  )

  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const chips = [...root.querySelectorAll('.sources a, .sources span')]
    if (chips.length > 0) return chips.map((chip) => chip.textContent ?? '')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  throw new Error('timed out waiting for the sources to appear')
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('showing which source a citation points at', () => {
  it('keeps the answer\'s own number, not the position in the shortened list', async () => {
    stub('It costs $0.07 a minute [1], or half a cent yourself [3].')
    const chips = await ask(mount())

    expect(chips).toHaveLength(2)
    expect(chips[0]).toBe('[1] One')
    // The third of six is the second on screen, and it still says three.
    expect(chips[1]).toBe('[3] Three · What it costs')
  })

  it('puts both numbers on a page the answer cited twice', async () => {
    stub('First [1], and again [2].', [{ title: 'One' }, { title: 'One' }, { title: 'Other' }])
    const chips = await ask(mount())

    expect(chips).toHaveLength(1)
    expect(chips[0]).toBe('[1] [2] One')
  })

  it('names the sources without numbers when the answer cited none', async () => {
    // Citing nothing is not evidence that nothing was used, so the pages are
    // still listed. There is just no number to put on them.
    stub('It costs about half a cent a minute.', [{ title: 'One' }, { title: 'Two' }])
    const chips = await ask(mount())

    expect(chips).toEqual(['One', 'Two'])
  })

  it('drops a citation pointing at a source that was never sent', async () => {
    stub('As set out in [9].', [{ title: 'One' }])
    const chips = await ask(mount())

    // Nothing answers to [9], so nothing is claimed for it. The one page that
    // did come back is still named rather than hidden.
    expect(chips).toEqual(['One'])
  })
})
