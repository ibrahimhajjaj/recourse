import { renderMarkdown } from './render.js'
import { streamChat } from './stream.js'
import { styles } from './styles.js'
import type { ChatMessage, SourceRef, WidgetOptions } from './types.js'

/**
 * Namespaced by endpoint, so two widgets on one page (or two sites sharing an
 * origin) keep separate transcripts instead of reading each other's.
 */
function storageKey(endpoint: string): string {
  return `helpdeck:transcript:${endpoint}`
}

const ICONS = {
  chat: 'M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z',
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M4 12l16-8-6 8 6 8z',
}

/** Mounts the widget. Returns handles so the host page can drive it. */
export function createWidget(options: WidgetOptions) {
  if (!options.endpoint) throw new Error('helpdeck: an `endpoint` is required')

  const inline = Boolean(options.target)
  const host = document.createElement('div')
  host.setAttribute('data-helpdeck', '')
  if (inline) host.setAttribute('data-inline', 'true')
  // Deliberately not `all: initial` here. The :host rule already does that and
  // then re-declares the widget's own font and colours; setting it inline would
  // outrank the stylesheet and leave every property at its browser default,
  // which is how you end up with a serif chat widget.
  host.style.cssText = inline ? 'display:block;width:100%;height:100%' : ''

  const root = host.attachShadow({ mode: 'open' })
  const sheet = document.createElement('style')
  sheet.textContent = styles
  root.appendChild(sheet)

  if (options.accent) host.style.setProperty('--hd-accent', options.accent)
  applyTheme(host, options.theme ?? 'auto')

  const side = options.position === 'bottom-left' ? 'pos-left' : 'pos-right'
  const state: { messages: ChatMessage[]; busy: boolean; controller: AbortController | null } = {
    messages: options.persist === false ? [] : restore(options.endpoint),
    busy: false,
    controller: null,
  }

  // ---- structure -----------------------------------------------------------

  const launcher = document.createElement('button')
  launcher.className = `launcher ${side}`
  launcher.type = 'button'
  launcher.setAttribute('aria-label', 'Open the support chat')
  launcher.setAttribute('aria-expanded', 'false')
  launcher.appendChild(icon(ICONS.chat, true))

  const panel = document.createElement('div')
  panel.className = `panel ${side}`
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-label', options.title ?? 'Support chat')
  panel.dataset.open = String(inline || options.open === true)

  const header = document.createElement('div')
  header.className = 'header'
  const heading = document.createElement('div')
  heading.className = 'grow'
  const title = document.createElement('h2')
  title.textContent = options.title ?? 'Ask us anything'
  heading.appendChild(title)
  if (options.subtitle) {
    const subtitle = document.createElement('p')
    subtitle.textContent = options.subtitle
    heading.appendChild(subtitle)
  }
  header.appendChild(heading)

  const close = document.createElement('button')
  close.className = 'icon-button'
  close.type = 'button'
  close.setAttribute('aria-label', 'Close the support chat')
  close.appendChild(icon(ICONS.close, false))
  if (!inline) header.appendChild(close)

  const log = document.createElement('div')
  log.className = 'log'
  log.setAttribute('role', 'log')
  // Polite so a screen reader finishes the current sentence before the answer.
  log.setAttribute('aria-live', 'polite')
  log.setAttribute('aria-relevant', 'additions text')

  const suggestions = document.createElement('div')
  suggestions.className = 'suggestions'

  const errorBox = document.createElement('div')
  errorBox.className = 'error'
  errorBox.hidden = true
  errorBox.setAttribute('role', 'alert')

  const composer = document.createElement('form')
  composer.className = 'composer'
  const input = document.createElement('textarea')
  input.rows = 1
  input.placeholder = 'Type your question'
  input.setAttribute('aria-label', 'Your question')
  const send = document.createElement('button')
  send.type = 'submit'
  send.setAttribute('aria-label', 'Send')
  send.appendChild(icon(ICONS.send, true))
  composer.append(input, send)

  panel.append(header, log, suggestions, errorBox, composer)
  if (!inline) root.append(launcher, panel)
  else root.append(panel)
  ;(options.target ?? document.body).appendChild(host)

  // ---- behaviour -----------------------------------------------------------

  function setOpen(open: boolean) {
    panel.dataset.open = String(open)
    launcher.setAttribute('aria-expanded', String(open))
    launcher.setAttribute('aria-label', open ? 'Close the support chat' : 'Open the support chat')
    if (open) input.focus()
    else launcher.focus()
  }

  function showError(message: string) {
    errorBox.textContent = message
    errorBox.hidden = false
  }

  function scrollToEnd() {
    log.scrollTop = log.scrollHeight
  }

  /**
   * Keeps only the sources the answer actually cited as [n].
   *
   * The retriever deliberately hands the model more context than it needs, so
   * listing all of it under the reply would show the visitor pages the answer
   * never came from. Citing the retrieval set rather than the answer is how a
   * support bot ends up looking like it made something up.
   */
  function citedOnly(refs: SourceRef[], answer: string): SourceRef[] {
    const used = new Set<number>()
    for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
      used.add(Number.parseInt(match[1] as string, 10) - 1)
    }

    const cited = refs.filter((_, position) => used.has(position))
    // A model that cited nothing is not evidence that nothing was used.
    return cited.length > 0 ? cited : refs
  }

  function paintSources(container: HTMLElement, refs: SourceRef[]) {
    if (refs.length === 0) return
    const list = document.createElement('div')
    list.className = 'sources'

    for (const ref of refs.slice(0, 4)) {
      const label = ref.section ? `${ref.title} · ${ref.section}` : ref.title
      // A source without a URL is still worth naming, just not linking.
      const node = document.createElement(ref.url ? 'a' : 'span')
      node.textContent = label
      if (ref.url && node instanceof HTMLAnchorElement) {
        node.href = ref.url
        node.target = '_blank'
        node.rel = 'noopener noreferrer'
      }
      list.appendChild(node)
    }

    container.appendChild(list)
  }

  function paintMessage(message: ChatMessage): { bubble: HTMLElement; wrapper: HTMLElement } {
    const wrapper = document.createElement('div')
    wrapper.className = 'msg'
    wrapper.dataset.role = message.role

    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    if (message.role === 'user') bubble.textContent = message.content
    else bubble.appendChild(renderMarkdown(message.content))

    wrapper.appendChild(bubble)
    if (message.sources) paintSources(wrapper, message.sources)
    log.appendChild(wrapper)
    scrollToEnd()
    return { bubble, wrapper }
  }

  function paintSuggestions() {
    suggestions.replaceChildren()
    // Starters are only useful before the conversation has a subject.
    if (state.messages.length > 0 || !options.suggestions?.length) return

    for (const text of options.suggestions.slice(0, 4)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = text
      button.addEventListener('click', () => void ask(text))
      suggestions.appendChild(button)
    }
  }

  function repaint() {
    log.replaceChildren()
    if (options.greeting) {
      paintMessage({ role: 'assistant', content: options.greeting })
    }
    for (const message of state.messages) paintMessage(message)
    paintSuggestions()
  }

  async function ask(question: string) {
    const text = question.trim()
    if (!text || state.busy) return

    errorBox.hidden = true
    state.busy = true
    send.disabled = true

    const outgoing: ChatMessage = { role: 'user', content: text }
    state.messages.push(outgoing)
    paintMessage(outgoing)
    paintSuggestions()

    const { bubble, wrapper } = paintMessage({ role: 'assistant', content: '' })
    const typing = document.createElement('span')
    typing.className = 'typing'
    typing.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
    bubble.appendChild(typing)

    const answer: ChatMessage = { role: 'assistant', content: '' }
    let sources: SourceRef[] = []
    state.controller = new AbortController()

    await streamChat(
      options.endpoint,
      state.messages,
      {
        onSources: (refs) => {
          sources = refs
        },
        onDelta: (delta) => {
          typing.remove()
          answer.content += delta
          // Re-rendering the whole bubble keeps partial markdown coherent as it
          // streams; the text is small enough that this costs nothing.
          bubble.replaceChildren(renderMarkdown(answer.content))
          scrollToEnd()
        },
        onError: (message) => {
          typing.remove()
          showError(message)
        },
      },
      state.controller.signal,
    )

    typing.remove()

    if (answer.content.trim()) {
      answer.sources = citedOnly(sources, answer.content)
      state.messages.push(answer)
      paintSources(wrapper, answer.sources)
      persist(options.endpoint, state.messages, options.persist !== false)
    } else {
      // Nothing came back, so leave no empty bubble behind.
      wrapper.remove()
      state.messages.pop()
      paintSuggestions()
    }

    state.busy = false
    send.disabled = false
    state.controller = null
    scrollToEnd()
    input.focus()
  }

  launcher.addEventListener('click', () => setOpen(panel.dataset.open !== 'true'))
  close.addEventListener('click', () => setOpen(false))

  composer.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = input.value
    input.value = ''
    input.style.height = 'auto'
    void ask(text)
  })

  input.addEventListener('input', () => {
    // Grow with the text, up to the max-height the stylesheet enforces.
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      composer.requestSubmit()
    }
  })

  root.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && !inline) setOpen(false)
  })

  repaint()

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    ask,
    clear() {
      state.messages = []
      persist(options.endpoint, [], options.persist !== false)
      repaint()
    },
    destroy() {
      state.controller?.abort()
      host.remove()
    },
    element: host,
  }
}

function applyTheme(host: HTMLElement, theme: 'light' | 'dark' | 'auto') {
  if (theme !== 'auto') {
    host.setAttribute('data-theme', theme)
    return
  }

  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const sync = () => host.setAttribute('data-theme', query.matches ? 'dark' : 'light')
  sync()
  query.addEventListener('change', sync)
}

function icon(path: string, filled: boolean): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', filled ? 'currentColor' : 'none')
  svg.setAttribute('stroke', filled ? 'none' : 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')

  const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  node.setAttribute('d', path)
  svg.appendChild(node)
  return svg
}

function restore(endpoint: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(endpoint))
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    // Private mode and blocked storage both throw. Neither is worth failing over.
    return []
  }
}

function persist(endpoint: string, messages: ChatMessage[], enabled: boolean) {
  if (!enabled) return
  try {
    sessionStorage.setItem(storageKey(endpoint), JSON.stringify(messages.slice(-20)))
  } catch {
    /* ignore */
  }
}
