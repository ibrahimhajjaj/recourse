/**
 * A very small markdown renderer that builds DOM nodes instead of HTML strings.
 *
 * This is a security boundary, not a style choice. The text being rendered came
 * out of a language model, which in turn read the visitor's own message and the
 * business's scraped pages. Assigning any of that to innerHTML would hand every
 * site that embeds this widget a cross-site scripting hole. Nothing here can
 * produce script, iframes or event handlers, because nothing here parses HTML.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g
/** Only protocols that cannot execute script. `javascript:` never matches. */
const SAFE_URL = /^(https?:|mailto:|\/|#)/i

export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment()

  for (const block of splitBlocks(text)) {
    fragment.appendChild(renderBlock(block))
  }

  return fragment
}

interface Block {
  kind: 'p' | 'ul' | 'ol' | 'code'
  lines: string[]
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  let fence: Block | null = null

  const flush = () => {
    if (current && current.lines.length > 0) blocks.push(current)
    current = null
  }

  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fence) {
        blocks.push(fence)
        fence = null
      } else {
        flush()
        fence = { kind: 'code', lines: [] }
      }
      continue
    }

    if (fence) {
      fence.lines.push(line)
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const kind: Block['kind'] = bullet ? 'ul' : numbered ? 'ol' : 'p'
    const content = bullet?.[1] ?? numbered?.[1] ?? line

    if (!current || current.kind !== kind) {
      flush()
      current = { kind, lines: [] }
    }

    current.lines.push(content)
  }

  if (fence) blocks.push(fence)
  flush()
  return blocks
}

function renderBlock(block: Block): HTMLElement {
  if (block.kind === 'code') {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    // textContent, so a code sample containing markup stays a code sample.
    code.textContent = block.lines.join('\n')
    pre.appendChild(code)
    return pre
  }

  if (block.kind === 'ul' || block.kind === 'ol') {
    const list = document.createElement(block.kind)
    for (const line of block.lines) {
      const item = document.createElement('li')
      item.appendChild(renderInline(line))
      list.appendChild(item)
    }
    return list
  }

  const paragraph = document.createElement('p')
  paragraph.appendChild(renderInline(block.lines.join(' ')))
  return paragraph
}

function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment()

  for (const part of text.split(INLINE)) {
    if (!part) continue

    if (part.startsWith('**') && part.endsWith('**')) {
      fragment.appendChild(element('strong', part.slice(2, -2)))
      continue
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      fragment.appendChild(element('code', part.slice(1, -1)))
      continue
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      fragment.appendChild(element('em', part.slice(1, -1)))
      continue
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (link) {
      const href = link[2] as string
      if (SAFE_URL.test(href)) {
        const anchor = document.createElement('a')
        anchor.textContent = link[1] as string
        anchor.href = href
        anchor.target = '_blank'
        // Without noopener the opened page can navigate this one.
        anchor.rel = 'noopener noreferrer'
        fragment.appendChild(anchor)
      } else {
        fragment.appendChild(document.createTextNode(link[1] as string))
      }
      continue
    }

    fragment.appendChild(document.createTextNode(part))
  }

  return fragment
}

function element(tag: string, text: string): HTMLElement {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}
