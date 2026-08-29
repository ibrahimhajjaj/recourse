import type { ChatMessage, OutgoingAttachment, StreamFrame } from './types.js'

export interface StreamHandlers {
  onSources?: (sources: NonNullable<ChatMessage['sources']>) => void
  onDelta?: (text: string) => void
  onDone?: () => void
  onError?: (message: string) => void
  /** Any frame, for the ones the caller wants to handle itself. */
  onFrame?: (frame: StreamFrame) => void
}

export interface StreamRequest {
  messages: ChatMessage[]
  conversationId?: string
  userId?: string
  userHash?: string
  contact?: Record<string, string | number | boolean>
  /** Results of client actions from the previous, paused turn. */
  actionResults?: Array<{ name: string; input?: unknown; output: unknown }>
  /** Files sent with the message being asked now. */
  attachments?: OutgoingAttachment[]
}

/**
 * Reads the server's event stream. The protocol is one JSON object per SSE
 * frame rather than the AI SDK's wire format, which is what lets this file stay
 * dependency-free and lets the endpoint be consumed from anything that speaks
 * HTTP: a mobile app, a Slack bot, curl.
 */
export async function streamChat(
  endpoint: string,
  request: StreamRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        // History travels as text. The files ride at the top level and belong
        // to the message being asked now, so an image is uploaded once rather
        // than on every turn that follows it.
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      }),
      signal,
    })
  } catch {
    handlers.onError?.('Could not reach the assistant. Check your connection.')
    return
  }

  if (!response.ok || !response.body) {
    handlers.onError?.(
      response.status === 429
        ? 'Too many messages just now. Give it a moment.'
        : `The assistant is unavailable (${response.status}).`,
    )
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Frames are separated by a blank line; anything after the last one is a
    // partial frame that has to wait for the next chunk.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data:'))
      if (!line) continue

      let parsed: StreamFrame
      try {
        parsed = JSON.parse(line.slice(5).trim()) as StreamFrame
      } catch {
        continue
      }

      handlers.onFrame?.(parsed)

      if (parsed.type === 'sources') handlers.onSources?.(parsed.sources)
      else if (parsed.type === 'delta') handlers.onDelta?.(parsed.text)
      else if (parsed.type === 'done') handlers.onDone?.()
      else if (parsed.type === 'error') handlers.onError?.(parsed.message)
    }
  }

  handlers.onDone?.()
}
