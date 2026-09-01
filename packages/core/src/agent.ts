import { stepCountIs, streamText, type LanguageModel } from 'ai'
import type { Embedder, KnowledgeIndex, Match, Message, SourceRef, StreamFrame } from './types.js'
import { actionsToTools } from './actions/define.js'
import type { Action, ActionContext, Contact } from './actions/types.js'
import type { Channel, Store, StoredMessage } from './store/types.js'
import { renderProcedures, unlockedBy, usableProcedures } from './procedures/index.js'
import type { Webhooks } from './webhooks/index.js'
import type { Procedure } from './procedures/types.js'
import { answerFilter, type Hooks } from './hooks.js'
import { embedderSpansLanguages, translateQuery } from './knowledge/translate-query.js'
import { parseIndex } from './knowledge/serialize.js'
import { createRetriever, type RetrieverOptions } from './retrieve/retriever.js'
import { createEmbedder } from './embed.js'
import { prepareAttachments, type PrepareOptions } from './attachments-prepare.js'
import { blocks, createClassifier } from './safety/classify.js'
import { INPUT_RULES, runRules } from './safety/rules.js'
import type { ClassifierPolicy, Decision, Signal } from './safety/types.js'
import type { Budget, Usage } from './budget.js'
import type { ShrinkOptions } from './actions/shrink.js'
import { describeFailure, logFailure } from './diagnostics.js'
import { isPaused, PAUSED_MESSAGE, type TakeoverOptions } from './takeover.js'
import {
  buildInstructions,
  contextualQuery,
  retrievalQuery,
  toSourceRefs,
  type ActionOutcome,
  type InstructionOptions,
  type PersonaOptions,
} from './server/prompt.js'

export interface AgentOptions {
  /** The index from `recourse ingest`. */
  index: KnowledgeIndex | string
  /** A Gateway model id, or any provider instance. */
  model?: LanguageModel
  persona?: PersonaOptions
  /**
   * How much the model is allowed to vary between identical questions.
   *
   * Left to the provider by default, which is what a support agent wants: a
   * little variety stops every refusal reading like the same recording.
   *
   * Set it to 0 to measure. A suite that samples a model at its default
   * temperature cannot tell a regression from a coin flip, and this library's
   * own classifier pins temperature for exactly that reason. An intermittent
   * failure recorded once shows as a pass or a fail at random, and comparing
   * two such runs invites a conclusion neither of them supports.
   */
  temperature?: number
  /**
   * A ceiling on how much the model may say in one answer.
   *
   * Left off by default, because a truncated sentence reads worse than a long
   * one and a chat panel can scroll. It earns its place on a voice call, where
   * the answer is read aloud and the caller cannot skim: a paragraph that would
   * be merely wordy on screen is thirty seconds of somebody waiting to speak.
   *
   * Use it with an instruction asking for brevity rather than instead of one.
   * The cap is the backstop for a model that ignores the prompt, not the plan.
   *
   * Reasoning counts against it. A thinking model spends this budget before it
   * says a word, so a cap sized for the answer alone truncates mid-sentence and
   * the caller hears half a clause. Measured on one: 106 of 120 tokens went on
   * reasoning, leaving fourteen, and the reply was "To pause your". Size it for
   * the thinking plus the answer, or turn the thinking off.
   */
  maxOutputTokens?: number
  /**
   * Search in the language the content is written in, whatever the customer used.
   *
   * Retrieval matches a question against the text of the documents, so a
   * question in another script matches nothing and a shop whose help pages
   * answer it perfectly returns empty. This translates the search key first.
   * Measured: an Arabic question about delivery found nothing against English
   * pages that answer it in full.
   *
   * Only the key is translated, so the answer still comes back in the
   * customer's language. Costs one small call, and only when the question is
   * in a different script; see `needsTranslation` for where that line is.
   */
  searchLanguage?: {
    language: string
    model: LanguageModel
    /**
     * Overrides what the index says about its own embedder.
     *
     * Set true for an in-house multilingual model this does not recognise, or
     * false to translate anyway. Left alone, the decision comes from the model
     * the index was built with.
     */
    multilingualEmbeddings?: boolean
  }
  /** Passages given to the model per question. */
  topK?: number
  /**
   * The thresholds retrieval decides relevance by.
   *
   * The defaults were measured against one corpus and one embedding model, and
   * both of those change. `vectorFloor` in particular is calibrated to a scale
   * that is model-specific: swap the embedder and measure your own separation
   * rather than inheriting ours.
   */
  retrieval?: Pick<RetrieverOptions, 'keywordFloor' | 'vectorFloor' | 'coverageFrom' | 'maxPerDocument'>
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
  /**
   * A cheaper model to fall back to when the first one will not answer.
   *
   * Only for failures another model could plausibly survive: a rate limit, an
   * exhausted quota, a provider outage, a context window that was too small.
   * A malformed request fails the same way twice and is not retried.
   *
   * Only ever tried when nothing has reached the customer yet and no action
   * has run, so a fallback can never double-charge a card or send a second
   * email. An answer half delivered stays half delivered.
   */
  fallbackModel?: LanguageModel
  /**
   * A ceiling on what this deployment spends, in tokens or dollars.
   *
   * The rate limiter caps one caller. This caps the bill, which is the thing a
   * public widget on somebody else's provider key actually risks.
   */
  budget?: Budget
  /**
   * How much of an action's result is shown to the model.
   *
   * Defaults are generous and still finite. An action returning a customer
   * list otherwise pays for all of it on every step of the turn, and stores
   * all of it in the transcript.
   */
  actionResults?: ShrinkOptions
  /**
   * How many identical calls to the same action before it is refused.
   *
   * Small models loop: an action that returns "not found" gets called with the
   * same arguments until the step limit stops it, and every one of those is a
   * real request to somebody's API. Two by default, so a single retry is still
   * allowed. Set 0 to turn it off.
   */
  repeatLimit?: number
  /**
   * Stops the agent answering in a conversation a person has taken over.
   *
   * Without this the agent keeps replying underneath the human who just picked
   * the ticket up, and the customer gets two voices contradicting each other.
   * The customer's messages are still recorded, so the person sees them; the
   * agent just says who has it and stops.
   *
   * Costs one conversation read per turn, so it is off unless asked for. Turn
   * it on wherever `escalate` can reach a person who will reply.
   */
  takeover?: boolean | TakeoverOptions
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
  /**
   * Extra `{{name}}` values for procedures, read fresh on every turn.
   *
   * A function rather than an object because the interesting ones change:
   * `{{agentAvailable}}` is false at three in the morning and true at ten, and
   * a value read once at startup would have a procedure offering live chat all
   * night.
   *
   *     procedureVariables: () => ({ agentAvailable: helpdesk.agentAvailable() })
   */
  procedureVariables?: () => Record<string, string | number | boolean | undefined>
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
  /**
   * Replaces the instructions the model is given.
   *
   * The built-in prompt is a good default and it is still a policy: how to
   * cite, how brief to be, what to say when nothing matched. A business with a
   * different house style should not have to fork the library to change it.
   *
   * Everything the default builds from is passed in, so a replacement can
   * compose rather than start over:
   *
   * ```ts
   * prompt: (context) => `${buildInstructions(context)}\n\nAlways sign off as Sam.`
   * ```
   */
  prompt?: (context: InstructionOptions) => string
  /**
   * Where this agent's extensions are registered.
   *
   * The counterpart to `prompt`: that shapes what the model is told, this
   * shapes what the customer reads and what gets searched for. Held as a value
   * rather than reached through a global, so one deployment's rules cannot run
   * on another's answers even in a process serving several.
   *
   * ```ts
   * import { createHooks, openerFilter } from '@recourse-ai/core'
   *
   * const hooks = createHooks()
   * hooks.filter('answer', openerFilter)
   *
   * createAgent({ index, hooks })
   * ```
   */
  hooks?: Hooks
}

export interface StreamOptions {
  signal?: AbortSignal
  /** Groups turns into one thread. Generated when absent. */
  conversationId?: string
  contact?: Contact
  channel?: Channel
  /**
   * Two-letter country, when the deployment asked for it and the visitor
   * agreed. Recorded on the conversation and never derived here: the server
   * layer reads what the edge already resolved, so no address reaches this far
   * and none is stored.
   */
  country?: string
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
 * How sure the rules must be that a retrieved passage is an attack.
 *
 * High, because a false positive removes a real help page from an answer and
 * nobody sees why.
 */
const DEFAULT_PASSAGE_THRESHOLD = 0.8

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

  const retriever = createRetriever({ index, embedder, topK: options.topK, ...options.retrieval })
  const classifier = options.classifier === false ? null : createClassifier(options.classifier ?? {})
  const passageThreshold =
    options.classifier === false ? 1 : (options.classifier?.passageThreshold ?? DEFAULT_PASSAGE_THRESHOLD)
  const actions = options.actions ?? []
  const maxSteps = options.maxSteps ?? 6
  const takeover = options.takeover === true ? {} : options.takeover === false ? null : (options.takeover ?? null)

  // Which procedures this agent can run at all. Which of their actions are
  // reachable is decided per turn, below: an action resolved once here is an
  // action bound on every turn, including the ones where nothing unlocked it.
  const { usable: procedures, dropped } = usableProcedures(options.procedures ?? [], actions)

  for (const { name, missing } of dropped) {
    console.warn(`[recourse] procedure "${name}" disabled: no action named ${missing.join(', ')}`)
  }

  /**
   * The question on its own first. Only a question that finds nothing gets the
   * previous turn folded in, so changing the subject does not drag the old
   * topic along with it.
   */
  async function search(messages: Message[], signal?: AbortSignal): Promise<Match[]> {
    const asked = await asIndexed(retrievalQuery(messages), signal)
    const matches = await retriever.retrieve(asked, { signal })
    if (matches.length > 0) return matches

    const withContext = contextualQuery(messages)
    if (!withContext) return []

    return retriever.retrieve(await asIndexed(withContext, signal), { signal })
  }

  /**
   * The search key, in the language the content is written in.
   *
   * Only the key. The question the model answers is untouched, so the reply
   * still comes back in the language the customer used.
   */
  async function asIndexed(query: string, signal?: AbortSignal): Promise<string> {
    if (!options.searchLanguage) return query

    // The better of the two routes, when it is available. An embedder that
    // places every language in one space already matches an Arabic question
    // to an English passage, so translating first would spend a call to
    // arrive where retrieval already is. Decided from what the index was
    // actually built with rather than asked of the caller, and overridable
    // for an in-house model this does not recognise.
    const spans = options.searchLanguage.multilingualEmbeddings ?? embedderSpansLanguages(index.vectors?.model)
    if (spans) return query

    return translateQuery(query, {
      indexLanguage: options.searchLanguage.language,
      model: options.searchLanguage.model,
      ...(signal ? { signal } : {}),
    })
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
    /**
     * Called when the turn ended before retrieval: a person has the
     * conversation, or a spending cap stopped it. Distinct from finding
     * nothing, which is a hole in the documentation. Only one of the two
     * belongs on the list of questions to go and answer.
     */
    onQuiet: () => void,
    // `answer()` collects the frames and hands back one string, so nothing has
    // reached anybody when a withhold fires partway. The streaming case has to
    // leave the sentences it already sent alone; this one does not, and
    // truncating there would deliver most of a bad answer with no explanation.
    buffered = false,
  ): AsyncGenerator<StreamFrame> {
    const signal = call.signal
    const conversationId = call.conversationId ?? options.conversationId ?? newId('c')

    // Merged rather than set, so a turn that arrives without one does not wipe
    // the country an earlier turn recorded.
    const placed = call.country ? { meta: { country: call.country } } : {}
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

    // Before retrieval, because a conversation a person owns should cost
    // nothing at all: no embedding, no model, no passages fetched for an
    // answer that is not going to be written.
    if (takeover && store && (await isPaused(store, conversationId, takeover.waitForPersonMs))) {
      onQuiet()
      yield* stayQuiet(takeover.message ?? PAUSED_MESSAGE, {
        conversationId,
        channel,
        contact,
        question,
        attachments: messages[messages.length - 1]?.attachments ?? [],
      })
      return
    }

    // The cap is read before the model rather than after it, because the turn
    // that crosses the line is precisely the one nobody wanted to pay for.
    const allowance = options.budget ? await options.budget.check() : { ok: true as const }
    if (!allowance.ok) {
      console.warn(`[recourse] budget reached, not calling the model: ${allowance.reason ?? 'capped'}`)
      onQuiet()
      yield* stayQuiet(allowance.message ?? 'I cannot answer right now. Leave your question and a person will reply.', {
        conversationId,
        channel,
        contact,
        question,
        attachments: messages[messages.length - 1]?.attachments ?? [],
      })
      return
    }

    const found = await search(messages, signal)

    // Screen the passages themselves, not only the question.
    //
    // A knowledge base is treated as trusted, which is exactly why it is worth
    // attacking: text planted in a page arrives with the business's own
    // authority and never passes through the input screen at all. Anything in
    // a retrieved passage that reads as an instruction to the agent is not
    // content, whatever page it came from.
    const matches = classifier ? withoutPoisoned(found, passageThreshold) : found
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
      await store.appendMessage(conversationId, record, { channel, contact, ...placed })
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

    const instructionContext: InstructionOptions = {
      persona: options.persona,
      matches,
      actions,
      procedures: renderProcedures(procedures, {
        contact,
        ...(options.procedureVariables ? { extra: options.procedureVariables() } : {}),
      }),
      clientResults: call.clientResults,
      ...(prepared?.context ? { attachments: prepared.context } : {}),
      ...(prepared?.failures.length ? { unreadable: prepared.failures } : {}),
    }

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
    // One per turn. A filter holding half a phrase from the last answer would
    // put it in front of the next one.
    const outgoing = answerFilter(options.hooks, {
      ...(conversationId ? { conversationId } : {}),
      question,
    })

    // Gating the stream is opt-in, because it costs sentence-at-a-time delivery
    // instead of word-by-word. Looking at the finished answer costs nothing and
    // is how a business finds out its agent invented a price, so that happens
    // whenever a classifier exists.
    const checksOutput = classifier?.checksOutput === true
    // Releasing a sentence at a time only pays off for a reader watching it
    // arrive. `answer()` collects every frame and returns one string, so there
    // nothing is on screen to keep warm, and holding the answer back until it
    // has been screened whole is both cheaper and the only way a withhold can
    // replace it rather than truncate it.
    const buffering = classifier?.buffers === true || buffered

    // What the answer is allowed to have got its facts from: the passages it
    // was given, and what the customer already told us. A number outside both
    // came from somewhere the agent cannot cite.
    // Kept from the screening passes so the transcript records them too.
    let noticed: Signal[] = []

    const outputContext = {
      conversationId,
      sources: matches.map((match) => match.chunk.text),
      // The customer's own words only. The agent's previous turns are in here
      // too now that channels carry history, and counting those as grounding
      // means a price it invented an hour ago is evidence for repeating it:
      // the check would go quiet exactly where a hallucination has had time to
      // settle in.
      asked: messages.filter((message) => message.role === 'user').map((message) => message.content),
    }

    // The configured model, then the cheaper one if the first will not answer
    // at all. A second entry is only ever reached from a clean failure, so the
    // usual path builds a one-element array and never looks at it again.
    const attempts: LanguageModel[] = options.fallbackModel ? [model, options.fallbackModel] : [model]
    /** Which model produced the answer, so the budget bills the right one. */
    let spoke: LanguageModel = model
    let spent: Usage = {}

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      spoke = attempts[attempt] as LanguageModel

      // Each attempt starts from nothing. Only reached when the one before it
      // delivered nothing at all, so there is no partial answer to preserve.
      failure = null
      answered = ''
      released = 0
      checkedTo = 0
      withheld = null
      noticed = []
      ran.length = 0
      pending.length = 0

      /** Whether the customer has seen anything at all from this attempt. */
      let delivered = false

      const result = streamText({
        model: spoke,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
        instructions: (options.prompt ?? buildInstructions)(instructionContext),
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
        tools: actionsToTools(actions, {
          context,
          // Decided from the whole conversation, so an action stays available
          // for a flow that is halfway through and is absent from a turn that
          // never mentioned the thing it belongs to. `procedureOnly` promises
          // an action fires "only as a step inside a procedure"; resolving this
          // once at construction meant a refund tool was bound and callable on
          // every turn, merely undocumented in the prompt.
          unlocked: unlockedBy(
            procedures,
            messages.map((message) => message.content).join('\n'),
          ),
          ...(options.actionResults ? { results: options.actionResults } : {}),
          ...(options.repeatLimit === undefined ? {} : { repeatLimit: options.repeatLimit }),
        }),
        // Without this the turn ends the moment a tool is called, and the
        // customer gets an action but no answer explaining what happened.
        stopWhen: stepCountIs(maxSteps),
        onError: ({ error }) => {
          failure = error instanceof Error ? error.message : String(error)
        },
      })

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          answered += part.text

          if (!checksOutput) {
            released = answered.length
            delivered = true
            yield { type: 'delta', text: outgoing ? outgoing.push(part.text) : part.text }
          } else if (!buffering) {
            // Checked on sentence boundaries, and released only as far as it has
            // been checked. Sending the unchecked tail and inspecting it later
            // would mean the customer reads the leak before we notice it, which
            // is the entire failure this mode exists to prevent. The cost is
            // that the answer arrives a sentence at a time rather than a word.
            const boundary = lastBoundary(answered)
            if (boundary > checkedTo) {
              const verdict = await classifier.checkOutput(answered.slice(0, boundary), outputContext)
              noticed = verdict.signals
              if (blocks(verdict)) {
                withheld = verdict
                break
              }
              checkedTo = boundary
            }
            if (checkedTo > released) {
              delivered = true
              const piece = answered.slice(released, checkedTo)
              yield { type: 'delta', text: outgoing ? outgoing.push(piece) : piece }
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
          delivered = true
          yield {
            type: 'client-action',
            id: part.toolCallId,
            name: part.toolName,
            input: (part.input ?? {}) as Record<string, unknown>,
            ...(definition?.clientPayload ? { payload: definition.clientPayload } : {}),
          }
        }

        while (pending.length > 0) {
          delivered = true
          yield pending.shift() as StreamFrame
        }
      }

      while (pending.length > 0) {
        delivered = true
        yield pending.shift() as StreamFrame
      }

      // Billed per attempt, not once at the end. An attempt that failed on
      // the way back still burned its input tokens, and pricing both attempts
      // as the model that happened to answer would bill one of them wrong.
      spent = await consumed(result)
      if (options.budget && (spent.inputTokens || spent.outputTokens)) {
        await options.budget.record(nameOf(spoke), spent)
      }

      if (!failure) break

      // Falling back is only safe while the turn is still invisible. Once a
      // sentence has been read or an action has run, a second attempt would
      // either repeat itself on screen or charge the same card twice, and a
      // failed answer is a better outcome than either.
      const another = attempt + 1 < attempts.length
      const diagnosis = describeFailure(failure, prepared !== null)
      if (!another || delivered || ran.length > 0 || !diagnosis.fallbackWorthTrying) break

      console.warn(`[recourse] first model failed (${diagnosis.reason}); trying the fallback model.`)
    }

    if (checksOutput && !withheld && answered.length > released) {
      // The tail after the last sentence boundary, and the whole answer when
      // buffering. Either way this is the last chance to look at it.
      const verdict = await classifier.checkOutput(answered, outputContext)
      noticed = verdict.signals
      if (blocks(verdict)) withheld = verdict
      else {
        yield { type: 'delta', text: answered.slice(released) + (outgoing?.flush() ?? '') }
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
        `[recourse] answer withheld: ${withheld.matched?.reason ?? withheld.action}`,
      )
    }

    // Whatever the screening noticed reaches the transcript either way. When
    // gating is off the answer is looked at here instead, once it is finished:
    // blocking actions are ignored at that point, because the customer has
    // already read it and pretending otherwise would be a lie. What is left is
    // the record, and a category set to `flag` rather than `refuse` produces
    // nothing else, so losing it would leave the business nothing to read.
    let flagged: Signal[] = noticed
    if (classifier && !checksOutput && answered.trim()) {
      const verdict = await classifier.checkOutput(answered, outputContext)
      flagged = verdict.signals
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
      // Kept so "which answers invented a number" is a query rather than an
      // afternoon of reading transcripts.
      if (flagged.length > 0) {
        record.flags = flagged.map(({ category, score, reason }) => ({ category, score, reason }))
      }
      await store.appendMessage(conversationId, record, { channel, contact, ...placed })
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

    if (failure) {
      // The provider's own words go to the process log and stop there. What
      // reaches the customer, and what goes in the transcript, is a sentence
      // and a reference that ties the two together.
      const diagnosis = describeFailure(failure, prepared !== null)
      logFailure(diagnosis, failure, { conversation: conversationId, model: nameOf(spoke) })
      yield { type: 'error', message: `${diagnosis.message} (reference ${diagnosis.reference})` }
    } else yield { type: 'done' }
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

  /**
   * A turn the agent deliberately does not answer.
   *
   * A person has taken the conversation, or a spending cap has been reached.
   * Neither is the customer's fault and neither is a refusal, so this is not
   * `refuse`: nothing is blocked, no safety verdict is recorded, and the turn
   * is not counted as a documentation gap.
   *
   * What it must still do is store what the customer said. That message is the
   * entire reason the pause is survivable: the person who took the ticket over
   * reads it, and the customer does not have to type it twice.
   */
  async function* stayQuiet(
    message: string,
    turn: {
      conversationId: string
      channel: Channel
      contact?: Contact
      question: string
      attachments: Message['attachments']
    },
  ): AsyncGenerator<StreamFrame> {
    yield { type: 'sources', sources: [] }
    yield { type: 'delta', text: message }

    if (options.store) {
      const now = new Date().toISOString()
      const asked: StoredMessage = { id: newId('m'), role: 'user', content: turn.question, createdAt: now }
      if (turn.attachments?.length) {
        asked.attachments = turn.attachments.map(({ name, mimeType, bytes }) => ({ name, mimeType, bytes }))
      }

      await options.store.appendMessage(turn.conversationId, asked, {
        channel: turn.channel,
        contact: turn.contact,
      })
      await options.store.appendMessage(turn.conversationId, {
        id: newId('m'),
        role: 'assistant',
        content: message,
        createdAt: now,
        // Retrieval never ran, so calling this a content gap would put a
        // question nobody tried to answer at the top of the list to fix.
        unanswered: false,
      })
    }

    yield { type: 'done' }
  }

  /** Streams the answer as frames. Use this wherever a person is waiting. */
  function stream(
    question: string | Message[],
    history: Message[] = [],
    call: StreamOptions = {},
  ): AsyncGenerator<StreamFrame> {
    return run(
      toMessages(question, history),
      call,
      call.onMatches ?? (() => {}),
      () => {},
    )
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
    let searched = true
    const notices: string[] = []

    for await (const frame of run(
      toMessages(question, history),
      call,
      (found) => {
        matches = found
      },
      () => {
        searched = false
      },
      true,
    )) {
      if (frame.type === 'delta') text += frame.text
      else if (frame.type === 'sources') sources = frame.sources
      else if (frame.type === 'error') error = frame.message
      else if (frame.type === 'notice') notices.push(frame.message)
    }

    return {
      text,
      sources: citedOnly(sources, text),
      matches,
      // A turn nobody tried to answer is not a documentation gap. Retrieval
      // never ran, so there is no missing page for this question to name.
      unanswered: searched && matches.length === 0,
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
    /**
     * The store it was built with, if any.
     *
     * Exposed for the channels, which need to know whether a conversation has
     * been spoken to before. Article 50 asks for a disclosure at the first
     * interaction and not at the eleventh, and "first" is a fact only the
     * transcript holds.
     */
    store: options.store,
  }
}

/**
 * The end of the last complete sentence.
 *
 * Checking a partial sentence is checking text the model has not finished
 * writing, which produces verdicts on things that were never said.
 */
/**
 * Stops in the scripts this agent is told to reply in, plus the ideographic
 * and Arabic ones that carry no trailing space. Latin stops need a space or
 * the end of the text after them, or every decimal point and "e.g." would end
 * a sentence; the others are unambiguous on their own.
 */
const STOPS = '.!?'
const STOPS_ALONE = '。！？؟۔।॥…'

function lastBoundary(text: string): number {
  for (let index = text.length - 1; index >= 0; index--) {
    const character = text[index] as string

    if (STOPS_ALONE.includes(character)) return index + 1

    // A line that has ended is a complete thought too, and it is the only
    // boundary a list, a table or a fenced code block ever offers. Without it
    // an answer made of bullets is screened as one block at the very end,
    // which turns streaming off for that answer and says nothing.
    if (character === '\n') return index + 1

    if (!STOPS.includes(character)) continue
    // A stop only ends a sentence if something follows it, or nothing does.
    const next = text[index + 1]
    if (next === undefined || /\s/.test(next)) return index + 1
  }
  return 0
}

/**
 * Drops retrieved passages that carry instructions rather than information.
 *
 * The bar is high by default because a false positive here silently removes a
 * real help page from the answer, which is its own kind of failure. What
 * clears it is unambiguous: text telling the reader to ignore its
 * instructions, adopt a new role, or emit a marker.
 */
function withoutPoisoned(matches: Match[], threshold: number): Match[] {
  const kept: Match[] = []

  for (const match of matches) {
    const { signals } = runRules(match.chunk.text, INPUT_RULES)
    const worst = signals
      .filter((signal) => signal.category === 'injection')
      .reduce((highest, signal) => Math.max(highest, signal.score), 0)

    if (worst >= threshold) {
      // Loud on purpose. A poisoned knowledge base is something the business
      // has to go and fix; quietly dropping the page hides an intrusion.
      console.warn(
        `[recourse] ignoring a retrieved passage from "${match.chunk.title}": ` +
          `${signals.find((signal) => signal.score === worst)?.reason}. ` +
          'Check this page for text aimed at the agent rather than the reader.',
      )
      continue
    }

    kept.push(match)
  }

  return kept
}

/** Reasons come from parsers that may or may not punctuate. One stop, not two. */
function trimStop(reason: string): string {
  return reason.replace(/[.\s]+$/, '')
}

/**
 * What the turn actually cost, or nothing when the provider did not say.
 *
 * Read after the stream rather than from a `finish` part, because a stream
 * that failed has no finish part and the totals are still worth having: a
 * turn can burn its input tokens and then die on the way back.
 */
async function consumed(result: { totalUsage: PromiseLike<Usage> }): Promise<Usage> {
  try {
    const usage = await result.totalUsage
    return { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }
  } catch {
    // Unmetered is better than a turn that throws while tidying up.
    return {}
  }
}

/**
 * The id a model prices under.
 *
 * A gateway string is already `provider/model` and passes through. An SDK
 * instance is not: it reports a bare `qwen3:4b`, which says nothing about who
 * served it, and a price list cannot tell a local model apart from a hosted
 * one on that alone. The provider is put back on the front so both halves of
 * the id space have the same shape, and so `ollama/*` means something.
 *
 * The SDK suffixes providers by surface (`ollama.chat`); the surface is not
 * part of anyone's pricing, so it goes.
 */
function nameOf(model: LanguageModel): string {
  if (typeof model === 'string') return model

  const id = (model as { modelId?: unknown }).modelId
  if (typeof id !== 'string') return 'unknown'
  if (id.includes('/')) return id

  const provider = (model as { provider?: unknown }).provider
  if (typeof provider !== 'string' || !provider) return id

  return `${provider.split('.')[0]}/${id}`
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
