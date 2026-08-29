import { stepCountIs, streamText, type LanguageModel } from 'ai'
import type { Embedder, KnowledgeIndex, Match, Message, SourceRef, StreamFrame } from './types.js'
import { actionsToTools } from './actions/define.js'
import type { Action, ActionContext, Contact } from './actions/types.js'
import type { Channel, Store, StoredMessage } from './store/types.js'
import { renderProcedures, unlockedBy, usableProcedures } from './procedures/index.js'
import type { Webhooks } from './webhooks/index.js'
import type { Procedure } from './procedures/types.js'
import { parseIndex } from './knowledge/serialize.js'
import { createRetriever } from './retrieve/retriever.js'
import { createEmbedder } from './embed.js'
import { prepareAttachments, type PrepareOptions } from './attachments-prepare.js'
import { blocks, createClassifier } from './safety/classify.js'
import type { ClassifierPolicy, Decision } from './safety/types.js'
import {
  buildInstructions,
  contextualQuery,
  retrievalQuery,
  toSourceRefs,
  type ActionOutcome,
  type PersonaOptions,
} from './server/prompt.js'

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
  /**
   * Records transcripts, feedback and leads. Answering works without one; the
   * activity log, the analytics and the help desk do not.
   */
  store?: Store
  /** Where this conversation is happening. Used for per-channel analytics. */
  channel?: Channel
  /**
   * Standard operating procedures the agent follows when their trigger matches.
   * Procedures referencing an action this agent does not have are dropped, so
   * the agent never gets halfway through one and improvises the rest.
   */
  procedures?: Procedure[]
  /** Notifies other systems as things happen. */
  webhooks?: Webhooks
  /**
   * How files the customer sends are handled. Images reach the model as
   * content parts, which needs a model that can see; documents are extracted
   * to text here and work with any model at all.
   *
   * Set `vision: false` when the configured model is text-only, so an attached
   * photo is described rather than sent and the provider does not reject the
   * whole request.
   */
  attachments?: PrepareOptions
  /**
   * What to refuse, deflect or escalate, and how readily.
   *
   * On by default with a narrow policy: instruction-override attempts and
   * threats are refused, and a message that sounds like a crisis is handed to
   * a person. Pass `false` to turn the whole layer off, or a policy of your
   * own to change where the line sits.
   *
   * A refused message never reaches the model, so this makes the hostile path
   * faster as well as safer.
   */
  classifier?: ClassifierPolicy | false
}

export interface StreamOptions {
  signal?: AbortSignal
  /** Groups turns into one thread. Generated when absent. */
  conversationId?: string
  contact?: Contact
  channel?: Channel
  /**
   * Results of client actions the browser has since run. Sending these back
   * completes a turn the agent paused halfway through.
   */
  clientResults?: ActionOutcome[]
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
  /**
   * Things the customer should be told that are not part of the answer, such
   * as a file that could not be read. A channel with no UI for them should
   * send them as their own message rather than drop them.
   */
  notices: string[]
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
      : (options.embedder ?? createEmbedder({ model: index.vectors.model.replace(/^(gateway|endpoint|provider):/, '') }))

  const retriever = createRetriever({ index, embedder, topK: options.topK })
  const classifier = options.classifier === false ? null : createClassifier(options.classifier ?? {})
  const actions = options.actions ?? []
  const maxSteps = options.maxSteps ?? 6

  // Resolved once at construction: which procedures this agent can actually
  // run, and which procedure-only actions they unlock.
  const { usable: procedures, dropped } = usableProcedures(options.procedures ?? [], actions)
  const unlocked = unlockedBy(procedures)

  for (const { name, missing } of dropped) {
    console.warn(`[helpdeck] procedure "${name}" disabled: no action named ${missing.join(', ')}`)
  }

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
    call: StreamOptions,
    onMatches: (matches: Match[]) => void,
  ): AsyncGenerator<StreamFrame> {
    const signal = call.signal
    const conversationId = call.conversationId ?? options.conversationId ?? newId('c')
    const contact = call.contact ?? options.contact
    const channel = call.channel ?? options.channel ?? 'web'

    const last = messages[messages.length - 1]
    const store = options.store

    // Before retrieval and before the model, because a refused message should
    // cost neither. This is the tier that makes the hostile path faster than
    // the ordinary one rather than slower.
    const screened = classifier ? await classifier.check(last?.content ?? '', { conversationId }) : null

    // Detectors may rewrite as well as judge: smuggled invisible characters
    // come out here, so everything downstream reads what the customer sees.
    if (screened && last && screened.text !== last.content) {
      messages = messages.map((message, position) =>
        position === messages.length - 1 ? { ...message, content: screened.text } : message,
      )
    }

    const question = messages[messages.length - 1]?.content ?? ''

    if (screened && blocks(screened)) {
      yield* refuse(screened, { conversationId, channel, contact, question })
      return
    }

    const matches = await search(messages, signal)
    onMatches(matches)

    // Only the newest message's files. Older ones were already read into an
    // earlier answer, and re-sending an image every turn is billed every turn.
    const attachments = messages[messages.length - 1]?.attachments ?? []
    const prepared = attachments.length > 0 ? await prepareAttachments(attachments, options.attachments) : null

    // A continuation is the second half of a turn the browser interrupted, not
    // a new question, so the customer's message is already in the transcript.
    const isContinuation = (call.clientResults?.length ?? 0) > 0

    if (store && !isContinuation) {
      const record: StoredMessage = {
        id: newId('m'),
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      }
      // Metadata only. The bytes stay in the turn that carried them.
      if (attachments.length > 0) {
        record.attachments = attachments.map(({ name, mimeType, bytes }) => ({ name, mimeType, bytes }))
      }
      await store.appendMessage(conversationId, record, { channel, contact })
    }

    // Sources first, so a UI can render citations while text is still arriving.
    yield { type: 'sources', sources: toSourceRefs(matches) }

    // A file that could not be read is also in the instructions, so the agent
    // can answer around it. This frame is the guarantee: the prompt is advice a
    // small model may ignore, and an unread file must never pass in silence.
    for (const failure of prepared?.failures ?? []) {
      yield { type: 'notice', message: `${failure.name} could not be read: ${trimStop(failure.reason)}.` }
    }

    // Actions run inside the model's tool loop and have things to tell the
    // client while they do. They cannot yield from here, so they push frames
    // into this queue and the loop below drains it between model chunks.
    const pending: StreamFrame[] = []
    /** Kept so the transcript records what the agent actually did, not just said. */
    const ran: Array<{ name: string; input: unknown; output: unknown }> = []

    const context: ActionContext = {
      conversationId,
      contact,
      signal,
      store: options.store,
      webhooks: options.webhooks,
      emit: (frame) => pending.push(frame),
    }

    // streamText reports provider failures to onError and ends the stream
    // cleanly, so without capturing this a dead provider looks like silence.
    let failure: string | null = null

    const result = streamText({
      model,
      instructions: buildInstructions({
        persona: options.persona,
        matches,
        actions,
        procedures: renderProcedures(procedures, { contact }),
        clientResults: call.clientResults,
        ...(prepared?.context ? { attachments: prepared.context } : {}),
        ...(prepared?.failures.length ? { unreadable: prepared.failures } : {}),
      }),
      messages: messages.map((message, position) => {
        // The file parts belong on the message they arrived with, which is the
        // last one; everything before it goes across as plain text.
        const parts = position === messages.length - 1 ? (prepared?.parts ?? []) : []
        if (message.role !== 'user' || parts.length === 0) {
          return { role: message.role, content: message.content }
        }
        return {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: message.content }, ...parts],
        }
      }),
      abortSignal: signal,
      tools: actionsToTools(actions, { context, unlocked }),
      // Without this the turn ends the moment a tool is called, and the
      // customer gets an action but no answer explaining what happened.
      stopWhen: stepCountIs(maxSteps),
      onError: ({ error }) => {
        failure = error instanceof Error ? error.message : String(error)
      },
    })

    const clientActions = new Map(
      actions.filter((action) => action.runs === 'client').map((action) => [action.name, action]),
    )

    let answered = ''
    /** Set when an output check stopped the answer. */
    let withheld: Decision | null = null
    // How much of `answered` has already reached the customer. With buffering
    // this stays at zero until the whole answer has been checked.
    let released = 0
    let checkedTo = 0

    const checksOutput = classifier?.checksOutput === true
    const buffering = classifier?.buffers === true

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        answered += part.text

        if (!checksOutput) {
          released = answered.length
          yield { type: 'delta', text: part.text }
        } else if (!buffering) {
          // Checked on sentence boundaries, and released only as far as it has
          // been checked. Sending the unchecked tail and inspecting it later
          // would mean the customer reads the leak before we notice it, which
          // is the entire failure this mode exists to prevent. The cost is
          // that the answer arrives a sentence at a time rather than a word.
          const boundary = lastBoundary(answered)
          if (boundary > checkedTo) {
            const verdict = await classifier.checkOutput(answered.slice(0, boundary), { conversationId })
            if (blocks(verdict)) {
              withheld = verdict
              break
            }
            checkedTo = boundary
          }
          if (checkedTo > released) {
            yield { type: 'delta', text: answered.slice(released, checkedTo) }
            released = checkedTo
          }
        }
      } else if (part.type === 'tool-result') {
        ran.push({ name: part.toolName, input: part.input, output: part.output })
      }
      else if (part.type === 'error') {
        failure = part.error instanceof Error ? part.error.message : String(part.error)
      } else if (part.type === 'tool-call' && clientActions.has(part.toolName)) {
        // No execute() ran, so the browser owes us a result.
        const definition = clientActions.get(part.toolName)
        yield {
          type: 'client-action',
          id: part.toolCallId,
          name: part.toolName,
          input: (part.input ?? {}) as Record<string, unknown>,
          ...(definition?.clientPayload ? { payload: definition.clientPayload } : {}),
        }
      }

      while (pending.length > 0) yield pending.shift() as StreamFrame
    }

    while (pending.length > 0) yield pending.shift() as StreamFrame

    if (checksOutput && !withheld && answered.length > released) {
      // The tail after the last sentence boundary, and the whole answer when
      // buffering. Either way this is the last chance to look at it.
      const verdict = await classifier.checkOutput(answered, { conversationId })
      if (blocks(verdict)) withheld = verdict
      else {
        yield { type: 'delta', text: answered.slice(released) }
        released = answered.length
      }
    }

    if (withheld) {
      const replacement =
        withheld.message ?? 'Sorry, I could not give you a reliable answer to that. Let me get a person to help.'

      // Said whichever way the answer was being delivered. When buffering the
      // customer has seen nothing, so this is the entire reply; when streaming
      // they have seen the sentences before the one that failed.
      if (released === 0) {
        // Nothing reached the customer, so the replacement is the whole reply.
        yield { type: 'delta', text: replacement }
        answered = replacement
      } else {
        // Some sentences were already read. All that is left is to stop and
        // say so; pretending they were never sent would be a lie.
        yield { type: 'notice', message: replacement }
        answered = answered.slice(0, released)
      }

      console.warn(
        `[helpdeck] answer withheld: ${withheld.matched?.reason ?? withheld.action}`,
      )
    }

    // The paused half of a client-action turn says nothing; recording it would
    // put a blank reply in the transcript above the real one.
    const saidNothing = answered.trim().length === 0 && ran.length === 0

    if (store && !saidNothing) {
      const record: StoredMessage = {
        id: newId('m'),
        role: 'assistant',
        content: answered,
        createdAt: new Date().toISOString(),
        sources: toSourceRefs(matches),
        // A turn that retrieved nothing and called nothing is a content gap.
        unanswered: matches.length === 0 && ran.length === 0,
      }
      if (ran.length > 0) record.actions = ran
      await store.appendMessage(conversationId, record, { channel, contact })
    }

    if (!saidNothing) {
      options.webhooks?.emit(matches.length === 0 ? 'conversation.unanswered' : 'conversation.answered', {
        conversationId,
        channel,
        question,
        answer: answered,
        sources: toSourceRefs(matches),
      })
    }

    if (failure) yield { type: 'error', message: explain(failure, prepared !== null) }
    else yield { type: 'done' }
  }

  /**
   * The turn a refused message gets instead.
   *
   * Still a complete turn: the transcript records what was asked and what was
   * said, the webhooks fire, and the customer gets a sentence rather than
   * silence. A refusal nobody can audit is not a safety feature.
   */
  async function* refuse(
    decision: Decision,
    turn: { conversationId: string; channel: Channel; contact?: Contact; question: string },
  ): AsyncGenerator<StreamFrame> {
    const message =
      decision.message ??
      (decision.action === 'handoff'
        ? 'Let me put you through to someone who can help.'
        : 'I can only help with questions about our products and your orders.')

    yield { type: 'sources', sources: [] }

    if (decision.action === 'handoff') {
      yield { type: 'handoff', message }
    } else {
      yield { type: 'delta', text: message }
    }

    if (options.store) {
      const now = new Date().toISOString()
      await options.store.appendMessage(
        turn.conversationId,
        { id: newId('m'), role: 'user', content: turn.question, createdAt: now },
        { channel: turn.channel, contact: turn.contact },
      )
      await options.store.appendMessage(turn.conversationId, {
        id: newId('m'),
        role: 'assistant',
        content: message,
        createdAt: now,
        // Not a content gap: the agent knew exactly what it was doing.
        unanswered: false,
      })
    }

    options.webhooks?.emit('conversation.answered', {
      conversationId: turn.conversationId,
      channel: turn.channel,
      question: turn.question,
      answer: message,
      sources: [],
      // So a reviewer can see why this turn looks the way it does.
      blocked: { action: decision.action, category: decision.matched?.category, reason: decision.matched?.reason },
    })

    yield { type: 'done' }
  }

  /** Streams the answer as frames. Use this wherever a person is waiting. */
  function stream(
    question: string | Message[],
    history: Message[] = [],
    call: StreamOptions = {},
  ): AsyncGenerator<StreamFrame> {
    return run(toMessages(question, history), call, call.onMatches ?? (() => {}))
  }

  /**
   * Waits for the whole answer. This is the shape a message queue, an email
   * worker or a webhook wants, none of which can stream to anybody.
   */
  async function answer(
    question: string | Message[],
    history: Message[] = [],
    call: StreamOptions = {},
  ): Promise<Answer> {
    let text = ''
    let error: string | undefined
    let sources: SourceRef[] = []
    let matches: Match[] = []
    const notices: string[] = []

    for await (const frame of run(toMessages(question, history), call, (found) => {
      matches = found
    })) {
      if (frame.type === 'delta') text += frame.text
      else if (frame.type === 'sources') sources = frame.sources
      else if (frame.type === 'error') error = frame.message
      else if (frame.type === 'notice') notices.push(frame.message)
    }

    return {
      text,
      sources: citedOnly(sources, text),
      matches,
      unanswered: matches.length === 0,
      error,
      notices,
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
 * The end of the last complete sentence.
 *
 * Checking a partial sentence is checking text the model has not finished
 * writing, which produces verdicts on things that were never said.
 */
function lastBoundary(text: string): number {
  for (let index = text.length - 1; index >= 0; index--) {
    const character = text[index] as string
    if (character !== '.' && character !== '!' && character !== '?') continue
    // A stop only ends a sentence if something follows it, or nothing does.
    const next = text[index + 1]
    if (next === undefined || /\s/.test(next)) return index + 1
  }
  return 0
}

/** Reasons come from parsers that may or may not punctuate. One stop, not two. */
function trimStop(reason: string): string {
  return reason.replace(/[.\s]+$/, '')
}

/**
 * Turns a provider's complaint into something worth showing a customer.
 *
 * A model that cannot see is a configuration mistake by the business, not
 * something the visitor did wrong, and they should not be reading a provider's
 * JSON to find that out.
 */
function explain(failure: string, hadAttachments: boolean): string {
  if (hadAttachments && /multimodal|image|vision|not support/i.test(failure)) {
    return 'I could not open the file you sent. Please describe the problem instead, or try again later.'
  }
  return failure
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

/** Short, sortable, collision-resistant enough for a conversation id. */
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** The shape `createAgent` returns, for anything that takes one. */
export type Agent = ReturnType<typeof createAgent>
