import { renderMarkdown } from './render.js'
import { renderForm, renderUi, type UiContext } from './ui.js'
import { streamChat } from './stream.js'
import { createDictation, type Dictation } from './dictation.js'
import { styles } from './styles.js'
import { resolveStrings, fill } from './strings.js'
import type {
  ChatMessage,
  ClientActionHandler,
  EventName,
  OutgoingAttachment,
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
  clip: 'M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8',
  mic: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3',
}

/**
 * What the picker offers by default. Kept in step with the server's own
 * allowlist: offering a type the server refuses only wastes an upload.
 */
const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/** Mounts the widget. Returns handles so the host page can drive it. */
export function createWidget(options: WidgetOptions) {
  if (!options.endpoint) throw new Error('helpdeck: an `endpoint` is required')

  const strings = resolveStrings(options.strings)
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
    /** Files picked but not yet sent. Cleared the moment they go. */
    staged: OutgoingAttachment[]
  } = {
    messages: options.persist === false ? [] : restore(options.endpoint),
    busy: false,
    controller: null,
    // Groups this tab's turns into one thread in the transcript log.
    conversationId: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    suggestions: options.suggestions ?? [],
    staged: [],
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
  launcher.setAttribute('aria-label', strings.open)
  launcher.setAttribute('aria-expanded', 'false')
  launcher.appendChild(icon(ICONS.chat, true))

  const panel = document.createElement('div')
  panel.className = `panel ${side}`
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-label', options.title ?? strings.title)
  panel.dataset.open = String(inline || options.open === true)

  const header = document.createElement('div')
  header.className = 'header'
  const heading = document.createElement('div')
  heading.className = 'grow'
  const title = document.createElement('h2')
  title.textContent = options.title ?? strings.title
  heading.appendChild(title)
  if (options.subtitle) {
    const subtitle = document.createElement('p')
    subtitle.textContent = options.subtitle
    heading.appendChild(subtitle)
  }
  header.appendChild(heading)

  // Forgetting the conversation, when the host allows it. Before the close
  // button, because the rightmost control in a panel header is the one people
  // reach for without looking and it should stay the harmless one.
  const forget = document.createElement('button')
  forget.className = 'icon-button'
  forget.type = 'button'
  forget.setAttribute('aria-label', strings.deleteConversation)
  forget.appendChild(
    icon('M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z', false),
  )
  if (options.allowDelete) header.appendChild(forget)

  const close = document.createElement('button')
  close.className = 'icon-button'
  close.type = 'button'
  close.setAttribute('aria-label', strings.close)
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
  input.placeholder = strings.placeholder
  input.setAttribute('aria-label', strings.inputLabel)
  const send = document.createElement('button')
  send.type = 'submit'
  send.setAttribute('aria-label', strings.send)
  send.appendChild(icon(ICONS.send, true))

  // Off unless the host turns it on: an upload button in front of a server
  // that refuses files is worse than no button.
  const uploads = options.attachments
    ? {
        maxBytes: (typeof options.attachments === 'object' ? options.attachments.maxBytes : undefined) ?? 10 * 1024 * 1024,
        maxCount: (typeof options.attachments === 'object' ? options.attachments.maxCount : undefined) ?? 4,
        accept: (typeof options.attachments === 'object' ? options.attachments.accept : undefined) ?? ACCEPTED_TYPES,
      }
    : null

  const tray = document.createElement('div')
  tray.className = 'tray'
  tray.hidden = true

  const picker = document.createElement('input')
  picker.type = 'file'
  picker.multiple = true
  picker.hidden = true
  picker.tabIndex = -1

  const attach = document.createElement('button')
  attach.type = 'button'
  attach.className = 'attach'
  attach.setAttribute('aria-label', strings.attach)
  attach.appendChild(icon(ICONS.clip, false))

  // Only built when the host asked for it and the browser can do it. A mic
  // that does nothing is worse than no mic.
  const dictationSettings = options.dictation
    ? typeof options.dictation === 'object'
      ? options.dictation
      : {}
    : null

  const mic = document.createElement('button')
  mic.type = 'button'
  mic.className = 'mic'
  mic.setAttribute('aria-label', strings.dictate)
  mic.appendChild(icon(ICONS.mic, false))

  let dictation: Dictation | null = null

  if (uploads) picker.accept = uploads.accept.join(',')
  if (dictationSettings) {
    dictation = createDictation({
      ...dictationSettings,
      onStateChange: (recording) => {
        mic.dataset.recording = String(recording)
        mic.setAttribute('aria-label', recording ? strings.stopDictating : strings.dictate)
        if (!recording) input.dataset.interim = ''
      },
      onInterim: (text) => {
        // Shown after whatever is already typed, without committing it: an
        // interim result is a guess the browser will revise.
        input.value = `${input.dataset.beforeDictation ?? ''}${text}`
      },
      onFinal: (text) => {
        const before = input.dataset.beforeDictation ?? ''
        const joined = before && !before.endsWith(' ') ? `${before} ${text}` : `${before}${text}`
        input.value = joined
        input.dataset.beforeDictation = joined
      },
      onError: (message) => showError(message),
    })

    // Null means the browser has no speech recognition. Leave the button out
    // rather than shipping a control that cannot work.
    if (dictation) {
      mic.addEventListener('click', () => {
        if (!dictation) return
        if (!dictation.recording) input.dataset.beforeDictation = input.value
        dictation.toggle()
        input.focus()
      })

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dictation?.recording) {
          event.preventDefault()
          // Escape discards the dictation and restores what was typed before.
          input.value = input.dataset.beforeDictation ?? ''
          dictation.cancel()
        }
      })
    }
  }

  const micButton = dictation ? [mic] : []
  composer.append(...(uploads ? [attach] : []), input, ...micButton, send)

  panel.append(header, log, suggestions, errorBox, tray, composer)
  if (uploads) panel.appendChild(picker)
  if (!inline) root.append(launcher, panel)
  else root.append(panel)
  ;(options.target ?? document.body).appendChild(host)

  // ---- behaviour -----------------------------------------------------------

  if (uploads) {
    attach.addEventListener('click', () => picker.click())
    picker.addEventListener('change', () => {
      if (picker.files) void stage(picker.files)
      // Reset, so picking the same file twice in a row still fires a change.
      picker.value = ''
    })

    // Dropping a file on the panel and pasting a screenshot are both things
    // people try without being told they can.
    panel.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      panel.dataset.dropping = 'true'
    })
    panel.addEventListener('dragleave', () => {
      delete panel.dataset.dropping
    })
    panel.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      delete panel.dataset.dropping
      void stage(event.dataTransfer.files)
    })
    input.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      void stage(files)
    })
  }

  function setOpen(open: boolean) {
    emit(open ? 'open' : 'close', {})
    // Opening the panel answers the invitation, so it never needs asking again.
    if (open) root.querySelector('.invite')?.remove()
    panel.dataset.open = String(open)
    launcher.setAttribute('aria-expanded', String(open))
    launcher.setAttribute('aria-label', open ? strings.close : strings.open)
    if (open) input.focus()
    else launcher.focus()
  }

  function showError(message: string) {
    errorBox.textContent = message
    errorBox.hidden = false
  }

  /**
   * Reads what the visitor picked.
   *
   * Every check here is repeated on the server. This copy exists so somebody
   * learns their 40MB scan is too big before they wait for it to upload, not
   * after.
   */
  async function stage(files: FileList | File[]) {
    if (!uploads) return
    errorBox.hidden = true

    for (const file of Array.from(files)) {
      if (state.staged.length >= uploads.maxCount) {
        showError(`You can attach ${uploads.maxCount} files at a time.`)
        break
      }
      const mimeType = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? ''
      if (!uploads.accept.includes(mimeType)) {
        showError(`${file.name} is not a file type we can read.`)
        continue
      }
      if (file.size > uploads.maxBytes) {
        showError(`${file.name} is larger than ${Math.round(uploads.maxBytes / 1024 / 1024)}MB.`)
        continue
      }

      let dataUrl: string
      try {
        dataUrl = await readAsDataUrl(file)
      } catch {
        showError(`${file.name} could not be read.`)
        continue
      }

      state.staged.push({ name: file.name, mimeType, dataUrl, bytes: file.size })
    }

    paintTray()
  }

  /** Chips above the composer, each removable before anything is sent. */
  function paintTray() {
    tray.replaceChildren()
    tray.hidden = state.staged.length === 0

    for (const [position, file] of state.staged.entries()) {
      const chip = document.createElement('span')
      chip.className = 'chip'

      const label = document.createElement('span')
      // textContent, never innerHTML: a filename is somebody else's string.
      label.textContent = file.name
      chip.appendChild(label)

      const drop = document.createElement('button')
      drop.type = 'button'
      drop.setAttribute('aria-label', fill(strings.removeFile, { name: file.name }))
      drop.appendChild(icon(ICONS.close, false))
      drop.addEventListener('click', () => {
        state.staged.splice(position, 1)
        paintTray()
        input.focus()
      })
      chip.appendChild(drop)

      tray.appendChild(chip)
    }
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

    // An empty bubble looks broken, so a file-only message shows its files
    // instead of an empty grey rectangle.
    if (message.role === 'user' && !message.content && message.attachments?.length) bubble.remove()
    else wrapper.appendChild(bubble)

    if (message.attachments?.length) paintAttached(wrapper, message.attachments)
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

  /**
   * Copies the answer as the customer reads it.
   *
   * The text, not the rendered markup: somebody pasting an answer into an
   * email wants the sentence, not a div. Hidden entirely where there is no
   * clipboard, which is any page served over plain HTTP, because a button that
   * does nothing is worse than no button.
   */
  function paintCopy(text: string) {
    if (options.copy === false) return
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'icon-button'
    button.setAttribute('aria-label', strings.copy)
    button.appendChild(
      icon('M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z', true),
    )

    button.addEventListener('click', () => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          // The label rather than a toast: a screen reader announces the
          // change, and there is nothing new on screen to get in the way.
          button.setAttribute('aria-label', strings.copied)
          button.setAttribute('data-copied', 'true')
          setTimeout(() => {
            button.setAttribute('aria-label', strings.copy)
            button.removeAttribute('data-copied')
          }, 1600)
        })
        .catch(() => {
          // A browser can refuse the clipboard even when the API exists, and
          // there is nothing useful to tell the customer about that.
        })
    })

    return button
  }

  /** Empties this tab. Everything here, nothing anywhere else. */
  function forgetLocally() {
    state.messages = []
    state.suggestions = options.suggestions ?? []
    state.conversationId = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    persist(options.endpoint, [], options.persist !== false)
    repaint()
  }

  /**
   * Forgets the conversation locally, then asks the server to forget it too.
   *
   * Local first and unconditionally. If the request fails the visitor has still
   * had the thing they asked for on the screen in front of them, and telling
   * them their deletion failed is worse than the transcript outliving it on a
   * server they cannot see.
   */
  async function forgetConversation() {
    const conversationId = state.conversationId
    forgetLocally()

    try {
      await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteConversation: conversationId }),
      })
    } catch {
      // Nothing useful to say about it, and nothing the visitor can do.
    }
  }

  /** Thumbs, so the host learns which answers were actually any good. */
  function paintFeedback(wrapper: HTMLElement, messageIndex: number, text = '') {
    const copyButton = paintCopy(text)

    if (options.feedback === false) {
      if (!copyButton) return

      const only = document.createElement('div')
      only.className = 'feedback'
      only.appendChild(copyButton)
      wrapper.appendChild(only)
      return
    }

    const row = document.createElement('div')
    row.className = 'feedback'

    for (const [value, label, glyph] of [
      ['positive', strings.helpful, 'M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z'],
      ['negative', strings.notHelpful, 'M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z'],
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

    if (copyButton) row.appendChild(copyButton)

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
    // A photo on its own is a perfectly good question; the server fills in the
    // words. Anything else empty is not worth a round trip.
    if ((!text && state.staged.length === 0) || state.busy) return

    errorBox.hidden = true
    state.busy = true
    send.disabled = true

    // A dictation still running would keep writing into a box the customer has
    // already sent.
    if (dictation?.recording) dictation.cancel()
    input.dataset.beforeDictation = ''

    // Taken off the tray now, so a slow answer cannot let them be sent twice.
    const sending = state.staged
    state.staged = []
    paintTray()

    const outgoing: ChatMessage = { role: 'user', content: text }
    if (sending.length > 0) outgoing.attachments = sending
    state.messages.push(outgoing)
    paintMessage(outgoing)
    emit('message', { text })

    // Starters belong to the blank slate; the server can offer new ones later.
    state.suggestions = []
    paintSuggestions()

    state.controller = new AbortController()
    await runTurn(undefined, sending)

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
  async function runTurn(
    actionResults?: Array<{ name: string; input?: unknown; output: unknown }>,
    sending?: OutgoingAttachment[],
  ) {
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
        // Only on the first pass. The second half of a paused turn resumes a
        // question the server has already read the files for.
        ...(sending && sending.length > 0 ? { attachments: sending } : {}),
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
      strings,
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
      paintFeedback(wrapper, state.messages.length - 1, answer.content)
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
    } else if (frame.type === 'notice') {
      paintNotice(frame.message)
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
    run: async (name, payload) => {
      const handler = handlers[name]
      if (!handler) throw new Error('That is not available here')
      return handler(payload)
    },
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

  /** What the visitor sent, under their own message. */
  function paintAttached(wrapper: HTMLElement, files: OutgoingAttachment[]) {
    const row = document.createElement('div')
    row.className = 'attached'

    for (const file of files) {
      if (file.mimeType.startsWith('image/')) {
        const thumb = document.createElement('img')
        thumb.src = file.dataUrl
        thumb.alt = file.name
        row.appendChild(thumb)
        continue
      }
      const chip = document.createElement('span')
      chip.className = 'chip'
      chip.textContent = file.name
      row.appendChild(chip)
    }

    wrapper.appendChild(row)
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
    dismiss.setAttribute('aria-label', strings.dismiss)
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

  forget.addEventListener('click', () => {
    // Asked once, because the words cannot be brought back and a bin icon next
    // to a close icon is a mis-click waiting to happen.
    if (typeof window.confirm === 'function' && !window.confirm(strings.deleteConfirm)) return

    void forgetConversation()
  })

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
      forgetLocally()
    },
    /** Forgets the conversation here and asks the server to do the same. */
    forget: () => forgetConversation(),
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


/**
 * A file as a data URI.
 *
 * FileReader rather than arrayBuffer plus btoa: a 10MB file put through
 * String.fromCharCode in a loop is enough to lock up a phone browser.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('unreadable'))
    reader.readAsDataURL(file)
  })
}
