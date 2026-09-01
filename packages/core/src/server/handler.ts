import type { LanguageModel } from 'ai'
import type { Embedder, KnowledgeIndex, Match, Message, StreamFrame } from '../types.js'
import type { Store } from '../store/types.js'
import type { Action } from '../actions/types.js'
import type { Procedure } from '../procedures/types.js'
import { countryFrom } from './country.js'
import { validateAttachments, type AttachmentPolicy } from '../attachments.js'
import type { Blobs } from '../storage/blobs.js'
import { resolveStoredAttachments } from '../storage/references.js'
import type { PrepareOptions } from '../attachments-prepare.js'
import type { ClassifierPolicy } from '../safety/types.js'
import { createAgent, type AgentOptions } from '../agent.js'
import type { PersonaOptions } from './prompt.js'
import { corsHeaders, type CorsOptions } from './cors.js'
import { callerKey, createRateLimiter, type RateLimiter, type RateLimitOptions } from './ratelimit.js'
import { resolveIdentity, type IdentityClaim, type IdentityOptions } from '../identity.js'

export interface ChatHandlerOptions {
  /** The index from `recourse ingest`. Pass the imported JSON or its text. */
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
   * The thresholds retrieval decides relevance by. The defaults were measured
   * against one corpus and one embedding model; measure your own.
   */
  retrieval?: AgentOptions['retrieval']
  /** Replaces the instructions the model is given. Compose from `buildInstructions`. */
  prompt?: AgentOptions['prompt']
  /**
   * Searches content written in one language with questions asked in any.
   *
   * Off unless set. Without it a shop whose help pages are in English returns
   * nothing for the same question asked in Arabic, French or Turkish, and the
   * agent says it cannot find something it is standing on.
   */
  searchLanguage?: AgentOptions['searchLanguage']
  /** Ceiling on a single reply, counting whatever the model spends thinking. */
  maxOutputTokens?: number
  /**
   * Set `false` to force keyword-only retrieval. Defaults to matching whatever
   * the index was built with.
   */
  embedder?: Embedder | false
  cors?: CorsOptions
  rateLimit?: RateLimitOptions
  /**
   * A limiter several instances share, instead of the per-instance default.
   *
   * `rateLimit` only bounds one process. On serverless that means N instances
   * hand out N budgets and every cold start resets them, which is fine as a
   * guard against a script and useless as a spending control.
   */
  rateLimiter?: RateLimiter
  /** Longest single message accepted, in characters. */
  maxMessageLength?: number
  /** Turns of history kept. Older ones are dropped from the model call. */
  maxHistory?: number
  /** Fires after each answer. Wire analytics, transcripts or lead capture here. */
  onConversation?: (event: ConversationEvent) => void | Promise<void>
  /**
   * Records which country a conversation came from, when this says so.
   *
   * Off unless set, and a function rather than a flag because consent is a
   * decision only the deployment can make: the library cannot know whether a
   * banner was shown or what the visitor agreed to. `consented('analytics')`
   * covers the common case of a consent manager that sets a header.
   *
   *     import { consented } from '@recourse-ai/core/server'
   *
   *     analytics: { country: consented('analytics') }
   *
   * The value comes from whatever the edge already resolved, so no address is
   * received and none is stored. Behind nothing that resolves one, no country
   * is recorded and everything else works the same.
   */
  analytics?: { country?: (request: Request) => boolean }
  /**
   * Verifies who the visitor is, so actions can safely touch their data.
   * Without it every visitor is anonymous, which is fine for a public FAQ and
   * not fine for anything that looks up an order.
   */
  identity?: IdentityOptions
  /** Records transcripts, leads and answer gaps. */
  store?: Store
  /**
   * What the agent can do besides answer. Without these it is a search box
   * that talks.
   */
  actions?: Action[]
  /** Model round trips allowed per question. Each action call costs one. */
  maxSteps?: number
  /** Standard operating procedures the agent follows on matching conversations. */
  procedures?: Procedure[]
  /**
   * Extra `{{name}}` values for procedures, read fresh on every turn.
   *
   * `procedureVariables: () => ({ agentAvailable: helpdesk.agentAvailable() })`
   * is the one this exists for: a procedure that offers live chat should stop
   * offering it when nobody is on shift.
   */
  procedureVariables?: () => Record<string, string | number | boolean | undefined>
  /**
   * What files a visitor may attach. `false` refuses them outright, which is
   * the right setting for a public FAQ that has no use for one.
   *
   * The limits here are the real ones. The widget applies the same caps so a
   * customer is told early, but a request can be made by anything.
   */
  attachments?: (AttachmentPolicy & PrepareOptions) | false
  /**
   * Where uploaded files live, paired with the secret the upload route signed
   * their keys with.
   *
   * Without this, a message referring to a stored file is refused rather than
   * looked up against nothing. With it, the reference is checked before
   * anything is read: the token proves this deployment issued that key.
   */
  storage?: {
    blobs: Blobs
    secret: string
    /** Largest stored file loaded into a turn. 25MB by default. */
    maxBytes?: number
    /** Sends images as bytes rather than as a signed link. */
    inlineImages?: boolean
  }
  /**
   * What to refuse, deflect or escalate, and how readily. On by default with a
   * narrow policy; `false` turns it off entirely.
   */
  classifier?: ClassifierPolicy | false
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
  // A shared limiter wins when one is given; otherwise the per-instance
  // counter, so nothing changes for anyone who configured nothing.
  const inMemory = createRateLimiter(options.rateLimit)
  const limiter: RateLimiter = options.rateLimiter ?? { check: inMemory }

  // All the retrieval and generation lives in the agent. This function only
  // adds what HTTP needs: method checks, CORS, rate limiting and framing.
  const agent = createAgent({
    index: options.index,
    model: options.model,
    persona: options.persona,
    topK: options.topK,
    embedder: options.embedder,
    ...(options.retrieval ? { retrieval: options.retrieval } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    store: options.store,
    actions: options.actions,
    maxSteps: options.maxSteps,
    procedures: options.procedures,
    ...(options.procedureVariables ? { procedureVariables: options.procedureVariables } : {}),
    // The same option carries both halves: what is accepted, and how it is
    // read. Splitting them across two settings only invites them to disagree.
    ...(options.attachments ? { attachments: options.attachments } : {}),
    ...(options.classifier !== undefined ? { classifier: options.classifier } : {}),
    ...(options.searchLanguage ? { searchLanguage: options.searchLanguage } : {}),
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
  })

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, cors)
    }

    const gate = await limiter.check(callerKey(request))
    if (!gate.ok) {
      return json({ error: 'too many requests' }, 429, { ...cors, 'Retry-After': String(gate.retryAfter) })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'expected a JSON body' }, 400, cors)
    }

    // Thumbs arrive on the same endpoint, so the widget needs no second URL to
    // configure and no second CORS entry to get wrong.
    const feedback = (body as { feedback?: unknown }).feedback
    if (feedback) {
      return recordFeedback(feedback, options.store, cors)
    }

    // A visitor asking to be forgotten. Deliberately on the same endpoint, so
    // the widget needs no second URL and no second CORS entry.
    const forget = (body as { deleteConversation?: unknown }).deleteConversation

    if (typeof forget === 'string' && forget) {
      // Best-effort privacy rather than a compliance mechanism, and the
      // difference is worth being clear about: anyone who knows a conversation
      // id can delete it. Ids are minted in the browser and unguessable, so in
      // practice that is the person whose conversation it is, and the worst a
      // guess achieves is deleting a transcript the business kept. Refusing
      // outright would mean a visitor cannot delete their own words at all,
      // which is a worse answer.
      const deleted = options.store ? await options.store.deleteConversation(forget) : false
      return json({ deleted }, 200, cors)
    }

    // Files ride on the request body and apply to the message just sent. Every
    // limit is re-checked here; the widget's copy of them is a courtesy.
    const attachmentPolicy = options.attachments
    const submitted = (body as { attachments?: unknown }).attachments
    const files =
      attachmentPolicy === false
        ? {
            accepted: [],
            rejected: (Array.isArray(submitted) ? submitted : []).map((item) => ({
              name: typeof (item as { name?: unknown })?.name === 'string' ? String((item as { name: string }).name) : 'file',
              reason: 'files are not accepted here',
            })),
          }
        : validateAttachments(submitted, {
            ...attachmentPolicy,
            allowStored: attachmentPolicy?.allowStored ?? Boolean(options.storage),
          })

    // Stored files are fetched only after their reference has been checked,
    // and only ever from our own bucket. A customer-supplied `url` is still
    // never fetched by this server.
    if (options.storage && files.accepted.some((file) => file.key)) {
      const resolved = await resolveStoredAttachments(files.accepted, {
        blobs: options.storage.blobs,
        secret: options.storage.secret,
        ...(options.storage.maxBytes ? { maxBytes: options.storage.maxBytes } : {}),
        ...(options.storage.inlineImages ? { inlineImages: true } : {}),
      })
      files.accepted = resolved.accepted
      files.rejected = [...files.rejected, ...resolved.rejected]
    }


    let messages: Message[]
    try {
      messages = parseMessages(body, maxMessageLength, files.accepted.length > 0)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'bad request' }, 400, cors)
    }

    const lastMessage = messages[messages.length - 1]
    if (lastMessage && files.accepted.length > 0) lastMessage.attachments = files.accepted

    const claim = body as {
      userId?: string
      userHash?: string
      contact?: IdentityClaim['contact']
      conversationId?: string
      actionResults?: Array<{ name?: unknown; input?: unknown; output?: unknown }>
    }

    // Whatever the browser ran, capped so a page cannot flood the prompt.
    const clientResults = (Array.isArray(claim?.actionResults) ? claim.actionResults : [])
      .filter((result) => typeof result?.name === 'string')
      .slice(0, 8)
      .map((result) => ({ name: String(result.name), input: result.input, output: result.output }))
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

        // Said before the answer, so a refused file never looks like something
        // the agent silently ignored.
        for (const refusal of files.rejected) {
          send({ type: 'notice', message: `${refusal.name} was not attached: ${refusal.reason}.` })
        }

        try {
          const streamed = agent.stream(recent, [], {
            signal: request.signal,
            contact: identity.contact,
            conversationId: typeof claim?.conversationId === 'string' ? claim.conversationId : undefined,
            ...(options.analytics?.country?.(request) ? { country: countryFrom(request) } : {}),
            clientResults,
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

/**
 * Records a thumb against an answer.
 *
 * The browser counts assistant replies, not message ids, because it never sees
 * them. Resolving the index here keeps ids server-side where they belong.
 */
async function recordFeedback(
  raw: unknown,
  store: Store | undefined,
  cors: Record<string, string>,
): Promise<Response> {
  const { conversationId, messageIndex, value } = (raw ?? {}) as {
    conversationId?: unknown
    messageIndex?: unknown
    value?: unknown
  }

  if (typeof conversationId !== 'string' || typeof messageIndex !== 'number') {
    return json({ error: 'feedback needs conversationId and messageIndex' }, 400, cors)
  }
  if (value !== 'positive' && value !== 'negative' && value !== null) {
    return json({ error: 'feedback value must be positive, negative or null' }, 400, cors)
  }
  if (!store) return json({ error: 'no store configured to record feedback' }, 501, cors)

  const found = await store.getConversation(conversationId)
  if (!found) return json({ error: 'unknown conversation' }, 404, cors)

  const replies = found.messages.filter((message) => message.role === 'assistant')
  const target = replies[messageIndexToReply(messageIndex, found.messages)]
  if (!target) return json({ error: 'unknown message' }, 404, cors)

  await store.setFeedback(conversationId, target.id, value)
  return new Response(null, { status: 204, headers: cors })
}

/**
 * The widget indexes into its own list, which counts the greeting and the
 * customer's own turns. Only assistant replies can be rated, so map across.
 */
function messageIndexToReply(index: number, stored: Array<{ role: string }>): number {
  let replies = -1
  for (let i = 0; i <= index && i < stored.length; i++) {
    if (stored[i]?.role === 'assistant') replies++
  }
  return Math.max(replies, 0)
}

/** Accepts either a full transcript or a single message with optional history. */
function parseMessages(body: unknown, maxLength: number, hasAttachments = false): Message[] {
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

  // Sending a photo and nothing else is a normal thing to do, and a model needs
  // something in the text slot to answer it.
  const lastIsUser = messages[messages.length - 1]?.role === 'user'
  if (hasAttachments && !lastIsUser) {
    messages.push({ role: 'user', content: 'Please look at the attached file.' })
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
