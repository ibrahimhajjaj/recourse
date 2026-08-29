import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'

/**
 * The composer lives in a shadow root, so every query goes through the host.
 * Mounting inline keeps the launcher out of the way.
 */
function mount(options: Record<string, unknown> = {}) {
  const target = document.createElement('div')
  document.body.appendChild(target)

  const widget = createWidget({
    endpoint: 'https://example.com/api/chat',
    target,
    open: true,
    persist: false,
    ...options,
  })

  const root = (target.querySelector('div')?.shadowRoot ?? null) as ShadowRoot | null
  if (!root) throw new Error('the widget did not mount a shadow root')

  return { widget, root, target }
}

function file(name: string, type: string, bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

/** Drives the change handler the way a picker does, since happy-dom has no dialog. */
function pick(root: ShadowRoot, files: File[]) {
  const picker = root.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(picker, 'files', { value: files, configurable: true })
  picker.dispatchEvent(new Event('change'))
}

/**
 * Waits for the DOM to reach a state rather than for a fixed number of
 * milliseconds.
 *
 * A fixed delay is a bet on how busy the machine is. FileReader and the fetch
 * mock both resolve on their own schedule, and a 20ms wait that passes on an
 * idle laptop fails in CI while something else is compiling.
 */
async function until(condition: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A few turns of the event loop, for the cases with nothing to wait on. */
async function settle() {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 1))
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('the attach button', () => {
  it('is absent unless attachments are turned on', () => {
    const { root } = mount()
    expect(root.querySelector('button.attach')).toBeNull()
    expect(root.querySelector('input[type="file"]')).toBeNull()
  })

  it('appears when they are', () => {
    const { root } = mount({ attachments: true })
    expect(root.querySelector('button.attach')).not.toBeNull()
    expect(root.querySelector('input[type="file"]')).not.toBeNull()
  })

  it('offers the accepted types in the picker', () => {
    const { root } = mount({ attachments: true })
    const picker = root.querySelector('input[type="file"]') as HTMLInputElement

    expect(picker.accept).toContain('image/png')
    expect(picker.accept).toContain('application/pdf')
    expect(picker.accept).not.toContain('application/x-msdownload')
  })
})

describe('staging a file', () => {
  it('shows a removable chip for what was picked', async () => {
    const { root } = mount({ attachments: true })
    pick(root, [file('damage.png', 'image/png')])
    await until(() => root.querySelector('.tray .chip') !== null, 'the chip to appear')

    const chip = root.querySelector('.tray .chip')
    expect(chip?.textContent).toContain('damage.png')

    ;(chip?.querySelector('button') as HTMLButtonElement).click()
    expect(root.querySelector('.tray .chip')).toBeNull()
  })

  it('refuses a type the server would refuse anyway', async () => {
    const { root } = mount({ attachments: true })
    pick(root, [file('payload.exe', 'application/x-msdownload')])
    await until(() => !(root.querySelector('.error') as HTMLElement).hidden, 'the error to show')

    expect(root.querySelector('.tray .chip')).toBeNull()
    expect((root.querySelector('.error') as HTMLElement).textContent).toContain('payload.exe')
  })

  it('refuses a file over the cap before uploading it', async () => {
    const { root } = mount({ attachments: { maxBytes: 100 } })
    pick(root, [file('big.png', 'image/png', 5000)])
    await until(() => !(root.querySelector('.error') as HTMLElement).hidden, 'the error to show')

    expect(root.querySelector('.tray .chip')).toBeNull()
    expect((root.querySelector('.error') as HTMLElement).textContent).toContain('big.png')
  })

  it('stops at the count limit', async () => {
    const { root } = mount({ attachments: { maxCount: 2 } })
    pick(root, [
      file('a.png', 'image/png'),
      file('b.png', 'image/png'),
      file('c.png', 'image/png'),
    ])
    await until(() => root.querySelectorAll('.tray .chip').length === 2, 'two chips')

    expect(root.querySelectorAll('.tray .chip')).toHaveLength(2)
    expect((root.querySelector('.error') as HTMLElement).textContent).toContain('2 files')
  })

  it('renders a hostile filename as text, never as markup', async () => {
    const { root } = mount({ attachments: true })
    pick(root, [file('<img src=x onerror=alert(1)>.png', 'image/png')])
    await until(() => root.querySelector('.tray .chip') !== null, 'the chip to appear')

    const chip = root.querySelector('.tray .chip') as HTMLElement
    expect(chip.querySelector('img')).toBeNull()
    expect(chip.textContent).toContain('onerror')
  })
})

describe('sending', () => {
  /** A stub endpoint that records the body and streams one delta back. */
  function stubFetch() {
    const bodies: Array<Record<string, unknown>> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        const frames = ['data: {"type":"delta","text":"ok"}\n\n', 'data: {"type":"done"}\n\n']
        return new Response(frames.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }),
    )

    return bodies
  }

  async function submit(root: ShadowRoot, text: string) {
    const input = root.querySelector('textarea') as HTMLTextAreaElement
    input.value = text
    ;(root.querySelector('form.composer') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    )
    await settle()
  }

  it('sends staged files with the message and clears the tray', async () => {
    const bodies = stubFetch()
    const { root } = mount({ attachments: true })

    pick(root, [file('damage.png', 'image/png')])
    await until(() => root.querySelector('.tray .chip') !== null, 'the chip to appear')
    await submit(root, 'is this covered?')
    await until(() => bodies.length > 0, 'the request to be sent')

    const sent = bodies[0]?.attachments as Array<{ name: string; mimeType: string; dataUrl: string }>
    expect(sent).toHaveLength(1)
    expect(sent[0]?.name).toBe('damage.png')
    expect(sent[0]?.mimeType).toBe('image/png')
    expect(sent[0]?.dataUrl.startsWith('data:')).toBe(true)

    // Sent once, so a follow-up question does not re-upload the same image.
    expect(root.querySelector('.tray .chip')).toBeNull()
    await submit(root, 'and how long does it take?')
    expect(bodies[1]?.attachments).toBeUndefined()
  })

  it('sends a file with no message at all', async () => {
    const bodies = stubFetch()
    const { root } = mount({ attachments: true })

    pick(root, [file('damage.png', 'image/png')])
    await until(() => root.querySelector('.tray .chip') !== null, 'the chip to appear')
    await submit(root, '')
    await until(() => bodies.length > 0, 'the request to be sent')

    expect(bodies).toHaveLength(1)
    expect((bodies[0]?.attachments as unknown[]).length).toBe(1)
  })

  it('still sends nothing when there is neither text nor a file', async () => {
    const bodies = stubFetch()
    const { root } = mount({ attachments: true })

    await submit(root, '   ')
    expect(bodies).toHaveLength(0)
  })

  it('shows a thumbnail of what was sent under the message', async () => {
    stubFetch()
    const { root } = mount({ attachments: true })

    pick(root, [file('damage.png', 'image/png')])
    await until(() => root.querySelector('.tray .chip') !== null, 'the chip to appear')
    await submit(root, 'here')
    await until(() => root.querySelector('.msg[data-role="user"] .attached') !== null, 'the thumbnail')

    const thumb = root.querySelector('.msg[data-role="user"] .attached img') as HTMLImageElement
    expect(thumb).not.toBeNull()
    expect(thumb.alt).toBe('damage.png')
  })

  it('names a document rather than trying to show it', async () => {
    stubFetch()
    const { root } = mount({ attachments: true })

    pick(root, [file('invoice.pdf', 'application/pdf')])
    await until(() => root.querySelector('.tray .chip') !== null, 'the chip to appear')
    await submit(root, 'is this paid?')
    await until(() => root.querySelector('.msg[data-role="user"] .attached') !== null, 'the chip row')

    const row = root.querySelector('.msg[data-role="user"] .attached') as HTMLElement
    expect(row.querySelector('img')).toBeNull()
    expect(row.textContent).toContain('invoice.pdf')
  })

  it('shows a server notice about a refused file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"notice","message":"virus.exe was not attached: not accepted."}\n\ndata: {"type":"delta","text":"ok"}\n\ndata: {"type":"done"}\n\n',
            { status: 200 },
          ),
      ),
    )

    const { root } = mount({ attachments: true })
    await submit(root, 'here')
    await until(() => root.querySelector('.notice') !== null, 'the notice')

    expect((root.querySelector('.notice') as HTMLElement).textContent).toContain('virus.exe')
  })
})
