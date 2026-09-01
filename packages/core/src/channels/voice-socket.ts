/**
 * Putting a call on a socket, whichever socket the host happens to have.
 *
 * Every runtime spells this differently. A Worker makes a pair and accepts one
 * end, Node needs a library, and a long-running server has its own. All of them
 * end up with an object that sends and receives, so that is all this asks for.
 * The session underneath knows nothing about any of it.
 *
 * The wire is deliberately plain. Text frames are JSON control messages, binary
 * frames are audio. There is no envelope around the audio and no length prefix,
 * because a WebSocket already preserves message boundaries and adding a header
 * to every 20ms slice is a header on fifty messages a second.
 */

import { createCallSession, type CallMessage, type CallSession, type CallSessionOptions } from './voice-session.js'

/** The part of a socket this needs, which every runtime's version has. */
export interface CallSocket {
  send(data: string | ArrayBuffer): void
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void
  close(code?: number, reason?: string): void
}

/** What the browser may say. Everything else it sends is audio. */
export interface HelloMessage {
  type: 'hello'
  /** What the microphone is running at, since it varies by machine. */
  sampleRate?: number
  /** Ties the call to the conversation the chat panel is already using. */
  conversationId?: string
  /**
   * What the binary frames will contain.
   *
   * Absent means sixteen bit samples, which is what every client sent before
   * this existed and is still the fallback when a browser cannot record
   * compressed. Naming a media type means the frames are that instead, and
   * loudness arrives separately in `levels` messages.
   */
  audio?: { mimeType: string }
}

/**
 * How loud the caller was, measured by the browser.
 *
 * Only sent alongside compressed audio, where this side cannot measure it.
 * Batched rather than one message per slice, because a slice is twenty
 * milliseconds and fifty messages a second to carry fifty numbers is waste.
 */
export interface LevelsMessage {
  type: 'levels'
  /** Root mean square per slice, from 0 to 1, oldest first. */
  values: number[]
  /** How long each of those covers. */
  frameMs: number
}

type ClientMessage = HelloMessage | LevelsMessage

export type AttachOptions = Omit<CallSessionOptions, 'send' | 'speak' | 'sampleRate' | 'conversationId'> & {
  /** Used when the browser does not say. */
  sampleRate?: number
  conversationId?: string
  /** Called once the far end goes away, for cleanup the host owns. */
  onClose?: () => void
}

export function attachCall(socket: CallSocket, options: AttachOptions): { close: () => void } {
  let session: CallSession | null = null
  let closed = false

  /** Set once the browser says it is sending compressed audio. */
  let compressed: string | null = null
  /** The container header arrives once and is kept for the whole call. */
  let seenHeader = false

  const start = (hello: HelloMessage) => {
    compressed = hello.audio?.mimeType ?? null
    const rate = hello.sampleRate ?? options.sampleRate ?? 16_000
    const conversationId = hello.conversationId ?? options.conversationId

    session = createCallSession({
      ...options,
      sampleRate: rate,
      ...(conversationId ? { conversationId } : {}),
      send: (message: CallMessage) => {
        if (!closed) socket.send(JSON.stringify(message))
      },
      speak: (audio) => {
        // Sent as its own binary frame. The browser knows what to do with it
        // from the `speaking` message that preceded it.
        if (!closed) socket.send(audio)
      },
    })

    // Greets, and starts the clock on any call length limit.
    session.open()
  }

  const finish = () => {
    if (closed) return
    closed = true
    session?.close()
    session = null
    options.onClose?.()
  }

  socket.addEventListener('message', (event) => {
    if (closed) return

    const data = event.data

    // Audio. Copied into a typed view rather than reinterpreted, because a
    // Node socket hands over a Buffer whose bytes may sit at a non-zero offset
    // inside a larger pool, and reading it as Int16 from zero is noise.
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      // Audio before hello means a client that did not introduce itself. Take
      // it at the default rate rather than dropping the call.
      if (!session) start({ type: 'hello' })

      if (compressed) {
        // Passed through exactly as recorded. Nothing here decodes it: the
        // transcription endpoint opens the container itself, which is the
        // whole reason this costs a tenth of the bandwidth and no CPU.
        const chunk = asBytes(data)
        const first = !seenHeader
        seenHeader = true
        session?.pushCompressed(chunk, first, compressed)

        return
      }

      const samples = asSamples(data)
      if (samples.length > 0) session?.push(samples)

      return
    }

    if (typeof data !== 'string') return

    let message: ClientMessage
    try {
      message = JSON.parse(data) as ClientMessage
    } catch {
      // A frame we cannot read is not a reason to hang up on somebody.
      return
    }

    if (message.type === 'hello' && !session) start(message)

    if (message.type === 'levels' && session) {
      const frameMs = message.frameMs > 0 ? message.frameMs : 20
      for (const value of message.values ?? []) {
        // Clamped rather than trusted. These come from a browser, and a level
        // outside the range would move the noise floor somewhere it can never
        // come back from.
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        session.pushLevel(Math.min(1, Math.max(0, value)), frameMs)
      }
    }
  })

  socket.addEventListener('close', finish)
  socket.addEventListener('error', finish)

  return {
    close() {
      finish()
      socket.close()
    },
  }
}

/**
 * Bytes to 16-bit samples, whatever shape they arrived in.
 *
 * The alignment check is the part that matters. A view starting at an odd byte
 * offset cannot be read as 16-bit in place, and doing it anyway throws on some
 * runtimes and returns rubbish on others.
 */
function asSamples(data: ArrayBuffer | ArrayBufferView): Int16Array {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer
  const offset = data instanceof ArrayBuffer ? 0 : data.byteOffset
  const length = data instanceof ArrayBuffer ? data.byteLength : data.byteLength

  if (offset % 2 === 0 && length % 2 === 0) {
    return new Int16Array(buffer as ArrayBuffer, offset, length / 2)
  }

  const copy = new Uint8Array(length - (length % 2))
  copy.set(new Uint8Array(buffer as ArrayBuffer, offset, copy.length))

  return new Int16Array(copy.buffer)
}

/**
 * A binary frame as plain bytes, copied rather than reinterpreted.
 *
 * The same trap as `asSamples`: a Node socket hands over a Buffer whose bytes
 * sit at an offset inside a shared pool, so reading it from zero would send
 * somebody else's audio to the transcriber.
 */
function asBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))

  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}
