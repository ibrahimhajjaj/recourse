import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'
import { openDeepLink, readDeepLink } from '../src/deeplink.js'

beforeEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

// The URL is shared state, and a widget built anywhere reads it now. Leaving a
// question in it makes some later test's widget ask one, which is a confusing
// way to find out this feature works.
afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
})

describe('reading the question out of a link', () => {
  it('finds the namespaced parameter', () => {
    expect(readDeepLink({ href: 'https://shop.example/billing?recourse_q=where+is+my+order', strip: false })).toBe(
      'where is my order',
    )
  })

  it('accepts the short alias', () => {
    expect(readDeepLink({ href: 'https://shop.example/?rc_q=refunds', strip: false })).toBe('refunds')
  })

  it('ignores a plain search box', () => {
    // Half the web already uses `?q=`. Answering somebody's site search in the
    // chat window is not what they asked for.
    expect(readDeepLink({ href: 'https://shop.example/search?q=blue+shoes', strip: false })).toBeNull()
    expect(readDeepLink({ href: 'https://shop.example/?search=hats', strip: false })).toBeNull()
  })

  it('is null when there is no question at all', () => {
    expect(readDeepLink({ href: 'https://shop.example/billing', strip: false })).toBeNull()
  })

  it('treats an empty or blank parameter as absent', () => {
    expect(readDeepLink({ href: 'https://shop.example/?recourse_q=', strip: false })).toBeNull()
    expect(readDeepLink({ href: 'https://shop.example/?recourse_q=%20%20', strip: false })).toBeNull()
  })

  it('caps a very long one', () => {
    const long = 'a'.repeat(5000)
    expect(readDeepLink({ href: `https://shop.example/?recourse_q=${long}`, strip: false })).toHaveLength(1000)
  })

  it('takes the canonical parameter when both are present', () => {
    expect(readDeepLink({ href: 'https://shop.example/?rc_q=second&recourse_q=first', strip: false })).toBe('first')
  })

  it('honours a parameter name the deployment chose', () => {
    expect(readDeepLink({ href: 'https://shop.example/?ask=hello', params: ['ask'], strip: false })).toBe('hello')
  })

  it('survives a location it cannot parse', () => {
    expect(readDeepLink({ href: 'not a url', strip: false })).toBeNull()
  })
})

describe('taking the question out of the address bar', () => {
  it('removes it so a refresh does not ask again', () => {
    window.history.replaceState({}, '', '/billing?recourse_q=where+is+my+order&utm_source=email')

    expect(readDeepLink()).toBe('where is my order')
    expect(window.location.search).not.toContain('recourse_q')
    // Only the question goes. Everything else on the URL is somebody's data.
    expect(window.location.search).toContain('utm_source=email')
    // And the second read finds nothing, which is the whole point.
    expect(readDeepLink()).toBeNull()
  })

  it('leaves it alone when asked to', () => {
    window.history.replaceState({}, '', '/?recourse_q=hello')
    readDeepLink({ strip: false })
    expect(window.location.search).toContain('recourse_q')
  })
})

describe('a widget on a linked page', () => {
  it('opens and asks without the visitor typing', () => {
    window.history.replaceState({}, '', '/?recourse_q=how+do+I+get+a+refund')

    const asked: string[] = []
    const widget = { open: vi.fn(), ask: (question: string) => void asked.push(question) }

    expect(openDeepLink(widget)).toBe('how do I get a refund')
    expect(widget.open).toHaveBeenCalled()
    expect(asked).toEqual(['how do I get a refund'])
  })

  it('does nothing on an ordinary page', () => {
    const widget = { open: vi.fn(), ask: vi.fn() }

    expect(openDeepLink(widget)).toBeNull()
    expect(widget.open).not.toHaveBeenCalled()
    expect(widget.ask).not.toHaveBeenCalled()
  })

  it('fires through createWidget by default', async () => {
    window.history.replaceState({}, '', '/?recourse_q=refunds')
    const fetched = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetched)

    createWidget({ endpoint: 'https://api.example/chat' })
    await Promise.resolve()

    expect(fetched).toHaveBeenCalled()
    const body = JSON.parse(String((fetched.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(body.messages.at(-1)?.content).toBe('refunds')

    vi.unstubAllGlobals()
  })

  it('can be turned off', async () => {
    window.history.replaceState({}, '', '/?recourse_q=refunds')
    const fetched = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetched)

    createWidget({ endpoint: 'https://api.example/chat', deepLink: false })
    await Promise.resolve()

    expect(fetched).not.toHaveBeenCalled()
    // And the parameter is left where it was, for whatever else reads it.
    expect(window.location.search).toContain('recourse_q')

    vi.unstubAllGlobals()
  })
})
