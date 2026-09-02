/**
 * What a customer is told when the provider fails, and what the operator gets.
 *
 * These are deliberately two different things. A provider's error string is
 * written for whoever holds the API key: it quotes the request back, which
 * means the customer's own words, the instructions, sometimes a URL with a
 * token in it. Putting that on a chat widget publishes all three, and putting
 * it in a transcript stores them next to the conversation forever.
 *
 * So the customer gets a sentence, the operator gets a line with a reference
 * in it, and the two are joined by that reference rather than by copying the
 * provider's text into both.
 */

/** What went wrong, in the only vocabulary that is safe to show or store. */
export type FailureReason =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'unauthorized'
  | 'timeout'
  | 'too_large'
  | 'unsupported_input'
  | 'unavailable'
  | 'cancelled'
  | 'unknown'

export interface Diagnostic {
  reason: FailureReason
  /** Whether the same request stands a chance if it is sent again. */
  retryable: boolean
  /**
   * Whether another model would do better. Distinct from `retryable`: a quota
   * that is exhausted will still be exhausted in a second, but a different
   * model is on a different quota.
   */
  fallbackWorthTrying: boolean
  /** Shown to the customer. Contains nothing from the provider. */
  message: string
  /** Ties the sentence the customer saw to the line in the log. */
  reference: string
}

/**
 * Sentences a support customer can act on.
 *
 * None of them say "error", none quote a status code, and none blame the
 * visitor for something the business configured. The two that ask for patience
 * say roughly when.
 */
const MESSAGES: Record<FailureReason, string> = {
  rate_limited: 'We are getting more questions than usual right now. Try again in a minute.',
  quota_exhausted:
    'Our assistant is unavailable at the moment. Leave your question and a person will pick it up.',
  unauthorized: 'Our assistant is unavailable at the moment. Leave your question and a person will pick it up.',
  timeout: 'That took too long to answer. Try asking again, or a shorter version of the question.',
  too_large: 'That was too much for me to read in one go. Try sending a shorter version.',
  unsupported_input: 'I could not open what you sent. Please describe the problem instead.',
  unavailable: 'Our assistant is unavailable at the moment. Try again shortly.',
  cancelled: 'That answer was stopped before it finished.',
  unknown: 'Something went wrong answering that. Try again, or leave your question for a person.',
}

/**
 * Patterns matched against the provider's text, most specific first.
 *
 * Matching on strings is not principled and there is no alternative: every
 * provider spells the same condition differently, most of them across a status
 * code the SDK has already flattened into a message. Anything unmatched lands
 * on `unknown`, which is safe by construction, so a new provider's phrasing
 * degrades to a vague sentence rather than to a leak.
 */
const PATTERNS: Array<[RegExp, FailureReason]> = [
  [/(?:^|\D)429(?:\D|$)|rate[ _-]?limit|too many requests|overloaded/i, 'rate_limited'],
  [/quota|insufficient[ _-]?(?:quota|funds|credit)|billing|payment required|(?:^|\D)402(?:\D|$)/i, 'quota_exhausted'],
  [
    /(?:^|\D)40[13](?:\D|$)|unauthor|forbidden|(?:incorrect|invalid|missing)[ _-]?api[ _-]?key|authentication/i,
    'unauthorized',
  ],
  [/timed? ?out|timeout|etimedout|deadline/i, 'timeout'],
  [/(?:^|\D)413(?:\D|$)|too large|context[ _-]?length|maximum context|token limit|reduce the length/i, 'too_large'],
  [/multimodal|image|vision|does not support|not supported|unsupported/i, 'unsupported_input'],
  [/abort|cancell?ed/i, 'cancelled'],
  [/(?:^|\D)5\d\d(?:\D|$)|unavailable|econnreset|enotfound|econnrefused|fetch failed|network/i, 'unavailable'],
]

const RETRYABLE: FailureReason[] = ['rate_limited', 'timeout', 'unavailable']
/** A different model sits on a different quota, key and context window. */
const WORTH_A_FALLBACK: FailureReason[] = ['rate_limited', 'quota_exhausted', 'unavailable', 'too_large']

/**
 * Classifies a provider failure without carrying any of its text forward.
 *
 * `hadAttachments` only widens one case: a model that cannot see is a
 * configuration mistake by the business, and the visitor who attached a photo
 * should be told to describe it rather than left wondering.
 */
export function describeFailure(error: unknown, hadAttachments = false): Diagnostic {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)

  let reason: FailureReason = 'unknown'
  for (const [pattern, candidate] of PATTERNS) {
    if (!pattern.test(text)) continue
    reason = candidate
    break
  }

  // A vision complaint from a turn with no files attached is about something
  // else, and telling that customer their file failed would be a lie.
  if (reason === 'unsupported_input' && !hadAttachments) reason = 'unavailable'

  return {
    reason,
    retryable: RETRYABLE.includes(reason),
    fallbackWorthTrying: WORTH_A_FALLBACK.includes(reason),
    message: MESSAGES[reason],
    reference: newReference(),
  }
}

/**
 * Where this library's own diagnostics go.
 *
 * Two levels and nothing else. `warn` is something an operator should look at
 * and the turn survived; `error` is something that failed. A level for tracing
 * would invite this library to narrate itself into somebody's log bill, and a
 * level below warn has no reader.
 *
 * `fields` are the facts a log search needs (a conversation id, a model name),
 * kept out of the message so a structured sink can index them and the default
 * can still print one line.
 */
export interface Logger {
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, error?: unknown, fields?: Record<string, unknown>): void
}

/**
 * The default, and what everybody gets who configures nothing.
 *
 * It prints exactly what the raw `console` calls printed before there was a
 * seam here: the `[recourse]` prefix, then the message, then `key=value` pairs,
 * then the error object itself so a stack trace survives.
 */
export const consoleLogger: Logger = {
  warn(message, fields) {
    console.warn(`[recourse] ${message}${pairs(fields)}`)
  },
  error(message, error, fields) {
    // Spread rather than a branch, so a call with no error object passes one
    // argument and not one argument and an `undefined`. Tests assert on the
    // exact argument list a console call was made with.
    console.error(`[recourse] ${message}${pairs(fields)}`, ...(error === undefined ? [] : [error]))
  },
}

function pairs(fields?: Record<string, unknown>): string {
  const entries = Object.entries(fields ?? {})
  return entries.length === 0 ? '' : ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(' ')}`
}

let installed: Logger = consoleLogger

/**
 * The sink for the modules that are handed no options object of their own.
 *
 * Most of this library takes options and reads `logger` off them, which is what
 * keeps one deployment's sink out of another's in a process serving several.
 * A handful of places have nowhere to read it from: a pure function that
 * formats a tone, a document reader called from an ingest pipeline, a hook
 * registry the caller built. Those use this, so a consumer can still redirect
 * them once at start-up instead of patching the global console.
 */
export function setLogger(logger: Logger | undefined): void {
  installed = logger ?? consoleLogger
}

export function getLogger(): Logger {
  return installed
}

/**
 * One line an operator can grep for, holding the provider's own words.
 *
 * They go to the logger and nowhere else. The default logger writes to the
 * process log, which the business already controls and the customer cannot
 * read, and where a stack trace was going to end up anyway; a deployment that
 * wants them somewhere else passes its own.
 */
export function logFailure(
  diagnostic: Diagnostic,
  error: unknown,
  extra: Record<string, string> = {},
  logger: Logger = getLogger(),
): void {
  logger.error('model call failed', error, { ...extra, ref: diagnostic.reference, reason: diagnostic.reason })
}

/** Short and unique enough that a customer can quote it back the same day. */
function newReference(): string {
  return Math.random().toString(36).slice(2, 8)
}
