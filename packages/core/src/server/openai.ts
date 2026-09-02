/**
 * The agent behind the API shape every chat tool already speaks.
 *
 * The widget is not the only place a support agent is useful. A team already
 * runs something that talks to a model: an internal chat UI, a Slack bot, a
 * script, a desktop client. All of them speak one protocol, and none of them
 * speak ours.
 *
 * So this serves the same agent at `/v1/chat/completions`. Point any of those
 * at the URL and the answers come back grounded in the business's own content,
 * with the safety screens and the actions, instead of whatever the model knows.
 * Nothing new has to be written on their side and no library has to be added.
 *
 * It is a translation, not an emulation. What has no counterpart in that
 * protocol is left out rather than smuggled into a field that means something
 * else, and the two places where a translation genuinely loses something are
 * named below.
 */

import type { SourceRef, StreamFrame } from '../types.js'
import type { Message } from '../types.js'
import { agentFor, type ChatHandlerOptions } from './handler.js'
import { corsHeaders } from './cors.js'
import { callerKey, createRateLimiter, type RateLimiter } from './ratelimit.js'

/**
 * The widget endpoint's options, minus the ones this protocol has nowhere to
 * put.
 *
 * Spelled as an omission rather than inherited whole, because the alternative
 * is a setting that compiles, serves, and does nothing. `identity: { required:
 * true }` accepted here would read as "refuse anyone unverified" while every
 * caller stays anonymous, which is worse than not offering it.
 *
 * - `identity`: the protocol carries no signed visitor id, so there is nothing
 *   to verify and no field to carry it in.
 * - `storage`: a stored file is reached through the upload route, which issues
 *   the signed key this endpoint never sees.
 * - `attachments`: only the text parts of a message are read, so no file
 *   arrives for a policy to judge.
 * - `analytics`: the country comes from a consent decision made in a browser,
 *   and there is no browser here.
 * - `onConversation`: it fires per browser turn on the widget endpoint. Use
 *   `store` for a record of what was asked; that one is honoured.
 */
export interface OpenAiHandlerOptions
  extends Omit<ChatHandlerOptions, 'identity' | 'storage' | 'attachments' | 'analytics' | 'onConversation'> {
  /**
   * What this agent is called when a client lists what it can talk to.
   *
   * Not the underlying model's name. A caller choosing between deployments is
   * choosing between businesses, not between model weights, and naming the
   * weights here tells them nothing and leaks something.
   */
  served?: string
  /**
   * Whether to append the sources under the answer.
   *
   * On by default, and the reason is worth stating. The agent is told to cite
   * as `[1]`, and this protocol has nowhere to put a list of what the numbers
   * mean. Without the footer the reader gets bracketed digits referring to
   * nothing, which is worse than no citations at all.
   */
  citations?: boolean
}

/** What a caller has to send. The rest of the protocol's fields are ignored. */
interface CompletionRequest {
  model?: string
  messages?: Array<{ role?: string; content?: unknown }>
  stream?: boolean
  user?: string
}

const DEFAULT_SERVED = 'recourse'

/**
 * How many messages of a caller's history reach the model.
 *
 * The same ten the widget endpoint keeps. This one needs it more: the widget
 * sends what it is holding, while a client here sends whatever it likes, and a
 * chat interface that has been open all week will happily post five hundred
 * messages. Unbounded, every one of them is paid for on every turn and a long
 * enough conversation stops fitting in the model at all.
 */
const DEFAULT_MAX_HISTORY = 10

/**
 * The most of any single message that is read, when nothing says otherwise.
 *
 * A caller can put a novel in one message. Truncating is the honest response:
 * refusing the request would break a client over something it cannot see, and
 * sending it whole is somebody else deciding what this costs. Where that line
 * falls is a deployment's call, so `maxMessageLength` moves it and this is
 * only where it starts.
 */
const DEFAULT_MAX_MESSAGE_LENGTH = 4000

/**
 * Serves the agent at `/v1/chat/completions` and `/v1/models`.
 *
 * `/v1/models` is not decoration: a client that lists what is available calls
 * it before anything else and shows an empty picker when it 404s, which reads
 * to the person configuring it as a broken URL.
 */
export function createOpenAiHandler(options: OpenAiHandlerOptions) {
  const agent = agentFor(options)
  const served = options.served ?? DEFAULT_SERVED
  const withCitations = options.citations !== false
  const maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH
  const inMemory = createRateLimiter(options.rateLimit)
  const limiter: RateLimiter = options.rateLimiter ?? { check: inMemory }

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)
    const path = new URL(request.url).pathname

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (path.endsWith('/models')) {
      if (request.method !== 'GET') return fail('method not allowed', 405, cors)

      return json(
        {
          object: 'list',
          data: [{ id: served, object: 'model', created: seconds(), owned_by: 'recourse' }],
        },
        200,
        cors,
      )
    }

    if (request.method !== 'POST') return fail('method not allowed', 405, cors)

    // The widget endpoint's own key, not a copy of it. A caller who gets past
    // the limit by switching protocol is not rate limited.
    const gate = await limiter.check(callerKey(request))
    if (!gate.ok) {
      return fail('rate limit reached', 429, { ...cors, 'Retry-After': String(gate.retryAfter) })
    }

    let body: CompletionRequest
    try {
      body = (await request.json()) as CompletionRequest
    } catch {
      return fail('expected a JSON body', 400, cors)
    }

    let messages: Message[]
    try {
      messages = readMessages(body.messages, maxMessageLength)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'bad request', 400, cors)
    }

    messages = messages.slice(-(options.maxHistory ?? DEFAULT_MAX_HISTORY))

    const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`
    const created = seconds()

    if (body.stream) {
      return new Response(streamed(id, created, served, agent, messages, request, withCitations), {
        headers: {
          ...cors,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          // Nginx buffers event streams by default, which looks like a hang.
          'X-Accel-Buffering': 'no',
        },
      })
    }

    let answer = ''
    let sources: SourceRef[] = []
    let failure: string | null = null

    try {
      for await (const frame of agent.stream(messages, [], { signal: request.signal })) {
        if (frame.type === 'delta') answer += frame.text
        else if (frame.type === 'sources') sources = frame.sources
        else if (frame.type === 'error') failure = frame.message
        else if (frame.type === 'notice') answer += `\n\n${frame.message}`
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : 'generation failed'
    }

    // A failure is an error, not an answer with an apology in it. A caller
    // scripting against this has to be able to tell the two apart.
    if (failure) return fail(failure, 502, cors)

    return json(
      {
        id,
        object: 'chat.completion',
        created,
        model: served,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: withCitations ? cite(answer, sources) : answer },
            finish_reason: 'stop',
          },
        ],
      },
      200,
      cors,
    )
  }
}

/**
 * The same turn, one SSE frame at a time.
 *
 * The shape is fixed by the protocol: a first chunk carrying only the role, any
 * number carrying content, one carrying `finish_reason`, then the literal
 * `[DONE]`. Clients rely on all four, and one that never sees `[DONE]` waits
 * for a message that is already complete.
 */
function streamed(
  id: string,
  created: number,
  model: string,
  agent: ReturnType<typeof agentFor>,
  messages: Message[],
  request: Request,
  withCitations: boolean,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

      const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })

      let sources: SourceRef[] = []

      try {
        send(chunk({ role: 'assistant' }))

        for await (const frame of agent.stream(messages, [], { signal: request.signal })) {
          const text = asText(frame)
          if (text) send(chunk({ content: text }))
          if (frame.type === 'sources') sources = frame.sources
          if (frame.type === 'error') throw new Error(frame.message)
        }

        // Last, because the numbers in the answer have to be written before the
        // list explaining them arrives.
        const footer = withCitations ? sourcesFooter(sources) : ''
        if (footer) send(chunk({ content: footer }))

        send(chunk({}, 'stop'))
      } catch (error) {
        // Nothing in the protocol carries an error mid-stream, so the honest
        // thing is to stop and say why in the content the reader already has.
        send(chunk({ content: `\n\n${error instanceof Error ? error.message : 'generation failed'}` }))
        send(chunk({}, 'stop'))
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })
}

/**
 * What of a frame belongs in a plain text answer.
 *
 * Most frames have no counterpart here. A form, a button, a captured lead and a
 * client action are all instructions to a browser, and there is no browser: a
 * caller reading this over the API gets the words and nothing else, which is
 * the honest translation rather than a description of a button they cannot
 * press. Notices are the exception, because a refused file is something the
 * reader has to be told and there is nowhere else to tell them.
 */
function asText(frame: StreamFrame): string {
  if (frame.type === 'delta') return frame.text
  if (frame.type === 'notice') return `\n\n${frame.message}`
  if (frame.type === 'handoff') return `\n\n${frame.message}`

  return ''
}

/** The answer with its sources under it, or unchanged when there are none. */
function cite(answer: string, sources: SourceRef[]): string {
  return `${answer}${sourcesFooter(sources)}`
}

function sourcesFooter(sources: SourceRef[]): string {
  if (sources.length === 0) return ''

  const lines = sources.map((source, position) => {
    const heading = [source.title, source.section].filter(Boolean).join(' > ')
    return `[${position + 1}] ${heading}${source.url ? ` ${source.url}` : ''}`
  })

  return `\n\nSources:\n${lines.join('\n')}`
}

/**
 * Reads the protocol's messages into ours.
 *
 * Content arrives either as a string or as the parts array clients send when
 * there might be an image. Only the text parts are read: an image needs the
 * attachment path, which carries limits and checks this endpoint does not.
 * System messages are dropped rather than obeyed, because a caller is not
 * entitled to rewrite the instructions the business set.
 */
function readMessages(raw: CompletionRequest['messages'], maxMessageLength: number): Message[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('messages must be a non-empty array')
  }

  const messages: Message[] = []

  for (const entry of raw) {
    if (entry?.role !== 'user' && entry?.role !== 'assistant') continue

    const content = readContent(entry.content, maxMessageLength)
    if (content) messages.push({ role: entry.role, content })
  }

  if (messages.length === 0) throw new Error('no user or assistant messages to answer')
  if (messages[messages.length - 1]?.role !== 'user') {
    throw new Error('the last message must be from the user')
  }

  return messages
}

function readContent(content: unknown, maxMessageLength: number): string {
  if (typeof content === 'string') return content.trim().slice(0, maxMessageLength)
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim()
    .slice(0, maxMessageLength)
}

/** The protocol's error shape, which clients parse rather than display raw. */
function fail(message: string, status: number, headers: Record<string, string>): Response {
  return json(
    { error: { message, type: status === 429 ? 'rate_limit_error' : 'invalid_request_error', code: null } },
    status,
    headers,
  )
}

function json(payload: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

const seconds = () => Math.floor(Date.now() / 1000)
