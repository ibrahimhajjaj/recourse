import { stepCountIs, streamText, type LanguageModel } from 'ai'
import type { Embedder, KnowledgeIndex, Match, Message, SourceRef, StreamFrame } from './types.js'
import { actionsToTools } from './actions/define.js'
import type { Action, ActionContext, Contact } from './actions/types.js'
import type { Channel, Store, StoredMessage } from './store/types.js'
import { renderProcedures, usableProcedures } from './procedures/index.js'
import { asMatch, correctionFor, type CorrectionStore } from './corrections.js'
import type { Webhooks } from './webhooks/index.js'
import type { Procedure } from './procedures/types.js'
import { answerFilter, type Hooks } from './hooks.js'
import { embedderSpansLanguages, translateQuery } from './knowledge/translate-query.js'
import { parseIndex } from './knowledge/serialize.js'
import { createRetriever, type RetrieverOptions } from './retrieve/retriever.js'
import { createEmbedder } from './embed.js'
import { prepareAttachments, type PrepareOptions } from './attachments-prepare.js'
import { blocks, createClassifier } from './safety/classify.js'
import { screenInput } from './turn/screen.js'
import { resolveContext } from './turn/context.js'
import { recordTurn } from './turn/record.js'
import { newId } from './util/ids.js'
import { lastBoundary, trimStop } from './turn/text.js'
import { consumed, nameOf } from './turn/usage.js'
import { refuse, stayQuiet } from './turn/decline.js'
import type { ClassifierPolicy, Decision, Signal } from './safety/types.js'
import type { Budget, Usage } from './budget.js'
import type { ShrinkOptions } from './actions/shrink.js'
import { describeFailure, logFailure, getLogger, type Logger } from './diagnostics.js'
import {
  PAUSED_MESSAGE,
  UNANSWERED_MESSAGE,
  WAITING_MESSAGE,
  hasPerson,
  isEndCommand,
  isPaused,
  resumeAgent,
  waitedTooLong,
  type TakeoverOptions,
} from './takeover.js'
import {
  buildInstructions,
  contextualQuery,
  languageOf,
  passageText,
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
   * Answers the support team has written to override the documentation.
   *
   * The loop this closes: the agent says something wrong, and the person who
   * knows it is wrong cannot change a knowledge base built at deploy time. With
   * this they write the right answer and it applies to the next message, with
   * no rebuild and nobody deploying anything.
   *
   * A correction beats retrieval where it matches, so the match is strict.
   */
  corrections?: CorrectionStore
  /**
   * Whether to stream what a thinking model is thinking.
   *
   * Off, and this default is load-bearing. Reasoning is where a model works
   * through its own instructions out loud, so it routinely restates them: the
   * refusal it is weighing, the rule it is applying, the thing it was told not
   * to say. Sent to a member of the public that is the system prompt leaking a
   * sentence at a time, and a map of which rule to push against.
   *
   * Turn it on where the reader is trusted and the thinking is the point: an
   * internal help desk, an agent console, a debugging view. Not on a widget
   * facing the open web.
   *
   * Reasoning never becomes the answer. It is not stored, not screened as
   * output, and no answer filter sees it.
   */
  reasoning?: boolean
  /**
   * Offer follow-up questions after every reply, rather than when the model
   * remembers to ask for them.
   *
   * `suggestedMessages` is an action, so it fires on the model's judgment, and
   * a smaller model's judgment about a housekeeping tool is poor: it answers
   * well and forgets the follow-ups on most turns. This asks separately, after
   * the answer, so they appear every time.
   *
   * It costs a second model call on every reply. That is the trade, and it is
   * why this is off unless you set it: it is a real per-message cost for
   * something the customer may never click.
   *
   * Skipped when the model already offered some itself, when the reply is
   * empty, and when the conversation has been handed to a person, who does not
   * need a widget proposing what to say to them.
   */
  followUps?: boolean | { max?: number }
  /**
   * Sends what each action was called with, and what it returned, to the page.
   *
   * The `action` frame otherwise carries a name and a status, which is all a
   * spinner needs. Turn this on where the page has to react to what actually
   * happened: refresh a basket the agent changed, record a ticket id, show a
   * booking. It puts the action's result into JavaScript on the page, so it is
   * off unless you ask.
   */
  actionDetail?: boolean
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
  /**
   * Where this agent's own warnings and failures go.
   *
   * Defaults to the process log. Pass one to send them to whatever the rest of
   * the deployment already uses, or to drop them: a library that can only shout
   * at stdout is a library nobody can run inside anything else.
   */
  logger?: Logger
}

export interface StreamOptions {
  signal?: AbortSignal
  /** Groups turns into one thread. Generated when absent. */
  conversationId?: string
  contact?: Contact
  /** Verified facts for actions only. Never reaches the prompt. */
  private?: Record<string, unknown>
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
   * Answer the same question again, because the last answer was no good.
   *
   * The caller drops the answer it did not want and sends the history ending
   * at the question, which is how the model gets a clean second attempt rather
   * than being asked to improve on its own reply.
   *
   * All this changes here is the transcript: the question is not written down
   * a second time, since it was asked once. The answer that was rejected stays
   * in the record. It is the most useful thing in it, being a documented case
   * of this agent answering badly, and deleting it would leave a gap list with
   * nothing to learn from.
   */
  retry?: boolean
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
 * Whether the default model can actually be reached.
 *
 * The default is a bare model name, which the SDK resolves through Vercel's AI
 * Gateway. With a credential that is a good default and needs no wiring. With
 * none, the call fails on authentication and the customer gets an empty string
 * and a stack of instructions about Vercel access tokens.
 *
 * That mattered more than it looks: `createAgent({ index })` is the first thing
 * anybody writes, the README promises it works with no account and no key, and
 * what it did was fail in the least explicable way available.
 *
 * Read defensively. There is no `process` on a Worker, and a missing key there
 * is the normal case rather than an error.
 */
function gatewayReachable(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env

    return Boolean(env?.AI_GATEWAY_API_KEY || env?.VERCEL_OIDC_TOKEN)
  } catch {
    return false
  }
}

/**
 * The turn when there is no model and no way to reach the default one.
 *
 * Not an error, and not silence. Retrieval already found the answer; what is
 * missing is something to write it in a sentence. So the passages go back with
 * a line saying why, which is what the CLI does and what the README promises,
 * and the deployment can be tried before anybody signs up for anything.
 */
const NO_MODEL =
  'I found this in the help pages but cannot write it up: no model is configured. ' +
  'Pass `model` to createAgent, or set AI_GATEWAY_API_KEY.'

/** The passages, numbered the way the prompt would have numbered them. */
function passagesFor(matches: Match[]): string {
  const cited = matches.map(
    (match, position) => `[${position + 1}] ${match.chunk.title}\n${match.chunk.text}`,
  )

  return [NO_MODEL, ...cited].join('\n\n')
}

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
  const log = options.logger ?? getLogger()

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
  // Off unless asked for. See `reasoning` on the options for why that is not a
  // matter of taste.
  const showsReasoning = options.reasoning === true
  const followUps = options.followUps === true ? {} : options.followUps === false ? null : (options.followUps ?? null)
  const takeover = options.takeover === true ? {} : options.takeover === false ? null : (options.takeover ?? null)

  // Refused at construction rather than at the turn that needs it. The tool set
  // is keyed on the name, so two actions sharing one means the second replaces
  // the first: the agent is handed a tool that behaves like the wrong one, and
  // nothing anywhere says so. Two of the same kind is a real configuration,
  // escalations on the website and on Instagram being the obvious one, and the
  // fix is to name them, not to let one disappear.
  const named = new Set<string>()
  for (const action of actions) {
    if (named.has(action.name)) {
      throw new Error(
        `two actions are both called "${action.name}". Give one of them a different name, ` +
          'or the tool set keeps only the last.',
      )
    }
    named.add(action.name)
  }

  // Which procedures this agent can run at all. Which of their actions are
  // reachable is decided per turn, below: an action resolved once here is an
  // action bound on every turn, including the ones where nothing unlocked it.
  const { usable: procedures, dropped } = usableProcedures(options.procedures ?? [], actions)

  for (const { name, missing } of dropped) {
    log.warn(`procedure "${name}" disabled: no action named ${missing.join(', ')}`)
  }

  /**
   * The question on its own first. Only a question that finds nothing gets the
   * previous turn folded in, so changing the subject does not drag the old
   * topic along with it.
   */
  /**
   * The team's own answer to this question, if they have written one.
   *
   * Never allowed to cost a turn. A correction store that is unreachable means
   * the customer gets the documentation's answer, which is what they would have
   * got anyway; throwing here would mean they get nothing at all.
   */
  async function correctionMatch(question: string): Promise<Match | undefined> {
    if (!options.corrections) return undefined

    try {
      const found = correctionFor(question, await options.corrections.list())

      return found ? asMatch(found) : undefined
    } catch (error) {
      log.error('could not read the corrections:', error)

      return undefined
    }
  }

  async function search(messages: Message[], signal?: AbortSignal): Promise<Match[]> {
    const question = retrievalQuery(messages)

    // Before retrieval, not after. Somebody on the support team wrote this
    // about this exact question going wrong, and the whole reason it exists is
    // that the documentation got it wrong. Ranking it against the pages it was
    // written to override would sometimes lose.
    const corrected = await correctionMatch(question)

    const asked = await asIndexed(question, signal)
    const matches = await retriever.retrieve(asked, { signal })
    if (corrected) return [corrected, ...matches]
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

    const store = options.store

    const screened = await screenInput(messages, classifier, conversationId)
    messages = screened.messages
    const question = screened.question

    if (screened.decision && blocks(screened.decision)) {
      yield* refuse(screened.decision, { conversationId, channel, contact, question }, { store, webhooks: options.webhooks })
      return
    }

    // Before retrieval, because a conversation a person owns should cost
    // nothing at all: no embedding, no model, no passages fetched for an
    // answer that is not going to be written.
    if (takeover && store && (await isPaused(store, conversationId, takeover.waitForPersonMs))) {
      // Waiting for a person is not the same as having one, and telling the
      // customer the wrong one is how they sit there longer than they would
      // have. Asked for, not arrived, gets its own sentence.
      const arrived = await hasPerson(store, conversationId)

      // The customer giving up. Their only alternative is closing the tab, and
      // a conversation that ends that way is one nobody can follow up.
      if (isEndCommand(question)) {
        await resumeAgent(store, conversationId, 'customer-ended').catch(() => {})
      } else {
        onQuiet()
        yield* stayQuiet(
          arrived ? (takeover.message ?? PAUSED_MESSAGE) : (takeover.waitingMessage ?? WAITING_MESSAGE),
          {
            conversationId,
            channel,
            contact,
            question,
            attachments: messages[messages.length - 1]?.attachments ?? [],
          },
          { store, webhooks: options.webhooks },
        )

        return
      }
    }

    // Said before the answer when the wait ran out, so the customer hears why
    // the agent is suddenly talking again rather than a person.
    let unanswered = ''

    // The wait ran out and nobody came. `isPaused` above has already stopped
    // holding the turn back, so without this the agent simply starts talking
    // again: the customer is never told the person they were promised is not
    // coming, the paused flag stays set in the store forever, and the reason
    // the handover ended cannot be counted afterwards. Anything reading the
    // raw flag rather than re-deriving it against the clock, burst coalescing
    // among them, still believes a person owns this conversation and drops
    // what the customer says next.
    if (takeover && store && (await waitedTooLong(store, conversationId, takeover.waitForPersonMs))) {
      await resumeAgent(store, conversationId, 'nobody-came').catch(() => {})
      unanswered = takeover.unansweredMessage ?? UNANSWERED_MESSAGE
    }

    // The cap is read before the model rather than after it, because the turn
    // that crosses the line is precisely the one nobody wanted to pay for.
    const allowance = options.budget ? await options.budget.check() : { ok: true as const }
    if (!allowance.ok) {
      log.warn(`budget reached, not calling the model: ${allowance.reason ?? 'capped'}`)
      onQuiet()
      yield* stayQuiet(
        allowance.message ?? 'I cannot answer right now. Leave your question and a person will reply.',
        { conversationId, channel, contact, question, attachments: messages[messages.length - 1]?.attachments ?? [] },
        { store, webhooks: options.webhooks },
      )
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
    const { matches, applicable, unlocked, offered } = resolveContext({
      messages,
      found,
      procedures,
      actions,
      passageThreshold: classifier ? passageThreshold : null,
      channel,
      // `buffered` is the non-streaming caller, which has no way to hand a
      // client action to a browser and collect the answer.
      clientActions: !buffered,
      logger: log,
    })
    onMatches(matches)

    // Only the newest message's files. Older ones were already read into an
    // earlier answer, and re-sending an image every turn is billed every turn.
    const attachments = messages[messages.length - 1]?.attachments ?? []
    const prepared = attachments.length > 0 ? await prepareAttachments(attachments, options.attachments) : null

    // Two ways a turn arrives with its question already written down: the
    // second half of one the browser interrupted, and a second attempt at one
    // the customer did not like the answer to. Neither is a new question.
    const alreadyAsked = (call.clientResults?.length ?? 0) > 0 || call.retry === true

    if (store && !alreadyAsked) {
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
    /** Set when an action put a person on the conversation partway through. */
    let handedOver = false
    /** Kept so the transcript records what the agent actually did, not just said. */
    const ran: Array<{ name: string; input: unknown; output: unknown }> = []

    const context: ActionContext = {
      conversationId,
      contact,
      // Stops here on purpose. Nothing below builds a prompt from this.
      ...(call.private ? { private: call.private } : {}),
      signal,
      store: options.store,
      webhooks: options.webhooks,
      emit: (frame) => {
        if (frame.type === 'handoff') handedOver = true
        pending.push(frame)
      },
    }

    // streamText reports provider failures to onError and ends the stream
    // cleanly, so without capturing this a dead provider looks like silence.
    let failure: string | null = null

    /** The language the last customer message is written in, when readable. */
    const wroteIn = languageOf(retrievalQuery(messages))

    const instructionContext: InstructionOptions = {
      persona: options.persona,
      matches,
      // The record the answer is written against. Actions have always had it;
      // the prompt has not, so every answer was written for a stranger.
      ...(contact ? { contact } : {}),
      actions: offered,
      procedures: renderProcedures(applicable, {
        contact,
        ...(options.procedureVariables ? { extra: options.procedureVariables() } : {}),
      }),
      clientResults: call.clientResults,
      channel,
      // Only ever read to pick from a fallback map, so a wrong guess costs the
      // wrong one of two sentences the deployment wrote itself, never a
      // generated sentence and never a wrong answer.
      ...(wroteIn ? { language: wroteIn } : {}),
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

    // On unless a deployment turns it off, and it costs sentence-at-a-time
    // delivery instead of word-by-word. That is the right default: this is how
    // a business finds out its agent invented a price, and a price already on
    // the customer's screen cannot be taken back.
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
      // The whole passage, headings included, because that is what the model
      // was shown. Grounding on the body alone reports a phone number that
      // appears in a section heading as invented, and the PHP port grounds on
      // the rendered passage, so the two would disagree on the same answer.
      sources: matches.map((match) => passageText(match)),
      // The customer's own words only. The agent's previous turns are in here
      // too now that channels carry history, and counting those as grounding
      // means a price it invented an hour ago is evidence for repeating it:
      // the check would go quiet exactly where a hallucination has had time to
      // settle in.
      asked: messages.filter((message) => message.role === 'user').map((message) => message.content),
    }

    // Nothing to call, so nothing is called: one doomed request per turn, each
    // ending in an empty answer, is the worst of both.
    //
    // Answered rather than returned early, so the rest of the turn happens the
    // way it always does. An early return skipped the transcript write and the
    // webhook, and emitted a second `done` on top of the one below.
    // Its own sentence ahead of the answer rather than welded onto the front of
    // it. The customer was told a colleague was coming; being answered by the
    // agent instead needs saying, or it reads as the promise being ignored.
    if (unanswered) {
      yield { type: 'delta', text: `${unanswered}\n\n` }
    }

    const withoutModel = !options.model && !gatewayReachable()

    if (withoutModel) {
      answered = passagesFor(matches)
      yield { type: 'delta', text: answered }
    }

    // The configured model, then the cheaper one if the first will not answer
    // at all. A second entry is only ever reached from a clean failure, so the
    // usual path builds a one-element array and never looks at it again. Empty
    // when there is nothing to call, which skips the loop entirely.
    const attempts: LanguageModel[] = withoutModel
      ? []
      : options.fallbackModel
        ? [model, options.fallbackModel]
        : [model]
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
        // Already filtered, but the tool builder is public and filters for
        // itself, so it is handed the same decision. Without it every
        // procedure-only action is dropped on the second pass, and the model is
        // told to call something it was never given. The conversation is not
        // passed again: relevantWhen has been applied and would only be redone.
        tools: actionsToTools(offered, {
          context,
          unlocked,
          channel,
          clientActions: !buffered,
          ...(options.actionDetail ? { actionDetail: true } : {}),
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

      for await (const part of result.stream) {
        // Sent on its own channel and nowhere else: not added to the answer,
        // not screened as output, not stored. A model thinking out loud is
        // talking about its instructions, and the answer is what it decided.
        if (part.type === 'reasoning-delta') {
          if (showsReasoning && part.text) yield { type: 'reasoning', text: part.text }
          continue
        }

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

      log.warn(`first model failed (${diagnosis.reason}); trying the fallback model.`)
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

      log.warn(`answer withheld: ${withheld.matched?.reason ?? withheld.action}`)
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

    await recordTurn({
      store,
      webhooks: options.webhooks,
      conversationId,
      channel,
      contact,
      placed,
      question,
      answer: answered,
      matches,
      ran,
      flags: flagged,
    })

    if (failure) {
      // The provider's own words go to the process log and stop there. What
      // reaches the customer, and what goes in the transcript, is a sentence
      // and a reference that ties the two together.
      const diagnosis = describeFailure(failure, prepared !== null)
      logFailure(diagnosis, failure, { conversation: conversationId, model: nameOf(spoke) })
      yield { type: 'error', message: `${diagnosis.message} (reference ${diagnosis.reference})` }
      return
    }

    // After the answer, never before: the customer reads the reply while this
    // runs, and a turn that waited on it would be slower for the sake of
    // something they may never click.
    // Checked again, not just at the top of the turn. The cap was read before
    // the answer and the answer has since been paid for, so a deployment that
    // crossed the line during it would otherwise buy a row of buttons on the
    // wrong side of its own limit, on every reply.
    const affordable = !options.budget || (await options.budget.check()).ok

    if (
      followUps &&
      affordable &&
      answered.trim() &&
      !handedOver &&
      !ran.some((call) => call.name === 'suggest_replies')
    ) {
      const proposed = await proposeFollowUps(spoke, question, answered, followUps.max ?? 3, signal)
      if (proposed.items.length > 0) yield { type: 'suggestions', items: proposed.items }
      // Billed like any other call, because it is one, on every reply. A cap
      // that did not see this would be off by a call per message.
      if (options.budget && (proposed.usage.inputTokens || proposed.usage.outputTokens)) {
        await options.budget.record(nameOf(spoke), proposed.usage)
      }
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

/** The shape `createAgent` returns, for anything that takes one. */
export type Agent = ReturnType<typeof createAgent>

/**
 * The types `AgentOptions` is made of, from the same entry point as the agent.
 *
 * Somebody importing `createAgent` from here and typing the index they pass it
 * has no reason to guess that the type lives somewhere else. The worker example
 * imported `KnowledgeIndex` from this entry and had been wrong since it was
 * written, which nothing noticed because no example was ever typechecked.
 */
export type { Embedder, KnowledgeIndex, Match, Message, SourceRef, StreamFrame }

/**
 * Follow-up questions to offer under an answer.
 *
 * Its own call rather than part of the turn, because the alternative is asking
 * the model to answer and to think about what comes next in one breath, and
 * what suffers is the answer. Cheap: two short strings in, one line out.
 *
 * Anything that goes wrong here returns nothing. A missing row of buttons is
 * not worth failing a reply the customer already has.
 */
async function proposeFollowUps(
  model: LanguageModel,
  question: string,
  answer: string,
  max: number,
  signal?: AbortSignal,
): Promise<{ items: string[]; usage: Usage }> {
  try {
    const { generateText } = await import('ai')
    const { text, usage } = await generateText({
      model,
      temperature: 0.3,
      maxOutputTokens: 120,
      instructions:
        `You are proposing what a customer might ask next. Reply with at most ${max} short questions, ` +
        'separated by a pipe character, and nothing else. Write them in the customer\'s own voice and in ' +
        'the language they used, as questions they would ask, never as instructions to them. ' +
        'Each under sixty characters. Propose only what the answer above leaves genuinely open. ' +
        'Reply with nothing at all if the exchange is finished, if they were told a person will take over, ' +
        'or if the honest follow-ups are ones you could not answer.',
      prompt: `Customer: ${question}\nAgent: ${answer}`,
      ...(signal ? { abortSignal: signal } : {}),
    })

    return {
      items: text
        .split('|')
        .map((item) => item.trim().replace(/^[-*\d.\s]+/, ''))
        .filter((item) => item.length > 0 && item.length <= 80)
        .slice(0, max),
      usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens },
    }
  } catch {
    return { items: [], usage: {} }
  }
}
