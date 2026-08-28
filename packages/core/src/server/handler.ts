import type { LanguageModel } from 'ai'
import type { Embedder, KnowledgeIndex, Match, Message, StreamFrame } from '../types.js'
import type { Store } from '../store/types.js'
import { createAgent } from '../agent.js'
import type { PersonaOptions } from './prompt.js'
import { corsHeaders, type CorsOptions } from './cors.js'
import { callerKey, createRateLimiter, type RateLimitOptions } from './ratelimit.js'
import { resolveIdentity, type IdentityClaim, type IdentityOptions } from '../identity.js'

export interface ChatHandlerOptions {
  /** The index from `helpdeck ingest`. Pass the imported JSON or its text. */
  index: KnowledgeIndex | string
  /**
   * A model id string routed through the Vercel AI Gateway, or a model instance
   * from any provider package if you would rather bring your own key.
   */
  model?: LanguageModel
  persona?: PersonaOptions
  /** Chunks handed to the model per turn. */
  topK?: number
  /**
   * Set `false` to force keyword-only retrieval. Defaults to matching whatever
   * the index was built with.
   */
  embedder?: Embedder | false
  cors?: CorsOptions
  rateLimit?: RateLimitOptions
  /** Longest single message accepted, in characters. */
  maxMessageLength?: number
  /** Turns of history kept. Older ones are dropped from the model call. */
  maxHistory?: number
  /** Fires after each answer. Wire analytics, transcripts or lead capture here. */
  onConversation?: (event: ConversationEvent) => void | Promise<void>
  /**
   * Verifies who the visitor is, so actions can safely touch their data.
   * Without it every visitor is anonymous, which is fine for a public FAQ and
   * not fine for anything that looks up an order.
   */
  identity?: IdentityOptions
  /** Records transcripts, leads and answer gaps. */
  store?: Store
}

export interface ConversationEvent {
  question: string
  answer: string
  matches: Match[]
  /** True when the retriever returned nothing, meaning a documentation gap. */
  unanswered: boolean
  request: Request
}

const DEFAULT_MAX_MESSAGE_LENGTH = 4000
const DEFAULT_MAX_HISTORY = 10

/**
 * A web-standard `Request -> Response` function, which is the only interface
 * every modern JavaScript server agrees on. It drops straight into a Next.js
 * route handler, a Hono route, a Cloudflare Worker, Bun.serve or Deno.serve
 * with no adapter.
 */
export function createChatHandler(options: ChatHandlerOptions) {
  const maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY
  const limiter = createRateLimiter(options.rateLimit)

  // All the retrieval and generation lives in the agent. This function only
  // adds what HTTP needs: method checks, CORS, rate limiting and framing.
  const agent = createAgent({
    index: options.index,
    model: options.model,
    persona: options.persona,
    topK: options.topK,
    embedder: options.embedder,
    store: options.store,
  })

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, cors)
    }

    const gate = limiter(callerKey(request))
    if (!gate.ok) {
      return json({ error: 'too many requests' }, 429, { ...cors, 'Retry-After': String(gate.retryAfter) })
    }

    let body: unknown
    let messages: Message[]
    try {
      body = await request.json()
      messages = parseMessages(body, maxMessageLength)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'bad request' }, 400, cors)
    }

    const claim = body as { userId?: string; userHash?: string; contact?: IdentityClaim['contact']; conversationId?: string }
    const identity = await resolveIdentity(
      { userId: claim?.userId, userHash: claim?.userHash, contact: claim?.contact },
      options.identity,
    )

    if (identity.rejected) {
      return json({ error: 'identity could not be verified' }, 401, cors)
    }

    const recent = messages.slice(-maxHistory)

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (frame: StreamFrame) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        }

        let answer = ''
        let matches: Match[] = []

        try {
          const streamed = agent.stream(recent, [], {
            signal: request.signal,
            contact: identity.contact,
            conversationId: typeof claim?.conversationId === 'string' ? claim.conversationId : undefined,
            // Captured from the single retrieval the agent already ran, rather
            // than retrieving a second time just to log what was used.
            onMatches: (found) => {
              matches = found
            },
          })

          for await (const frame of streamed) {
            if (frame.type === 'delta') answer += frame.text
            send(frame)
          }
        } catch (error) {
          send({ type: 'error', message: error instanceof Error ? error.message : 'generation failed' })
        } finally {
          controller.close()

          // Never let an analytics hook take the response down with it.
          try {
            await options.onConversation?.({
              question: recent[recent.length - 1]?.content ?? '',
              answer,
              matches,
              unanswered: matches.length === 0,
              request,
            })
          } catch {
            /* ignore */
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Nginx buffers event streams by default, which looks exactly like a hang.
        'X-Accel-Buffering': 'no',
      },
    })
  }
}

/** Accepts either a full transcript or a single message with optional history. */
function parseMessages(body: unknown, maxLength: number): Message[] {
  const payload = body as { messages?: unknown; message?: unknown; history?: unknown }
  const raw = Array.isArray(payload?.messages)
    ? payload.messages
    : [...(Array.isArray(payload?.history) ? payload.history : []), { role: 'user', content: payload?.message }]

  const messages: Message[] = []
  for (const item of raw) {
    const entry = item as { role?: unknown; content?: unknown }
    if (entry?.role !== 'user' && entry?.role !== 'assistant') continue
    if (typeof entry.content !== 'string') continue
    const content = entry.content.trim()
    if (content.length === 0) continue
    messages.push({ role: entry.role, content: content.slice(0, maxLength) })
  }

  if (messages.length === 0) throw new Error('no messages provided')
  if (messages[messages.length - 1]?.role !== 'user') throw new Error('the last message must be from the user')

  return messages
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
