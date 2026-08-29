/**
 * Dictation, through the browser's own speech recognition.
 *
 * On a phone, typing a question about a broken order is the reason people give
 * up and leave. Talking is not.
 *
 * Kept as a state machine separate from the widget so it can be tested without
 * a browser, and so the awkward parts of this API are in one place: it stops on
 * its own after a silence, `stop()` and `abort()` mean different things, and
 * the same object cannot be started twice.
 */

export interface DictationOptions {
  /**
   * BCP-47 tag. Defaults to the page's `lang`, then the browser's own setting,
   * which is what an unset `lang` already means to the API.
   */
  lang?: string
  /**
   * Requires the audio to be recognised on the device rather than sent to the
   * browser vendor's servers.
   *
   * On by default. A support widget records people describing orders, names
   * and addresses, and sending that to a third party because a checkbox
   * defaulted the wrong way is not a decision to make on a host's behalf.
   */
  processLocally?: boolean
  /**
   * Falls back to the browser's default when on-device recognition is not
   * available, which usually means the language pack is not installed.
   *
   * Off by default: without it, dictation is simply unavailable rather than
   * quietly becoming the thing `processLocally` was set to prevent.
   */
  allowCloudFallback?: boolean
  /** Interim text as it is being recognised, for the live transcript. */
  onInterim?: (text: string) => void
  /** A finished phrase. Appended to whatever is already in the box. */
  onFinal?: (text: string) => void
  /** Recording started or stopped, for the button's state. */
  onStateChange?: (recording: boolean) => void
  /** Something went wrong, in words worth showing a visitor. */
  onError?: (message: string) => void
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  processLocally?: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

type RecognitionConstructor = new () => RecognitionLike

/**
 * The constructor, whatever this browser calls it.
 *
 * Chrome and Safari still only expose the prefixed name. Firefox exposes
 * neither, which is why the button is hidden rather than shown broken.
 */
export function speechRecognition(scope: typeof globalThis = globalThis): RecognitionConstructor | null {
  const global = scope as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return global.SpeechRecognition ?? global.webkitSpeechRecognition ?? null
}

export function dictationSupported(scope: typeof globalThis = globalThis): boolean {
  return speechRecognition(scope) !== null
}

export interface Dictation {
  /** Begins listening. Does nothing if already recording. */
  start(): void
  /** Stops and keeps what was heard. */
  stop(): void
  /** Stops and discards. For Escape. */
  cancel(): void
  /** Starts if stopped, stops if started. */
  toggle(): void
  readonly recording: boolean
}

/** Errors the API reports, in words a visitor can act on. */
const MESSAGES: Record<string, string> = {
  'not-allowed': 'I need permission to use the microphone. You can allow it in your browser settings.',
  'service-not-allowed': 'Your browser would not let me use speech recognition.',
  'no-speech': 'I did not hear anything. Try again?',
  'audio-capture': 'I could not find a microphone.',
  network: 'Speech recognition needs a connection and could not reach it.',
  'language-not-supported': 'Speech recognition is not available for this language on your device.',
}

export function createDictation(options: DictationOptions = {}, scope: typeof globalThis = globalThis): Dictation | null {
  const found = speechRecognition(scope)
  if (!found) return null
  const Recognition: RecognitionConstructor = found

  let active: RecognitionLike | null = null
  // Set when a local-only attempt failed for a reason a cloud attempt might
  // survive, so the retry happens once rather than in a loop.
  let retriedWithoutLocal = false

  function build(processLocally: boolean): RecognitionLike {
    const recognition = new Recognition()
    // Without this the browser stops at the first pause, which turns a
    // sentence into three separate dictations.
    recognition.continuous = true
    // The live transcript is most of the value: silence for four seconds and
    // then a wall of text feels broken.
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    const lang = options.lang ?? documentLang(scope)
    if (lang) recognition.lang = lang

    // Only set when asked for. Assigning `false` on a browser that honours the
    // property would be opting out of on-device recognition rather than
    // leaving the choice alone.
    if (processLocally) recognition.processLocally = true

    return recognition
  }

  function attach(recognition: RecognitionLike): void {
    recognition.onstart = () => options.onStateChange?.(true)

    recognition.onresult = (event) => {
      let interim = ''

      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        if (!result) continue
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) options.onFinal?.(text)
        else interim += text
      }

      if (interim) options.onInterim?.(interim)
    }

    recognition.onerror = (event) => {
      const local = options.processLocally !== false
      const recoverable = event.error === 'language-not-supported' || event.error === 'service-not-allowed'

      // One retry without the local requirement, and only when the host said
      // that is acceptable.
      if (local && recoverable && options.allowCloudFallback && !retriedWithoutLocal) {
        retriedWithoutLocal = true
        active = null
        startWith(false)
        return
      }

      // Stopping deliberately reports as an abort on some browsers, which is
      // not something to tell anybody about.
      if (event.error !== 'aborted') {
        options.onError?.(MESSAGES[event.error] ?? 'Speech recognition stopped unexpectedly.')
      }
    }

    recognition.onend = () => {
      active = null
      options.onStateChange?.(false)
    }
  }

  function startWith(processLocally: boolean): void {
    const recognition = build(processLocally)
    attach(recognition)
    active = recognition

    try {
      recognition.start()
    } catch {
      // Throws if start() is called on an instance that is already running.
      // Nothing to recover, and nothing worth telling the visitor.
      active = null
      options.onStateChange?.(false)
    }
  }

  return {
    get recording() {
      return active !== null
    },

    start() {
      if (active) return
      retriedWithoutLocal = false
      startWith(options.processLocally !== false)
    },

    stop() {
      active?.stop()
    },

    cancel() {
      const recognition = active
      active = null
      recognition?.abort()
      options.onStateChange?.(false)
    },

    toggle() {
      if (active) this.stop()
      else this.start()
    },
  }
}

function documentLang(scope: typeof globalThis): string {
  const documentRef = (scope as unknown as { document?: Document }).document
  return documentRef?.documentElement?.lang ?? ''
}
