/**
 * A spoken call, from the page the visitor is already on.
 *
 * Typing a question is fine on a keyboard and miserable on a phone, and
 * dictation only fixes half of that: it turns speech into a message and then
 * hands back a wall of text to read. A call is the other half, and it is the
 * thing people reach for when what they want to ask is complicated.
 *
 * The voice runtime is loaded from the network the first time somebody clicks,
 * never at import. Almost nobody calls, and making every visitor download an
 * audio stack so that a few can is the sort of cost that gets a widget removed
 * from a site.
 *
 * Kept as a state machine away from the DOM, for the same reason dictation is:
 * the awkward parts live in one place and can be tested without a browser, a
 * microphone, or a bill.
 */

/** Where a call can be. `failed` is terminal for that attempt, not for the widget. */
export type CallState = 'idle' | 'connecting' | 'live' | 'ended' | 'failed'

/** One side of what was said, for showing in the panel as it happens. */
export interface CallTranscript {
  role: 'visitor' | 'agent'
  text: string
}

/**
 * The part of the voice runtime this uses.
 *
 * Written out rather than imported so the package is not a dependency of the
 * widget: it arrives at runtime or the call does not happen, and either way
 * nothing here needs its types to compile.
 */
export interface VoiceSession {
  endSession(): Promise<void> | void
}

export interface VoiceRuntime {
  startSession(options: {
    signedUrl: string
    onConnect?: () => void
    onDisconnect?: () => void
    onError?: (error: unknown) => void
    onMessage?: (message: { source?: string; message?: string }) => void
  }): Promise<VoiceSession>
}

export interface CallOptions {
  /**
   * The endpoint that trades an account key for a short-lived signed URL. It
   * has to be on the host's own server, because the key must not be here.
   */
  endpoint: string
  /**
   * The conversation this call belongs to, read at dial time rather than held,
   * so a call started after a clear-and-restart joins the new one.
   */
  conversationId: () => string
  onStateChange?: (state: CallState) => void
  onTranscript?: (entry: CallTranscript) => void
  onError?: (message: string) => void
  /** Injected by the tests, and the seam that keeps the runtime out of the bundle. */
  load?: () => Promise<VoiceRuntime>
  fetch?: typeof globalThis.fetch
}

export interface Call {
  readonly state: CallState
  /** Dial, unless a call is already up or on its way. */
  start(): Promise<void>
  /** Hang up. Safe at any point, including before anything connected. */
  stop(): Promise<void>
  toggle(): Promise<void>
}

export function createCall(options: CallOptions): Call {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)
  const load = options.load ?? loadRuntime
  let state: CallState = 'idle'
  let session: VoiceSession | null = null
  /**
   * Bumped on every dial and hang-up, so a slow connection that lands after
   * somebody has given up does not quietly put them in a call they left.
   */
  let attempt = 0

  const move = (next: CallState) => {
    if (state === next) return
    state = next
    options.onStateChange?.(next)
  }

  const fail = (message: string) => {
    move('failed')
    options.onError?.(message)
  }

  async function start(): Promise<void> {
    if (state === 'connecting' || state === 'live') return

    const mine = ++attempt
    move('connecting')

    let signedUrl: string
    try {
      const response = await request(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: options.conversationId() }),
      })

      if (response.status === 429) {
        if (mine === attempt) fail('Too many calls just now. Try again in a moment.')
        return
      }

      if (!response.ok) {
        if (mine === attempt) fail('Calling is not available right now.')
        return
      }

      const body = (await response.json()) as { signedUrl?: unknown }
      if (typeof body.signedUrl !== 'string' || !body.signedUrl) {
        if (mine === attempt) fail('Calling is not available right now.')
        return
      }
      signedUrl = body.signedUrl
    } catch {
      if (mine === attempt) fail('Could not reach the server to start the call.')
      return
    }

    if (mine !== attempt) return

    let runtime: VoiceRuntime
    try {
      runtime = await load()
    } catch {
      if (mine === attempt) fail('Could not load the voice connection.')
      return
    }

    if (mine !== attempt) return

    try {
      const started = await runtime.startSession({
        signedUrl,
        onConnect: () => {
          if (mine === attempt) move('live')
        },
        onDisconnect: () => {
          if (mine === attempt) {
            session = null
            move('ended')
          }
        },
        // The microphone prompt lives inside the runtime, so a refusal arrives
        // here rather than as a thrown error, and it is the most likely thing
        // to go wrong on a first call.
        onError: () => {
          if (mine === attempt) fail('The call ended unexpectedly. Your microphone may be blocked.')
        },
        onMessage: (message) => {
          const text = typeof message?.message === 'string' ? message.message.trim() : ''
          if (!text) return
          options.onTranscript?.({ role: message.source === 'user' ? 'visitor' : 'agent', text })
        },
      })

      if (mine !== attempt) {
        // Somebody hung up while this was connecting. Close what just opened
        // rather than leaving a live microphone nobody asked for.
        await Promise.resolve(started.endSession()).catch(() => {})
        return
      }

      session = started
    } catch {
      if (mine === attempt) fail('Could not start the call. Your microphone may be blocked.')
    }
  }

  async function stop(): Promise<void> {
    attempt++
    const open = session
    session = null

    if (open) {
      try {
        await open.endSession()
      } catch {
        // Already gone. The visitor asked to hang up, and they have.
      }
    }

    move(state === 'failed' ? 'failed' : 'ended')
  }

  return {
    get state() {
      return state
    },
    start,
    stop,
    async toggle() {
      if (state === 'connecting' || state === 'live') await stop()
      else await start()
    },
  }
}

/**
 * Where the runtime is fetched from, pinned.
 *
 * A floating version in a script a browser executes is somebody else's release
 * schedule deciding when this widget breaks, on every site that embeds it.
 */
export const RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm'

/** The default loader, and the only place the runtime is named. */
async function loadRuntime(): Promise<VoiceRuntime> {
  // Held in a variable rather than written inline, so the compiler treats it
  // as a runtime specifier instead of a module it should try to resolve.
  const source = RUNTIME_URL
  const module = (await import(/* @vite-ignore */ source)) as { Conversation?: VoiceRuntime }

  if (!module.Conversation) throw new Error('no conversation runtime in the loaded module')

  return module.Conversation
}
