import { renderMarkdown } from './render.js'
import { renderForm, renderUi, type UiContext } from './ui.js'
import { streamChat } from './stream.js'
import { styles } from './styles.js'
import type {
  ChatMessage,
  ClientActionHandler,
  EventName,
  SourceRef,
  StreamFrame,
  WidgetEvents,
  WidgetOptions,
} from './types.js'

/**
 * Namespaced by endpoint, so two widgets on one page (or two sites sharing an
 * origin) keep separate transcripts instead of reading each other's.
 */
function storageKey(endpoint: string): string {
  return `helpdeck:transcript:${endpoint}`
}

function inviteKey(endpoint: string): string {
  return `helpdeck:invite:${endpoint}`
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
  const state: {
    messages: ChatMessage[]
    busy: boolean
    controller: AbortController | null
    conversationId: string
    suggestions: string[]
  } = {
    messages: options.persist === false ? [] : restore(options.endpoint),
    busy: false,
    controller: null,
    // Groups this tab's turns into one thread in the transcript log.
    conversationId: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    suggestions: options.suggestions ?? [],
  }

  /** Handlers the agent can ask the page to run, by action name. */
  const handlers: Record<string, ClientActionHandler> = { ...options.actions }
  const invites: ReturnType<typeof setTimeout>[] = []
  const listeners = new Map<EventName, Set<(payload: never) => void>>()

  function emit<K extends EventName>(name: K, payload: WidgetEvents[K]) {
    for (const listener of listeners.get(name) ?? []) {
      try {
        ;(listener as (value: WidgetEvents[K]) => void)(payload)
      } catch (error) {
        // A broken host listener must not take the conversation down.
        console.error(`[helpdeck] listener for "${name}" threw`, error)
      }
    }
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
    emit(open ? 'open' : 'close', {})
    // Opening the panel answers the invitation, so it never needs asking again.
    if (open) root.querySelector('.invite')?.remove()
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
   * Keeps only the sources the answer actually cited as [n], then collapses
   * repeats of the same page.
   *
   * Order matters here. The server numbers one entry per retrieved passage so
   * the model's [n] lines up with the array index; deduplicating before the
   * filter would shift every number and credit the wrong page. Deduplicate
   * after, purely so the reader does not see the same page listed twice.
   */
  function citedOnly(refs: SourceRef[], answer: string): SourceRef[] {
    const used = new Set<number>()
    for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
      used.add(Number.parseInt(match[1] as string, 10) - 1)
    }

    // A model that cited nothing is not evidence that nothing was used.
    const cited = used.size > 0 ? refs.filter((_, position) => used.has(position)) : refs

    const seen = new Set<string>()
    const unique: SourceRef[] = []
    for (const ref of cited) {
      const key = `${ref.url ?? ''}|${ref.title}|${ref.section ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(ref)
    }

    return unique
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
    if (state.suggestions.length === 0) return

    for (const text of state.suggestions.slice(0, 4)) {
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

  /** Thumbs, so the host learns which answers were actually any good. */
  function paintFeedback(wrapper: HTMLElement, messageIndex: number) {
    if (options.feedback === false) return

    const row = document.createElement('div')
    row.className = 'feedback'

    for (const [value, label, glyph] of [
      ['positive', 'This answered my question', 'M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z'],
      ['negative', 'This did not help', 'M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z'],
    ] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'icon-button'
      button.setAttribute('aria-label', label)
      button.appendChild(icon(glyph, true))
      button.addEventListener('click', () => {
        button.setAttribute('aria-pressed', 'true')
        row.querySelectorAll('button').forEach((other) => {
          if (other !== button) other.removeAttribute('aria-pressed')
        })
        void sendFeedback(messageIndex, value)
      })
      row.appendChild(button)
    }

    wrapper.appendChild(row)
  }

  async function sendFeedback(messageIndex: number, value: 'positive' | 'negative') {
    try {
      await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: { conversationId: state.conversationId, messageIndex, value },
        }),
      })
    } catch {
      // Feedback is a nicety; failing to record it must not surface an error.
    }
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
    emit('message', { text })

    // Starters belong to the blank slate; the server can offer new ones later.
    state.suggestions = []
    paintSuggestions()

    state.controller = new AbortController()
    await runTurn()

    state.busy = false
    send.disabled = false
    state.controller = null
    scrollToEnd()
    input.focus()
  }

  /**
   * One request, plus the follow-up request a paused turn needs.
   *
   * When the agent asks the page to run something, the server has no answer to
   * give yet. The browser runs the handler and asks again with the result, and
   * only that second pass produces the reply the customer reads.
   */
  async function runTurn(actionResults?: Array<{ name: string; input?: unknown; output: unknown }>) {
    const { bubble, wrapper } = paintMessage({ role: 'assistant', content: '' })
    const typing = document.createElement('span')
    typing.className = 'typing'
    typing.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
    bubble.appendChild(typing)

    const answer: ChatMessage = { role: 'assistant', content: '' }
    let sources: SourceRef[] = []
    const requested: Array<{
      id: string
      name: string
      input: Record<string, unknown>
      payload?: Record<string, unknown>
    }> = []

    await streamChat(
      options.endpoint,
      {
        messages: state.messages,
        conversationId: state.conversationId,
        userId: options.userId,
        userHash: options.userHash,
        contact: options.contact,
        actionResults,
      },
      {
        onSources: (refs) => {
          sources = refs
        },
        onDelta: (delta) => {
          typing.remove()
          answer.content += delta
          bubble.replaceChildren(renderMarkdown(answer.content))
          scrollToEnd()
        },
        onError: (message) => {
          typing.remove()
          showError(message)
          emit('error', { message })
        },
        onFrame: (frame) => handleFrame(frame, requested),
      },
      state.controller?.signal,
    )

    typing.remove()

    // A paused turn produced no reply worth keeping; run what it asked for and
    // let the next pass render the real answer in its place.
    if (requested.length > 0 && !actionResults) {
      wrapper.remove()

      // A form is answered by the visitor, not by a handler, so the turn stops
      // here and resumes when they submit it.
      const form = requested.find((request) => request.payload?.form)
      if (form) {
        awaitingForm = { name: form.name, input: form.input }
        const node = renderForm(form.payload?.form as Record<string, unknown>, uiContext)
        const holder = document.createElement('div')
        holder.className = 'msg'
        holder.dataset.role = 'assistant'
        holder.appendChild(node)
        log.appendChild(holder)
        scrollToEnd()
        return
      }

      const results = await runClientActions(requested)
      await runTurn(results)
      return
    }

    if (answer.content.trim()) {
      answer.sources = citedOnly(sources, answer.content)
      state.messages.push(answer)
      paintSources(wrapper, answer.sources)
      paintFeedback(wrapper, state.messages.length - 1)
      persist(options.endpoint, state.messages, options.persist !== false)
      emit('response', { text: answer.content, sources: answer.sources })
    } else {
      // Nothing came back, so leave no empty bubble behind.
      wrapper.remove()
    }

    paintSuggestions()
  }

  function handleFrame(
    frame: StreamFrame,
    requested: Array<{
      id: string
      name: string
      input: Record<string, unknown>
      payload?: Record<string, unknown>
    }>,
  ) {
    if (frame.type === 'client-action') {
      requested.push({ id: frame.id, name: frame.name, input: frame.input, payload: frame.payload })
    } else if (frame.type === 'suggestions') {
      state.suggestions = frame.items
    } else if (frame.type === 'action') {
      emit('action', { name: frame.name, status: frame.status })
    } else if (frame.type === 'captured') {
      emit('captured', { kind: frame.kind, name: frame.name, values: frame.values })
    } else if (frame.type === 'handoff') {
      emit('handoff', { ticketId: frame.ticketId, message: frame.message })
      paintNotice(frame.message)
    } else if (frame.type === 'ui') {
      const node = renderUi({ kind: frame.kind, id: frame.id, data: frame.data }, uiContext)
      if (node) {
        const wrapper = document.createElement('div')
        wrapper.className = 'msg'
        wrapper.dataset.role = 'assistant'
        wrapper.appendChild(node)
        log.appendChild(wrapper)
        scrollToEnd()
      }
    }
  }

  /** What an inline component can do: type for the visitor, or answer a form. */
  const uiContext: UiContext = {
    submit: (value) => void ask(value),
    respond: (values) => void continueWithResult(values),
  }

  /** Pending client actions that a form will answer once it is filled in. */
  let awaitingForm: { name: string; input: Record<string, unknown> } | null = null

  async function continueWithResult(values: Record<string, unknown>) {
    const pending = awaitingForm
    awaitingForm = null
    if (!pending || state.busy) return

    state.busy = true
    send.disabled = true
    state.controller = new AbortController()

    await runTurn([{ name: pending.name, input: pending.input, output: values }])

    state.busy = false
    send.disabled = false
    state.controller = null
  }

  async function runClientActions(
    requested: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  ) {
    return Promise.all(
      requested.map(async (request) => {
        const handler = handlers[request.name]
        if (!handler) {
          // Told to the agent rather than thrown, so it can apologise properly
          // instead of the turn dying with an empty bubble.
          return { name: request.name, input: request.input, output: { error: 'no handler registered on this page' } }
        }
        try {
          return { name: request.name, input: request.input, output: await handler(request.input) }
        } catch (error) {
          return {
            name: request.name,
            input: request.input,
            output: { error: error instanceof Error ? error.message : String(error) },
          }
        }
      }),
    )
  }

  /** A small centred line for things that happened rather than were said. */
  function paintNotice(message: string) {
    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.textContent = message
    log.appendChild(notice)
    scrollToEnd()
  }

  /**
   * The nudge above the launcher.
   *
   * Shown once per tab and never again after it is dismissed or the panel is
   * opened: an invitation that keeps reappearing is an annoyance, and the
   * visitor has already told you the answer by closing it.
   */
  function showInvite() {
    if (inline || !options.invite) return
    if (panel.dataset.open === 'true') return

    try {
      if (sessionStorage.getItem(inviteKey(options.endpoint))) return
    } catch {
      // Blocked storage just means it may show again next tab.
    }

    const bubble = document.createElement('div')
    bubble.className = `invite ${side}`
    bubble.setAttribute('role', 'button')
    bubble.tabIndex = 0
    bubble.appendChild(document.createTextNode(options.invite))

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'invite-dismiss'
    dismiss.setAttribute('aria-label', 'Dismiss')
    dismiss.appendChild(icon(ICONS.close, false))

    const close = () => {
      bubble.remove()
      try {
        sessionStorage.setItem(inviteKey(options.endpoint), '1')
      } catch {
        /* ignore */
      }
    }

    dismiss.addEventListener('click', (event) => {
      event.stopPropagation()
      close()
    })

    const open = () => {
      close()
      setOpen(true)
    }
    bubble.addEventListener('click', open)
    bubble.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })

    bubble.appendChild(dismiss)
    root.appendChild(bubble)
  }

  if (options.invite && !inline) {
    const delay = options.inviteDelay ?? 4000
    const timer = setTimeout(showInvite, delay)
    // Cleared on destroy so a removed widget cannot pop a bubble onto the page.
    invites.push(timer)
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

    /** Subscribes to widget events. Returns an unsubscribe function. */
    on<K extends EventName>(name: K, listener: (payload: WidgetEvents[K]) => void): () => void {
      const set = listeners.get(name) ?? new Set()
      set.add(listener as (payload: never) => void)
      listeners.set(name, set)
      return () => set.delete(listener as (payload: never) => void)
    },

    /** Registers a handler for an action the agent can ask the page to run. */
    handle(name: string, handler: ClientActionHandler): void {
      handlers[name] = handler
    },
    clear() {
      state.messages = []
      state.suggestions = options.suggestions ?? []
      state.conversationId = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
      persist(options.endpoint, [], options.persist !== false)
      repaint()
    },
    destroy() {
      state.controller?.abort()
      for (const timer of invites) clearTimeout(timer)
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
