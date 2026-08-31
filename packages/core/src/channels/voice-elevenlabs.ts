import type { Agent } from '../agent.js'
import type { Store } from '../store/types.js'

/**
 * recourse as the knowledge backend for an ElevenLabs voice agent.
 *
 * The fourth way to answer a phone, and the one that needs no Twilio at all.
 * ElevenLabs Agents own the call: their number, their turn-taking, their
 * barge-in, and voices that are the reason anyone picks them. What they do not
 * own is your documentation, so this exposes recourse as a webhook tool their
 * agent calls mid-conversation.
 *
 * The division of labour is the point. Their agent is told, in its system
 * prompt, to answer only from what this returns. It stays fluent and
 * interruptible; the facts stay grounded and cited.
 */

export interface ElevenLabsToolOptions {
  agent: Agent
  /**
   * Bearer token the ElevenLabs tool must present. Configure it there as a
   * secret header. Without one this endpoint answers anybody.
   */
  token?: string
  /** Passages returned per call. Keep it small: it is read aloud. */
  topK?: number
  /**
   * Returns the retrieved passages instead of a written answer, leaving the
   * ElevenLabs agent to compose the reply itself. Slower to a first word but
   * the voice agent keeps full control of phrasing.
   */
  mode?: 'answer' | 'passages'
  store?: Store
}

/**
 * A webhook tool endpoint.
 *
 * Accepts the question as a query parameter or a JSON body, because their tool
 * builder can be configured either way and getting it wrong is a silent
 * failure that only shows up as an agent saying "I don't know".
 */
export function elevenLabsToolRoute(options: ElevenLabsToolOptions) {
  const mode = options.mode ?? 'answer'

  return async function handle(request: Request): Promise<Response> {
    if (options.token) {
      const presented =
        request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
        request.headers.get('x-recourse-token')

      if (presented !== options.token) {
        return json({ error: 'unauthorized' }, 401)
      }
    }

    const url = new URL(request.url)
    let question = url.searchParams.get('question') ?? url.searchParams.get('query') ?? ''
    let conversationId = url.searchParams.get('conversation_id') ?? undefined
    let caller = url.searchParams.get('caller') ?? undefined

    if (!question && request.method !== 'GET') {
      try {
        const body = (await request.json()) as {
          question?: unknown
          query?: unknown
          conversation_id?: unknown
          caller?: unknown
        }
        question = typeof body.question === 'string' ? body.question : String(body.query ?? '')
        conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : conversationId
        caller = typeof body.caller === 'string' ? body.caller : caller
      } catch {
        return json({ error: 'expected a JSON body or a question parameter' }, 400)
      }
    }

    question = question.trim()
    if (!question) return json({ error: 'a question is required' }, 400)

    try {
      if (mode === 'passages') {
        const matches = await options.agent.search(question)
        return json({
          found: matches.length > 0,
          passages: matches.map((match, position) => ({
            ref: position + 1,
            title: match.chunk.title,
            section: match.chunk.section,
            text: match.chunk.text,
          })),
        })
      }

      const result = await options.agent.answer(question, [], {
        conversationId: conversationId ?? (caller ? `phone:${caller}` : undefined),
        contact: caller ? { id: caller, phone: caller } : undefined,
        channel: 'phone',
      })

      // A provider failure comes back on the result rather than as a throw, so
      // an unchecked path here returns an empty answer and their agent says
      // nothing at all, which is the worst possible thing on a phone call.
      const answer = stripCitations(result.text)
      if (result.error || !answer) {
        return json({ answer: 'I could not look that up just now.', found: false, sources: [] })
      }

      // The answer is going to be spoken, so citation markers are stripped and
      // the sources returned separately for the transcript rather than read out.
      return json({
        answer,
        found: !result.unanswered,
        sources: result.sources.map((source) => source.title),
      })
    } catch (error) {
      console.error('[recourse] elevenlabs tool call failed', error)
      // A 200 with an honest message beats a 500: the agent can say something
      // useful, where an error leaves it improvising or silent.
      return json({ answer: 'I could not look that up just now.', found: false, sources: [] }, 200)
    }
  }
}

function stripCitations(text: string): string {
  return text.replace(/\s*\[\d{1,2}\]/g, '').trim()
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * The system prompt to paste into the ElevenLabs agent.
 *
 * Generated rather than documented because the wording is load-bearing: an
 * agent not explicitly fenced to the tool will answer from its own model
 * knowledge, fluently and wrongly, which is the exact failure this whole
 * project exists to prevent.
 */
export function elevenLabsSystemPrompt(options: { business?: string; toolName?: string; fallback?: string }): string {
  const business = options.business ? ` for ${options.business}` : ''
  const tool = options.toolName ?? 'search_help'
  const fallback =
    options.fallback ?? 'I do not have that to hand, but I can take a message and have someone call you back.'

  return [
    `You are a customer support agent${business}, speaking on the phone.`,
    '',
    `Before answering any question about this business, call ${tool} with the caller's question.`,
    `Answer only from what ${tool} returns. If it returns found: false, say exactly: "${fallback}"`,
    'Never invent prices, policies, delivery times, order details or availability.',
    '',
    'You are on a call, so: keep replies to one or two sentences, never read out lists,',
    'never spell out URLs, and offer to send details by text or email instead.',
    'Ask one question at a time and wait for the answer.',
  ].join('\n')
}
