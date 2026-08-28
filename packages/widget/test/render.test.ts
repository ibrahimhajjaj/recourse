import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/render.js'

function html(text: string): string {
  const host = document.createElement('div')
  host.appendChild(renderMarkdown(text))
  return host.innerHTML
}

function render(text: string): HTMLElement {
  const host = document.createElement('div')
  host.appendChild(renderMarkdown(text))
  return host
}

describe('the renderer is a security boundary', () => {
  // Everything here reaches the page as model output, which in turn saw the
  // visitor's own message. If any of it executed, every site embedding the
  // widget would have a cross-site scripting hole.
  it('renders a script tag as text, not as a script', () => {
    const host = render('<script>alert(1)</script>')
    expect(host.querySelector('script')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script>')
  })

  it('renders an image with an error handler as text', () => {
    const host = render('<img src=x onerror="alert(1)">')
    expect(host.querySelector('img')).toBeNull()
    // The angle brackets come back escaped, so the payload is literal text.
    // It is safe precisely because "onerror=" is characters, not an attribute.
    expect(html('<img src=x onerror="alert(1)">')).toContain('&lt;img')
    expect(host.querySelector('[onerror]')).toBeNull()
  })

  it('never emits an iframe, object or embed', () => {
    const host = render('<iframe src="https://evil.example"></iframe><object></object><embed>')
    expect(host.querySelector('iframe, object, embed')).toBeNull()
  })

  it('strips a javascript: link but keeps its text', () => {
    const host = render('[click me](javascript:alert(1))')
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('click me')
  })

  it('strips a data: link', () => {
    const host = render('[x](data:text/html,<script>alert(1)</script>)')
    expect(host.querySelector('a')).toBeNull()
  })

  it('adds no inline event handlers to anything it builds', () => {
    const host = render('**a** `b` [c](https://example.com)\n\n- item\n\n```\ncode\n```')
    for (const node of host.querySelectorAll('*')) {
      expect([...node.attributes].some((attribute) => attribute.name.startsWith('on'))).toBe(false)
    }
  })

  it('opens external links safely', () => {
    const anchor = render('[docs](https://example.com/help)').querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com/help')
    expect(anchor?.rel).toBe('noopener noreferrer')
    expect(anchor?.target).toBe('_blank')
  })

  it('allows relative and mailto links', () => {
    expect(render('[a](/help)').querySelector('a')).not.toBeNull()
    expect(render('[b](mailto:hi@example.com)').querySelector('a')).not.toBeNull()
  })
})

describe('markdown the model actually produces', () => {
  it('renders bold, italic and inline code', () => {
    const host = render('**bold** and *italic* and `code`')
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect(host.querySelector('em')?.textContent).toBe('italic')
    expect(host.querySelector('code')?.textContent).toBe('code')
  })

  it('renders bullet and numbered lists', () => {
    expect(render('- one\n- two').querySelectorAll('li')).toHaveLength(2)
    expect(render('1. one\n2. two').querySelector('ol')).not.toBeNull()
  })

  it('keeps a fenced code block verbatim', () => {
    const host = render('```\nnpm i helpdeck\n```')
    expect(host.querySelector('pre code')?.textContent).toBe('npm i helpdeck')
  })

  it('does not treat a list marker inside a code fence as a list', () => {
    const host = render('```\n- not a list\n```')
    expect(host.querySelector('li')).toBeNull()
  })

  it('splits paragraphs on blank lines', () => {
    expect(render('one\n\ntwo').querySelectorAll('p')).toHaveLength(2)
  })

  it('survives partially streamed markdown without throwing', () => {
    const partial = 'Delivery takes **4 to 7'
    expect(() => render(partial)).not.toThrow()
    expect(render(partial).textContent).toContain('Delivery takes')
  })

  it('renders empty input as nothing', () => {
    expect(render('').children).toHaveLength(0)
  })
})

// The citation filter lives in widget.ts behind a closure, so its rule is
// restated here as the contract the server and client both depend on.
describe('citation numbering contract', () => {
  function citedOnly(refs: Array<{ title: string; url?: string; section?: string }>, answer: string) {
    const used = new Set<number>()
    for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
      used.add(Number.parseInt(match[1] as string, 10) - 1)
    }
    const cited = used.size > 0 ? refs.filter((_, position) => used.has(position)) : refs
    const seen = new Set<string>()
    return cited.filter((ref) => {
      const key = `${ref.url ?? ''}|${ref.title}|${ref.section ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const refs = [
    { title: 'Shipping', section: 'Cost', url: '/s' },
    { title: 'Coffee', section: 'Storage', url: '/c' },
    { title: 'Returns', section: 'Window', url: '/r' },
    { title: 'Shipping', section: 'Times', url: '/s2' },
  ]

  it('resolves a high citation number that a deduplicating server would have lost', () => {
    // This is the real bug: the model cited [4] and only two refs existed.
    const shown = citedOnly(refs, 'Costs £12 [1] and takes 4 to 7 days [4].')
    expect(shown.map((r) => r.section)).toEqual(['Cost', 'Times'])
  })

  it('collapses two citations of the same page into one pill', () => {
    const same = [
      { title: 'Shipping', section: 'Cost', url: '/s' },
      { title: 'Shipping', section: 'Cost', url: '/s' },
    ]
    expect(citedOnly(same, 'see [1] and [2]')).toHaveLength(1)
  })

  it('falls back to every source when the model cited none', () => {
    expect(citedOnly(refs, 'no citations here')).toHaveLength(4)
  })

  it('ignores a citation number past the end of the list', () => {
    expect(citedOnly(refs, 'see [99]')).toEqual([])
  })
})
