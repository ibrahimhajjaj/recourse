/**
 * A call carried by your own server rather than a voice vendor's.
 *
 * Same shape as the vendor path, deliberately: both satisfy `Call`, so the
 * button in the composer drives either and the panel does not know or care
 * which one is running. What differs is where the audio goes. Here it goes to
 * a socket on the host's own domain, is transcribed and answered and spoken
 * there, and comes back as clips to play.
 *
 * The trade against the vendor path is worth being clear about. This one keeps
 * the persona, the classifier and the procedures in charge of what is said,
 * because the answer is produced by the same agent that answers the chat. It
 * costs the host a transcriber and a voice, and it is theirs to keep fast.
 */

import { compressedType, createMicrophone, type Microphone, type MicrophoneOptions } from './capture.js'
import { levelOf } from './pcm.js'
import { createPlayback, type Playback } from './playback.js'
import type { Call, CallState, CallTranscript } from './call.js'

/** What the server sends alongside the audio. Mirrors the session's own type. */
interface ServerMessage {
  type: 'listening' | 'transcript' | 'thinking' | 'speaking' | 'interrupted' | 'error'
  role?: 'visitor' | 'agent'
  text?: string
  message?: string
}

/** The part of a socket this needs, so a test can pass something small. */
export interface Socket {
  /**
   * Number on a WebSocket, string on a WebRTC data channel.
   *
   * Both are accepted because the whole point of this interface is that the
   * call does not care what is underneath, and a transport that has to be
   * wrapped before it fits is not really supported. See `isOpen`.
   */
  readonly readyState: number | string
  binaryType: string
  send(data: string | ArrayBuffer | ArrayBufferView): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

export interface HostedCallOptions {
  /** WebSocket URL, or a path resolved against the current page. */
  endpoint: string
  conversationId: () => string
  onStateChange?: (state: CallState) => void
  onTranscript?: (entry: CallTranscript) => void
  onError?: (message: string) => void
  /**
   * Sends compressed audio instead of raw samples, when the browser can.
   *
   * On by default. Sixteen bit audio at 16kHz is about 256 kbps going up; the
   * same speech as Opus is around 24, and transcription accuracy is unchanged.
   * That difference is the whole gap between a call that survives a weak
   * mobile connection and one that stutters through it.
   *
   * Falls back to raw samples on its own when the browser has no recorder or
   * supports none of the formats, so this needs no feature detection from you.
   * Set false to force raw samples.
   */
  compress?: boolean
  /** Injected by the tests, and the seam a host can use for its own transport. */
  connect?: (url: string) => Socket
  microphone?: (options: MicrophoneOptions) => Promise<Microphone>
  /** Turns a clip from the server into samples, and plays them. */
  audio?: () => {
    sampleRate: number
    now: () => number
    decode: (clip: ArrayBuffer) => Promise<Float32Array>
    play: (chunk: Float32Array, at: number) => void
    stop: () => void
    close: () => Promise<void>
  }
}

export function createHostedCall(options: HostedCallOptions): Call {
  let state: CallState = 'idle'
  let socket: Socket | null = null
  let microphone: Microphone | null = null
  let speakers: ReturnType<NonNullable<HostedCallOptions['audio']>> | null = null
  let playback: Playback | null = null
  /** Bumped on every dial and hang-up, so a slow open cannot revive a dead call. */
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

  /** Everything opened, closed in the reverse order, ignoring what was never opened. */
  async function teardown() {
    const mic = microphone
    const out = speakers
    const wire = socket

    microphone = null
    speakers = null
    playback = null
    socket = null

    try {
      wire?.close()
    } catch {
      // Already gone.
    }

    // The microphone first: leaving it open keeps the browser's recording
    // indicator lit, which reads as the page still listening.
    await mic?.stop().catch(() => {})
    out?.stop()
    await out?.close().catch(() => {})
  }

  async function start(): Promise<void> {
    if (state === 'connecting' || state === 'live') return

    const mine = ++attempt
    move('connecting')

    let wire: Socket
    try {
      wire = (options.connect ?? openSocket)(resolve(options.endpoint))
    } catch {
      if (mine === attempt) fail('Could not reach the server to start the call.')
      return
    }

    wire.binaryType = 'arraybuffer'
    socket = wire

    wire.onopen = () => {
      if (mine !== attempt) {
        wire.close()
        return
      }

      // Decided here rather than asked of the caller: the browser is the only
      // thing that knows what it can actually record.
      const mimeType = options.compress === false ? null : compressedType()

      wire.send(
        JSON.stringify({
          type: 'hello',
          sampleRate: 16_000,
          conversationId: options.conversationId(),
          ...(mimeType ? { audio: { mimeType } } : {}),
        }),
      )
      void listen(mine, wire, mimeType)
    }

    wire.onmessage = (event) => {
      if (mine !== attempt) return

      if (typeof event.data === 'string') {
        let message: ServerMessage
        try {
          message = JSON.parse(event.data) as ServerMessage
        } catch {
          return
        }

        if (message.type === 'transcript' && message.text && message.role) {
          options.onTranscript?.({ role: message.role, text: message.text })
        }

        if (message.type === 'interrupted') {
          // The server has abandoned the answer, so anything already queued
          // here has to go too, or the caller hears speech that was cancelled.
          speakers?.stop()
          playback?.clear()
        }

        if (message.type === 'error') options.onError?.(message.message ?? 'Something went wrong.')

        return
      }

      if (event.data instanceof ArrayBuffer) void hear(mine, event.data)
    }

    wire.onerror = () => {
      if (mine === attempt) {
        void teardown()
        fail('The call was cut off.')
      }
    }

    wire.onclose = () => {
      if (mine !== attempt) return
      void teardown()
      if (state === 'live' || state === 'connecting') move('ended')
    }
  }

  /** Opens the microphone once the socket is up, and streams it. */
  async function listen(mine: number, wire: Socket, mimeType: string | null) {
    try {
      speakers = (options.audio ?? openSpeakers)()
      playback = createPlayback({
        now: speakers.now,
        play: speakers.play,
        sampleRate: speakers.sampleRate,
      })

      /**
       * Loudness, batched.
       *
       * Only when the audio itself goes up compressed, because then the far
       * end cannot measure it and the turn detector runs on these instead. A
       * message per slice would be fifty a second to carry fifty numbers.
       */
      let levels: number[] = []
      const flushLevels = () => {
        if (levels.length === 0 || !isOpen(wire)) return
        wire.send(JSON.stringify({ type: 'levels', values: levels, frameMs: 20 }))
        levels = []
      }

      microphone = await (options.microphone ?? createMicrophone)({
        onFrame: (samples) => {
          // Checked per frame rather than once: a hang-up mid-call must stop
          // the stream immediately, not at the next state change.
          if (mine !== attempt || !isOpen(wire)) return

          if (mimeType) {
            levels.push(levelOf(samples))
            // Five slices is a tenth of a second, which is finer than any turn
            // decision needs and still a tenth of the messages.
            if (levels.length >= 5) flushLevels()

            return
          }

          // The view, not its backing buffer. They are the same thing today
          // because the conversion allocates a fresh array, but a slice would
          // send the whole pool it was cut from and the far end would hear
          // somebody else's audio.
          wire.send(samples)
        },
        ...(mimeType
          ? {
              onCompressed: (chunk) => {
                if (mine !== attempt || !isOpen(wire)) return
                // Levels first, so the far end has measured the time this
                // chunk covers before the chunk itself lands.
                flushLevels()
                wire.send(chunk)
              },
            }
          : {}),
      })

      if (mine !== attempt) {
        // Hung up while the microphone was opening. Close what just opened
        // rather than leaving a live device nobody asked for.
        await teardown()
        return
      }

      move('live')
    } catch {
      if (mine !== attempt) return

      await teardown()
      fail('Could not use your microphone. It may be blocked for this site.')
    }
  }

  /** Decodes a clip from the server and queues it behind whatever is playing. */
  async function hear(mine: number, clip: ArrayBuffer) {
    try {
      const samples = await speakers?.decode(clip)
      if (mine !== attempt || !samples) return

      playback?.push(samples)
    } catch {
      // One clip that will not decode is not worth ending a call over.
    }
  }

  async function stop(): Promise<void> {
    attempt++
    await teardown()
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
 * Whether the transport will actually carry a frame.
 *
 * A WebSocket says `1`. A WebRTC data channel says `'open'`. Checking only for
 * the number is how you get a call that connects, reports itself live, and
 * silently drops every slice of audio, because the guard rejects all of them
 * and nothing anywhere is an error.
 */
function isOpen(wire: Socket): boolean {
  return wire.readyState === 1 || wire.readyState === 'open'
}

/** A path becomes a socket URL on the page's own host, keeping the scheme right. */
function resolve(endpoint: string): string {
  if (/^wss?:\/\//i.test(endpoint)) return endpoint

  const url = new URL(endpoint, location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  return url.toString()
}

function openSocket(url: string): Socket {
  return new WebSocket(url) as unknown as Socket
}

function openSpeakers() {
  const context = new AudioContext()
  let live: AudioBufferSourceNode[] = []

  return {
    sampleRate: context.sampleRate,
    now: () => context.currentTime,
    decode: async (clip: ArrayBuffer) => {
      const buffer = await context.decodeAudioData(clip)

      return buffer.getChannelData(0)
    },
    play: (chunk: Float32Array, at: number) => {
      const buffer = context.createBuffer(1, chunk.length, context.sampleRate)
      // Written through the channel's own array rather than `copyToChannel`,
      // which insists the source is backed by a plain ArrayBuffer and refuses
      // anything that might be shared.
      buffer.getChannelData(0).set(chunk)

      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.onended = () => void (live = live.filter((node) => node !== source))
      source.start(at)
      live.push(source)
    },
    stop: () => {
      // Anything already handed to the device keeps playing until told not to,
      // which is what an interruption has to undo.
      for (const source of live) {
        try {
          source.stop()
        } catch {
          // Never started, or already finished.
        }
      }
      live = []
    },
    close: () => context.close(),
  }
}
