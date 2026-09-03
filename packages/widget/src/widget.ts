import { renderMarkdown } from './render.js'
import { renderForm, renderUi, type UiContext } from './ui.js'
import { streamChat } from './stream.js'
import { createDictation, type Dictation } from './dictation.js'
import { createCall, type Call, type CallState } from './call.js'
import { createHostedCall, type HostedCallOptions } from './hosted-call.js'
import { styles } from './styles.js'
import { resolveStrings, fill } from './strings.js'
import { openDeepLink } from './deeplink.js'
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
  return `recourse:transcript:${endpoint}`
}

function inviteKey(endpoint: string): string {
  return `recourse:invite:${endpoint}`
}

const ICONS = {
  chat: 'M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z',
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M4 12l16-8-6 8 6 8z',
  clip: 'M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8',
  mic: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3',
  phone: 'M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z',
  hangUp: 'M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z',
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
  if (!options.endpoint) throw new Error('recourse: an `endpoint` is required')

  const strings = resolveStrings(options.strings)
  const inline = Boolean(options.target)
  const host = document.createElement('div')
  host.setAttribute('data-recourse', '')
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

  if (options.accent) host.style.setProperty('--rc-accent', options.accent)
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
        console.error(`[recourse] listener for "${name}" threw`, error)
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
  input.setAttribute('dir', 'auto')
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

  // Only built when the host pointed it at an endpoint. Unlike the mic, there
  // is nothing to feature-detect: whether a call can happen is a question about
  // the server, and the honest answer arrives when somebody presses it.
  const callEndpoint =
    typeof options.call === 'string' ? options.call : options.call ? options.call.endpoint : null
  // A site with a strict content policy cannot fetch the runtime from a CDN,
  // so it can hand one over instead. Also the seam the tests use.
  const callRuntime = typeof options.call === 'object' ? options.call.load : undefined
  const callTransport = typeof options.call === 'object' ? options.call.transport : undefined

  const callButton = document.createElement('button')
  callButton.type = 'button'
  callButton.className = 'call'
  callButton.setAttribute('aria-label', strings.call)
  callButton.appendChild(icon(ICONS.phone, false))

  let call: Call | null = null

  if (callEndpoint) {
    // Both satisfy the same interface, so everything below this line is the
    // same whichever one is running.
    const shared: HostedCallOptions = {
      endpoint: callEndpoint,
      // Read per dial rather than captured, so a call placed after the thread
      // was cleared belongs to the conversation now on screen.
      conversationId: () => state.conversationId,
      onStateChange: (next) => paintCallState(next),
      // Same thread as everything else: a spoken answer and a typed one are
      // the same conversation, and splitting them makes the visitor read two.
      onTranscript: ({ role, text }) =>
        void paintMessage({ role: role === 'visitor' ? 'user' : 'assistant', content: text }),
      onError: (message) => showError(message),
    }

    call =
      callTransport === 'hosted'
        ? createHostedCall(shared)
        : createCall({ ...shared, ...(callRuntime ? { load: callRuntime } : {}) })

    callButton.addEventListener('click', () => void call?.toggle())
  }

  /** The button, and a line in the thread for the two moments that matter. */
  function paintCallState(next: CallState) {
    callButton.dataset.state = next
    const live = next === 'live' || next === 'connecting'
    callButton.setAttribute('aria-label', live ? strings.endCall : strings.call)
    callButton.replaceChildren(icon(live ? ICONS.hangUp : ICONS.phone, false))

    if (next === 'live') paintNotice(strings.callStarted)
    if (next === 'ended') paintNotice(strings.callEnded)
  }

  const micButton = dictation ? [mic] : []
  const dialButton = call ? [callButton] : []
  composer.append(...(uploads ? [attach] : []), input, ...micButton, ...dialButton, send)

  /**
   * A line under the composer, when the deployment set one.
   *
   * This is where a disclosure goes. It was declared in the string table and
   * rendered nowhere, so a deployment that set it to say the customer is
   * talking to a machine got an empty screen and no error, which is the worst
   * way for that particular setting to fail.
   *
   * Text, never markup: it comes from a data attribute on somebody's page.
   */
  const footnote = document.createElement('p')
  footnote.className = 'footnote'
  if (strings.footnote) footnote.textContent = strings.footnote

  panel.append(header, log, suggestions, errorBox, tray, composer, ...(strings.footnote ? [footnote] : []))
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
  function citedOnly(refs: SourceRef[], answer: string): { sources: SourceRef[]; citedAs: number[][] } {
    const used = new Set<number>()
    for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
      used.add(Number.parseInt(match[1] as string, 10) - 1)
    }

    const numbered = refs.map((ref, position) => ({ ref, position }))
    const matching = numbered.filter((entry) => used.has(entry.position))

    // A model that cited nothing is not evidence that nothing was used, and
    // neither is one that cited a number nothing answers to. Either way the
    // pages are still named, just without numbers on them. Dropping them would
    // hide where the answer came from over a mistake in how it was written.
    const cited = matching.length > 0 ? matching : numbered
    const numbering = matching.length > 0

    const seen = new Map<string, number>()
    const sources: SourceRef[] = []
    const citedAs: number[][] = []

    for (const entry of cited) {
      const key = `${entry.ref.url ?? ''}|${entry.ref.title}|${entry.ref.section ?? ''}`
      const already = seen.get(key)

      // Two passages of one page collapse to one chip, and that chip carries
      // both numbers. Dropping the second would leave a reader following [4]
      // with nothing on screen answering to it.
      if (already !== undefined) {
        if (numbering) citedAs[already]?.push(entry.position + 1)
        continue
      }

      seen.set(key, sources.length)
      sources.push(entry.ref)
      citedAs.push(numbering ? [entry.position + 1] : [])
    }

    return { sources, citedAs }
  }

  function paintSources(container: HTMLElement, refs: SourceRef[], citedAs: number[][] = []) {
    if (refs.length === 0) return
    const list = document.createElement('div')
    list.className = 'sources'

    for (const [position, ref] of refs.slice(0, 4).entries()) {
      const name = ref.section ? `${ref.title} · ${ref.section}` : ref.title
      // The number the answer used, shown rather than implied. Only the cited
      // pages are listed, so the third of six can be the second on screen, and
      // a bare list leaves the reader unable to tell which [n] is which.
      // Renumbering the answer instead would mean editing what the model wrote.
      const marks = citedAs[position] ?? []
      const label = marks.length > 0 ? `${marks.map((mark) => `[${mark}]`).join(' ')} ${name}` : name
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
    // The agent replies in whatever language it was written to, so one
    // conversation can hold both directions at once. `auto` lets the browser
    // decide per message from its first strong character, which is the only
    // thing that gets an Arabic answer and an English one right on the same
    // page without asking the host to declare anything.
    bubble.setAttribute('dir', 'auto')
    if (message.role === 'user') bubble.textContent = message.content
    else bubble.appendChild(renderMarkdown(message.content))

    // An empty bubble looks broken, so a file-only message shows its files
    // instead of an empty grey rectangle.
    if (message.role === 'user' && !message.content && message.attachments?.length) bubble.remove()
    else wrapper.appendChild(bubble)

    if (message.attachments?.length) paintAttached(wrapper, message.attachments)
    if (message.sources) paintSources(wrapper, message.sources, message.citedAs)
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

        // Pressed on the way out, and un-pressed if it did not land. A
        // deployment with no store answers 501 to every thumb, and leaving the
        // button pressed tells the visitor their opinion was recorded when
        // nothing recorded it. Quiet is right here; a lie is not.
        void sendFeedback(messageIndex, value).then((recorded) => {
          if (!recorded) button.removeAttribute('aria-pressed')
        })
      })
      row.appendChild(button)
    }

    if (copyButton) row.appendChild(copyButton)

    wrapper.appendChild(row)
  }

  /** Whether the thumb actually reached a store. Never throws. */
  async function sendFeedback(messageIndex: number, value: 'positive' | 'negative'): Promise<boolean> {
    try {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: { conversationId: state.conversationId, messageIndex, value },
        }),
      })

      return response.ok
    } catch {
      // Feedback is a nicety; failing to record it must not surface an error.
      return false
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
    // The answer is rebuilt from scratch on every delta, so without this a two
    // sentence reply is announced dozens of times over. Marking the region busy
    // tells assistive technology to wait and read it once, when it is finished.
    log.setAttribute('aria-busy', 'true')

    const typing = document.createElement('span')
    typing.className = 'typing'
    typing.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
    bubble.appendChild(typing)

    /**
     * Swaps the dots for what the agent is doing, and back when it stops.
     *
     * Only while nothing has been said yet. Once text starts arriving the
     * answer is the thing to look at, and a status line appearing underneath a
     * half-written sentence reads as a fault.
     */
    let working: HTMLElement | null = null
    /**
     * What a thinking model has said to itself so far, this turn.
     *
     * Kept here rather than beside the transcript because it is not part of it:
     * the turn ends and it goes, and nothing about it is ever stored or sent.
     */
    let thought = ''
    const showThought = (text: string) => {
      thought += text
      showWorking(lastLine(thought))
    }
    const showWorking = (label: string | null) => {
      if (answer.content) return

      if (!label) {
        working?.remove()
        working = null
        if (!bubble.contains(typing)) bubble.appendChild(typing)

        return
      }

      typing.remove()
      working ??= document.createElement('div')
      working.className = 'working'
      // Text, never markup: the summary can come from an action a deployment
      // wrote, and this is a customer's screen.
      working.textContent = fill(strings.working, { name: label })
      if (!bubble.contains(working)) bubble.appendChild(working)
      scrollToEnd()
    }

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
          working?.remove()
          working = null
          answer.content += delta
          bubble.replaceChildren(renderMarkdown(answer.content))
          scrollToEnd()
        },
        onError: (message) => {
          typing.remove()
          working?.remove()
          working = null
          showError(message)
          emit('error', { message })
        },
        onFrame: (frame) => handleFrame(frame, requested, showWorking, showThought),
      },
      state.controller?.signal,
      strings,
    ).finally(() => {
      // A dropped connection or an abort rejects out of `streamChat`, and a
      // region left busy is one a screen reader never reads again: every later
      // answer in the session would arrive in silence. The flag comes off
      // however the turn ended.
      typing.remove()
      log.setAttribute('aria-busy', 'false')
    })

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
      const cited = citedOnly(sources, answer.content)
      answer.sources = cited.sources
      answer.citedAs = cited.citedAs
      state.messages.push(answer)
      paintSources(wrapper, answer.sources, answer.citedAs)
      paintFeedback(wrapper, state.messages.length - 1, answer.content)
      persist(options.endpoint, state.messages, options.persist !== false)
      emit('response', { text: answer.content, sources: answer.sources })
    } else {
      // Nothing came back, so leave no empty bubble behind.
      wrapper.remove()
    }

    paintSuggestions()
  }

/**
 * The last line of what a model has thought so far.
 *
 * Thinking arrives as a stream of fragments and runs to paragraphs. The visitor
 * is waiting for an answer, not reading an essay, so one line of it is shown at
 * a time and the rest scrolls past underneath.
 */
function lastLine(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim())
  const line = lines[lines.length - 1] ?? ''

  return line.length > 120 ? `${line.slice(-120).trimStart()}` : line
}

/**
 * An action's name as something a customer can read.
 *
 * `look_up_billing` becomes "look up billing". Deployments name their actions
 * for the model, not for the person waiting, so this is the fallback when the
 * action does not supply its own summary.
 */
function readable(name: string): string {
  return name.replace(/[_-]+/g, ' ').trim()
}

  function handleFrame(
    frame: StreamFrame,
    requested: Array<{
      id: string
      name: string
      input: Record<string, unknown>
      payload?: Record<string, unknown>
    }>,
    /** Shows what the agent is doing, when the caller is a live turn. */
    showWorking: (label: string | null) => void = () => {},
    /** Adds to what a thinking model has said to itself this turn. */
    showThought: (text: string) => void = () => {},
  ) {
    if (frame.type === 'client-action') {
      requested.push({ id: frame.id, name: frame.name, input: frame.input, payload: frame.payload })
    } else if (frame.type === 'suggestions') {
      state.suggestions = frame.items
    } else if (frame.type === 'reasoning') {
      // In the working line rather than the transcript. It is not the answer,
      // it is why the answer is taking a moment, and it is gone once the answer
      // starts. Kept to one line: a thinking model can produce paragraphs of
      // this and none of it is what the visitor asked for.
      showThought(frame.text)
    } else if (frame.type === 'action') {
      emit('action', { name: frame.name, status: frame.status })
      // The frame already crossed the whole stack to get here. Showing it is
      // the difference between three dots for five seconds and the visitor
      // seeing that something is actually happening on their behalf.
      showWorking(frame.status === 'running' ? frame.summary ?? readable(frame.name) : null)
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
        // The id is what makes a card able to change. Sending the same one
        // again replaces what is on screen rather than stacking a second copy
        // underneath it, so a refund that goes from requested to approved is
        // one card that updates and not three in a pile.
        // Compared rather than put into a selector. The id comes from the
        // server, and an id containing a quote turns a selector string into a
        // different selector, or into one that throws and takes the whole
        // frame handler down with it.
        const existing = frame.id
          ? [...log.children].find((node) => (node as HTMLElement).dataset?.uiId === frame.id)
          : undefined

        const wrapper = document.createElement('div')
        wrapper.className = 'msg'
        wrapper.dataset.role = 'assistant'
        if (frame.id) wrapper.dataset.uiId = frame.id
        wrapper.appendChild(node)

        if (existing) {
          // In place, so the thread does not jump under somebody reading it.
          existing.replaceWith(wrapper)
        } else {
          log.appendChild(wrapper)
          scrollToEnd()
        }
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

  const api = {
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

  // Last, so the widget is fully wired before a linked question is asked
  // through the same path a typed one takes.
  if (options.deepLink !== false) openDeepLink(api)

  return api
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
