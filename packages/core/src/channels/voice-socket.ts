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
}

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

  const start = (hello: HelloMessage) => {
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
      const samples = asSamples(data)

      // Audio before hello means a client that did not introduce itself. Take
      // it at the default rate rather than dropping the call.
      if (!session) start({ type: 'hello' })
      if (samples.length > 0) session?.push(samples)

      return
    }

    if (typeof data !== 'string') return

    let message: HelloMessage
    try {
      message = JSON.parse(data) as HelloMessage
    } catch {
      // A frame we cannot read is not a reason to hang up on somebody.
      return
    }

    if (message.type === 'hello' && !session) start(message)
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
