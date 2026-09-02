import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WidgetOptions } from '../src/types.js'

/**
 * `createWidget` is replaced because it returns a handle that does not carry
 * the options it was built from, and those options are the entire output of
 * this module. Nothing else can see what the data attributes turned into.
 *
 * Hoisted rather than created inside the factory: every case calls
 * `vi.resetModules()`, which makes the next import run the factory again, and a
 * spy born in there would be a different one each time while the assertions
 * still pointed at the first.
 */
const { created } = vi.hoisted(() => ({ created: vi.fn((_options: unknown) => ({})) }))

vi.mock('../src/widget.js', () => ({ createWidget: created }))

/** Loads the script the way a browser would, with a tag it can read itself off. */
async function load(attributes: Record<string, string>): Promise<void> {
  const script = document.createElement('script')
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(`data-${name}`, value)
  document.body.append(script)

  // happy-dom leaves `currentScript` null for a tag it never fetched, and that
  // property is where every attribute below is read from.
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true })

  vi.resetModules()
  await import('../src/embed.js')
}

/** The options the script handed to the widget, or a failure if it mounted none. */
async function mount(attributes: Record<string, string>): Promise<WidgetOptions> {
  await load(attributes)

  const options = created.mock.calls.at(-1)?.[0]
  if (!options) throw new Error('the embed script mounted nothing')

  return options as WidgetOptions
}

beforeEach(() => {
  document.body.innerHTML = ''
  delete window.recourseConfig
  created.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what a script tag turns into', () => {
  it('mounts once with the endpoint it was given', async () => {
    const options = await mount({ endpoint: '/api/chat' })

    expect(created).toHaveBeenCalledTimes(1)
    expect(options.endpoint).toBe('/api/chat')
  })

  it('mounts nothing at all without an endpoint', async () => {
    // The one attribute with no sensible default: mounting a widget that posts
    // nowhere would look like a working install right up until someone typed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await load({})

    expect(created).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).toContain('no data-endpoint')

    warn.mockRestore()
  })

  it('finds the element a target selector names', async () => {
    const panel = document.createElement('div')
    panel.id = 'panel'
    document.body.append(panel)

    const options = await mount({ endpoint: '/api/chat', target: '#panel' })

    expect(options.target).toBe(panel)
  })

  it('still mounts when the target selector matches nothing', async () => {
    // A container that has not rendered yet is a typo away from a page with no
    // widget on it, so the floating one is the fallback rather than the failure.
    const options = await mount({ endpoint: '/api/chat', target: '#missing' })

    expect(created).toHaveBeenCalledTimes(1)
    expect(options.target).toBeUndefined()
  })
})

describe('the attributes that are not strings once they are read', () => {
  it('turns the invite delay into a number', async () => {
    // An attribute is always a string, and a string here would be compared
    // against a number later and silently never fire.
    const options = await mount({ endpoint: '/api/chat', 'invite-delay': '4500' })

    expect(options.inviteDelay).toBe(4500)
    expect(typeof options.inviteDelay).toBe('number')
  })

  it('splits suggestions on the bar and drops the blanks', async () => {
    const options = await mount({ endpoint: '/api/chat', suggestions: 'Track my order | Refunds |  | Sizing' })

    expect(options.suggestions).toEqual(['Track my order', 'Refunds', 'Sizing'])
  })

  it('takes only the one position it offers, and otherwise the right', async () => {
    expect((await mount({ endpoint: '/api/chat', position: 'bottom-left' })).position).toBe('bottom-left')
    expect((await mount({ endpoint: '/api/chat', position: 'left' })).position).toBe('bottom-right')
    expect((await mount({ endpoint: '/api/chat', position: 'bottom-right' })).position).toBe('bottom-right')
    expect((await mount({ endpoint: '/api/chat' })).position).toBe('bottom-right')
  })

  it('takes only the two themes it offers, and otherwise follows the page', async () => {
    expect((await mount({ endpoint: '/api/chat', theme: 'dark' })).theme).toBe('dark')
    expect((await mount({ endpoint: '/api/chat', theme: 'light' })).theme).toBe('light')
    expect((await mount({ endpoint: '/api/chat', theme: 'blue' })).theme).toBe('auto')
    expect((await mount({ endpoint: '/api/chat' })).theme).toBe('auto')
  })

  it('leaves feedback, persist, deep links and copy on unless turned off', async () => {
    const on = await mount({ endpoint: '/api/chat' })

    expect(on.feedback).toBe(true)
    expect(on.persist).toBe(true)
    expect(on.deepLink).toBe(true)
    expect(on.copy).toBe(true)

    const off = await mount({
      endpoint: '/api/chat',
      feedback: 'false',
      persist: 'false',
      'deep-link': 'false',
      copy: 'false',
    })

    expect(off.feedback).toBe(false)
    expect(off.persist).toBe(false)
    expect(off.deepLink).toBe(false)
    expect(off.copy).toBe(false)
  })

  it('needs the exact word true to open on load or allow a deletion', async () => {
    const absent = await mount({ endpoint: '/api/chat' })

    expect(absent.open).toBe(false)
    expect(absent.allowDelete).toBe(false)

    const asked = await mount({ endpoint: '/api/chat', open: 'true', delete: 'true' })

    expect(asked.open).toBe(true)
    expect(asked.allowDelete).toBe(true)

    // Anything else is off, including the strings that read as agreement.
    const nearly = await mount({ endpoint: '/api/chat', open: 'yes', delete: '1' })

    expect(nearly.open).toBe(false)
    expect(nearly.allowDelete).toBe(false)
  })
})

describe('the attachments attribute, which is off, on, or a size', () => {
  it('stays off when absent or refused', async () => {
    expect((await mount({ endpoint: '/api/chat' })).attachments).toBeUndefined()
    expect((await mount({ endpoint: '/api/chat', attachments: 'false' })).attachments).toBeUndefined()
  })

  it('turns on with no cap for the word true', async () => {
    expect((await mount({ endpoint: '/api/chat', attachments: 'true' })).attachments).toBe(true)
  })

  it('reads a number as a cap in megabytes', async () => {
    expect((await mount({ endpoint: '/api/chat', attachments: '4' })).attachments).toEqual({ maxBytes: 4194304 })
  })

  it('stays off for a number that caps nothing', async () => {
    expect((await mount({ endpoint: '/api/chat', attachments: '0' })).attachments).toBeUndefined()
    expect((await mount({ endpoint: '/api/chat', attachments: 'lots' })).attachments).toBeUndefined()
  })
})

describe('the attributes that build an object out of several', () => {
  it('adds the microphone only when asked, and carries its settings', async () => {
    expect((await mount({ endpoint: '/api/chat' })).dictation).toBeUndefined()
    expect((await mount({ endpoint: '/api/chat', 'dictation-lang': 'ar' })).dictation).toBeUndefined()

    const options = await mount({
      endpoint: '/api/chat',
      dictation: 'true',
      'dictation-lang': 'ar',
      'dictation-cloud': 'true',
    })

    expect(options.dictation).toEqual({ lang: 'ar', allowCloudFallback: true })
  })

  it('takes the call route as a path, or as an object when the transport is named', async () => {
    expect((await mount({ endpoint: '/api/chat' })).call).toBeUndefined()
    expect((await mount({ endpoint: '/api/chat', call: '/api/voice/token' })).call).toBe('/api/voice/token')

    const hosted = await mount({
      endpoint: '/api/chat',
      call: '/api/voice/token',
      'call-transport': 'hosted',
    })

    expect(hosted.call).toEqual({ endpoint: '/api/voice/token', transport: 'hosted' })
  })

  it('nests the footnote where the rest of the copy lives', async () => {
    expect((await mount({ endpoint: '/api/chat' })).strings).toBeUndefined()

    const options = await mount({ endpoint: '/api/chat', footnote: 'You are chatting with an AI assistant' })

    expect(options.strings).toEqual({ footnote: 'You are chatting with an AI assistant' })
  })

  it('carries the plain string attributes through untouched', async () => {
    const options = await mount({
      endpoint: '/api/chat',
      'user-id': 'u-1',
      'user-hash': 'abc123',
      invite: 'Need a hand?',
      title: 'Ask us anything',
      subtitle: 'We usually reply at once',
      greeting: 'Hello',
      accent: '#0a7',
    })

    expect(options.userId).toBe('u-1')
    expect(options.userHash).toBe('abc123')
    expect(options.invite).toBe('Need a hand?')
    expect(options.title).toBe('Ask us anything')
    expect(options.subtitle).toBe('We usually reply at once')
    expect(options.greeting).toBe('Hello')
    expect(options.accent).toBe('#0a7')
  })
})

describe('the global a page can set instead', () => {
  it('lets the global win over an attribute of the same name', async () => {
    window.recourseConfig = { title: 'set in script' }

    const options = await mount({ endpoint: '/api/chat', title: 'set on the tag' })

    expect(options.title).toBe('set in script')
  })

  it('supplies the endpoint when the tag carries none', async () => {
    window.recourseConfig = { endpoint: '/from/config' }

    const options = await mount({})

    expect(options.endpoint).toBe('/from/config')
  })
})
