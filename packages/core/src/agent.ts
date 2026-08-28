import { stepCountIs, streamText, type LanguageModel } from 'ai'
import type { Embedder, KnowledgeIndex, Match, Message, SourceRef, StreamFrame } from './types.js'
import { actionsToTools } from './actions/define.js'
import type { Action, ActionContext, Contact } from './actions/types.js'
import { parseIndex } from './knowledge/serialize.js'
import { createRetriever } from './retrieve/retriever.js'
import { gatewayEmbedder } from './embed.js'
import { buildInstructions, contextualQuery, retrievalQuery, toSourceRefs, type PersonaOptions } from './server/prompt.js'

export interface AgentOptions {
  /** The index from `helpdeck ingest`. */
  index: KnowledgeIndex | string
  /** A Gateway model id, or any provider instance. */
  model?: LanguageModel
  persona?: PersonaOptions
  /** Passages given to the model per question. */
  topK?: number
  /** `false` forces keyword-only retrieval. */
  embedder?: Embedder | false
  /**
   * What the agent can do besides answer: capture a lead, open a ticket, call
   * your API, search the web. Without these it is a search box that talks.
   */
  actions?: Action[]
  /**
   * How many model round trips one question may take. Each action call costs
   * one, so this caps a runaway loop rather than the useful work.
   */
  maxSteps?: number
  /** Who the agent is talking to, when the host knows. */
  contact?: Contact
  conversationId?: string
}

export interface StreamOptions {
  signal?: AbortSignal
  /**
   * Receives what retrieval found, before generation starts. The frames
   * deliberately carry only display-safe citations, so this is how a caller
   * gets the full passages for logging without widening the wire protocol.
   */
  onMatches?: (matches: Match[]) => void
}

export interface Answer {
  text: string
  /** Only the sources the answer cited, in citation order. */
  sources: SourceRef[]
  /** Everything retrieval returned, for logging or debugging a bad answer. */
  matches: Match[]
  /** Nothing matched, which means a gap in the content rather than a bad model. */
  unanswered: boolean
  /** Set when the model provider failed. `text` will be empty. */
  error?: string
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'

/**
 * The agent with no transport attached.
 *
 * Everything else in this package is a wrapper over this: the HTTP handler adds
 * server-sent events and CORS, the tool export adds a schema. Answering a
 * WhatsApp webhook, an inbound email, a Discord bot, a Zendesk macro or an
 * eve channel needs none of that, just a question in and text out, so that is
 * what this returns.
 *
 * ```ts
 * const agent = createAgent({ index: knowledge })
 * const { text, sources } = await agent.answer('where is my order?')
 * ```
 */
export function createAgent(options: AgentOptions) {
  const index = parseIndex(options.index)
  const model = options.model ?? DEFAULT_MODEL

  const embedder =
    options.embedder === false || !index.vectors
      ? undefined
      : (options.embedder ?? gatewayEmbedder({ model: index.vectors.model.replace(/^gateway:/, '') }))

  const retriever = createRetriever({ index, embedder, topK: options.topK })
  const actions = options.actions ?? []
  const maxSteps = options.maxSteps ?? 6

  /**
   * The question on its own first. Only a question that finds nothing gets the
   * previous turn folded in, so changing the subject does not drag the old
   * topic along with it.
   */
  async function search(messages: Message[], signal?: AbortSignal): Promise<Match[]> {
    const matches = await retriever.retrieve(retrievalQuery(messages), { signal })
    if (matches.length > 0) return matches

    const withContext = contextualQuery(messages)
    return withContext ? retriever.retrieve(withContext, { signal }) : []
  }

  function toMessages(question: string | Message[], history: Message[]): Message[] {
    if (Array.isArray(question)) return question
    return [...history, { role: 'user', content: question }]
  }

  /**
   * One retrieval, then the model. Shared so `stream` and `answer` cannot drift
   * apart, and so a question is never retrieved twice, which with embeddings
   * turned on would mean paying for the query vector twice.
   */
  async function* run(
    messages: Message[],
    signal: AbortSignal | undefined,
    onMatches: (matches: Match[]) => void,
  ): AsyncGenerator<StreamFrame> {
    const matches = await search(messages, signal)
    onMatches(matches)

    // Sources first, so a UI can render citations while text is still arriving.
    yield { type: 'sources', sources: toSourceRefs(matches) }

    // Actions run inside the model's tool loop and have things to tell the
    // client while they do. They cannot yield from here, so they push frames
    // into this queue and the loop below drains it between model chunks.
    const pending: StreamFrame[] = []
    const context: ActionContext = {
      conversationId: options.conversationId,
      contact: options.contact,
      signal,
      emit: (frame) => pending.push(frame),
    }

    // streamText reports provider failures to onError and ends the stream
    // cleanly, so without capturing this a dead provider looks like silence.
    let failure: string | null = null

    const result = streamText({
      model,
      instructions: buildInstructions(options.persona ?? {}, matches, actions),
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      abortSignal: signal,
      tools: actionsToTools(actions, { context }),
      // Without this the turn ends the moment a tool is called, and the
      // customer gets an action but no answer explaining what happened.
      stopWhen: stepCountIs(maxSteps),
      onError: ({ error }) => {
        failure = error instanceof Error ? error.message : String(error)
      },
    })

    const clientActions = new Set(actions.filter((action) => action.runs === 'client').map((a) => a.name))

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') yield { type: 'delta', text: part.text }
      else if (part.type === 'error') {
        failure = part.error instanceof Error ? part.error.message : String(part.error)
      } else if (part.type === 'tool-call' && clientActions.has(part.toolName)) {
        // No execute() ran, so the browser owes us a result.
        yield {
          type: 'client-action',
          id: part.toolCallId,
          name: part.toolName,
          input: (part.input ?? {}) as Record<string, unknown>,
        }
      }

      while (pending.length > 0) yield pending.shift() as StreamFrame
    }

    while (pending.length > 0) yield pending.shift() as StreamFrame

    if (failure) yield { type: 'error', message: failure }
    else yield { type: 'done' }
  }

  /** Streams the answer as frames. Use this wherever a person is waiting. */
  function stream(
    question: string | Message[],
    history: Message[] = [],
    options: StreamOptions = {},
  ): AsyncGenerator<StreamFrame> {
    return run(toMessages(question, history), options.signal, options.onMatches ?? (() => {}))
  }

  /**
   * Waits for the whole answer. This is the shape a message queue, an email
   * worker or a webhook wants, none of which can stream to anybody.
   */
  async function answer(
    question: string | Message[],
    history: Message[] = [],
    signal?: AbortSignal,
  ): Promise<Answer> {
    let text = ''
    let error: string | undefined
    let sources: SourceRef[] = []
    let matches: Match[] = []

    for await (const frame of run(toMessages(question, history), signal, (found) => {
      matches = found
    })) {
      if (frame.type === 'delta') text += frame.text
      else if (frame.type === 'sources') sources = frame.sources
      else if (frame.type === 'error') error = frame.message
    }

    return {
      text,
      sources: citedOnly(sources, text),
      matches,
      unanswered: matches.length === 0,
      error,
    }
  }

  // Returned as plain functions, not object methods, so destructuring one of
  // them off the agent keeps working.
  return {
    /** Retrieval on its own, when you want the passages rather than an answer. */
    search: (question: string, history: Message[] = [], signal?: AbortSignal) =>
      search(toMessages(question, history), signal),
    stream,
    answer,
  }
}

/**
 * Narrows the source list to what the answer actually cited as [n]. Retrieval
 * deliberately over-fetches, so citing the whole retrieval set would credit
 * pages the answer never used.
 */
export function citedOnly(sources: SourceRef[], text: string): SourceRef[] {
  const used = new Set<number>()
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    used.add(Number.parseInt(match[1] as string, 10) - 1)
  }

  const cited = sources.filter((_, position) => used.has(position))
  return cited.length > 0 ? cited : sources
}
