import { jsonSchema, tool, type Tool, type ToolSet } from 'ai'
import type { Action, ActionContext, ActionField, ActionInput, ActionResult } from './types.js'
import { redact, shrink, type ShrinkOptions } from './shrink.js'
import { mentions } from '../relevance.js'

/**
 * Declares an action. This is deliberately a thin identity function: it exists
 * so authored actions get checked against the interface at the definition site
 * rather than at the call site, where the error message is useless.
 */
export function defineAction(action: Action): Action {
  if (!/^[a-z][a-z0-9_]*$/.test(action.name)) {
    throw new Error(
      `action name "${action.name}" must be lowercase letters, digits and underscores; models call it verbatim`,
    )
  }
  if (action.runs !== 'client' && !action.execute) {
    throw new Error(`action "${action.name}" runs on the server but has no execute()`)
  }
  return action
}

/** Turns the declared fields into the JSON Schema the model is given. */
export function fieldsToSchema(fields: ActionField[] = []) {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const field of fields) {
    const property: Record<string, unknown> = { type: field.type, description: field.description }
    if (field.options?.length) property.enum = field.options
    properties[field.name] = property
    // Default to required: an action missing an input it needs fails at the
    // worst possible moment, halfway through a customer's request.
    if (field.required !== false) required.push(field.name)
  }

  return { type: 'object' as const, properties, required, additionalProperties: false }
}

export interface ToolBuildOptions {
  /** Excludes procedure-only actions unless a procedure has unlocked them. */
  unlocked?: Set<string>
  /**
   * Everything said so far, for deciding which `relevantWhen` actions to offer.
   *
   * Left out, every action is offered, which is what a caller building a tool
   * set outside a conversation wants.
   */
  conversation?: string
  context: ActionContext
  /** How much of a result reaches the model. */
  results?: ShrinkOptions
  /**
   * How many times running to the same call with the same arguments before it
   * is refused rather than run again. Two, so the second identical call still
   * happens and only the third is stopped: a model retrying once after a
   * transient failure is doing the right thing.
   */
  repeatLimit?: number
  /**
   * How many times one action may fail in a turn before it stops being run.
   *
   * Separate from `repeatLimit`, and catching what that cannot: a model varying
   * an argument it is guessing at. Nothing repeats, so nothing trips, and every
   * attempt is a real request to a real system. Three, which is enough for a
   * genuine transient failure and short of a spin. Zero turns it off.
   */
  failureLimit?: number
}

/**
 * What the model is told when it has asked the same thing twice already.
 *
 * Phrased as an instruction rather than an error, because an error is a thing
 * models retry. It names the two ways out, since a model in this state has
 * usually stopped considering that there are any.
 */
const STOP_REPEATING =
  'You already called this with exactly these arguments and the result has not changed. ' +
  'Do not call it again. Use what you already have, or ask the customer for something ' +
  'that would change the answer.'

/**
 * What the model is told once an action has failed enough times this turn.
 *
 * The repeat check above cannot see this one, because nothing repeats: a model
 * guessing an order number sends a different one each time, so every call
 * hashes differently and every one is a fresh request to somebody's order
 * system. Guessing is the only thing that has changed between them, and the
 * customer is the only place the missing information actually is.
 */
const STOP_GUESSING =
  'This has failed several times already this turn with different arguments. Stop calling it. ' +
  'You are guessing at something only the customer can tell you, so ask them for it plainly, ' +
  'or say what you could not do.'

/**
 * Compiles actions into an AI SDK tool set.
 *
 * A client action gets a tool with no `execute`, which is how the SDK signals
 * "this call has no result yet". The turn stops there, the frame goes to the
 * browser, and the result arrives on the next request.
 *
 * The wrapper around `execute` is per turn, and so is the record of what has
 * been called: a model that gets an unhelpful result and calls the same thing
 * again is common enough on small models to be worth spending code on, and
 * every repeat is another round trip to somebody's payment API.
 */
/**
 * The actions worth offering on this turn.
 *
 * The prompt names the actions and the tool set binds them, and they have to
 * agree: an action described in the prompt but absent from the tool set is a
 * model reaching for something that is not there, which it reports to the
 * customer as a failure.
 */
/**
 * The label shown while an action runs, when it has one.
 *
 * Wrapped, because this is deployment code running inside the turn: a summary
 * that throws would take down a lookup that was about to succeed, over a string
 * nobody needed.
 */
function summarise(action: Action, input: ActionInput): string {
  if (!action.summarise) return ''

  try {
    const label = action.summarise(input)
    return typeof label === 'string' ? label.slice(0, 120) : ''
  } catch (error) {
    console.error(`[recourse] the summary for "${action.name}" threw:`, error)
    return ''
  }
}

export function offeredActions(
  actions: Action[],
  options: Pick<ToolBuildOptions, 'unlocked' | 'conversation'>,
): Action[] {
  return actions.filter((action) => {
    if (action.procedureOnly && !options.unlocked?.has(action.name)) return false

    // Unlocked wins: a procedure that reached this action has already decided
    // it applies, and asking the same question a second way could drop a tool
    // out of a flow halfway through it.
    if (options.unlocked?.has(action.name)) return true

    if (action.relevantWhen && options.conversation !== undefined) {
      return mentions(action.relevantWhen, options.conversation)
    }

    return true
  })
}

export function actionsToTools(actions: Action[], options: ToolBuildOptions): ToolSet {
  const tools: ToolSet = {}
  const repeatLimit = options.repeatLimit ?? 2
  const failureLimit = options.failureLimit ?? 3
  /** Signature of every server call this turn, and how often it has been made. */
  const calls = new Map<string, number>()
  /** Failures per action this turn, whatever arguments they were made with. */
  const failures = new Map<string, number>()

  for (const action of offeredActions(actions, options)) {

    const inputSchema = jsonSchema<ActionInput>(fieldsToSchema(action.collect))

    tools[action.name] =
      action.runs === 'client'
        ? (tool({ description: action.whenToUse, inputSchema }) as Tool<ActionInput, never>)
        : tool({
            description: action.whenToUse,
            inputSchema,
            async execute(input: ActionInput): Promise<ActionResult> {
              const signature = `${action.name}:${stableKey(input)}`
              const seen = calls.get(signature) ?? 0
              calls.set(signature, seen + 1)

              if (repeatLimit > 0 && seen >= repeatLimit) {
                console.warn(`[recourse] "${action.name}" called ${seen + 1} times with the same input; refusing to run it again.`)
                return { ok: false, error: STOP_REPEATING }
              }

              const failed = failures.get(action.name) ?? 0

              if (failureLimit > 0 && failed >= failureLimit) {
                console.warn(`[recourse] "${action.name}" has failed ${failed} times this turn; refusing to run it again.`)
                return { ok: false, error: STOP_GUESSING }
              }

              // Reported for every action rather than only the ones that
              // remembered to. A lookup can take five seconds, and without this
              // the visitor watches three dots and cannot tell the difference
              // between working and broken.
              const label = summarise(action, input)
              options.context.emit?.({
                type: 'action',
                name: action.name,
                status: 'running',
                ...(label ? { summary: label } : {}),
              })

              try {
                const data = await action.execute?.(input, options.context)
                options.context.emit?.({ type: 'action', name: action.name, status: 'done' })
                return { ok: true, data: shrink(data, options.results) }
              } catch (error) {
                failures.set(action.name, failed + 1)
                options.context.emit?.({ type: 'action', name: action.name, status: 'failed' })

                // Handed back as data rather than thrown, so the agent can tell
                // the customer what failed instead of the turn dying silently.
                // Redacted first: an action that fails on an authenticated
                // request tends to quote the request, credential included, and
                // this string is about to be stored in the transcript.
                const message = error instanceof Error ? error.message : String(error)
                return { ok: false, error: redact(message).slice(0, 500) }
              }
            },
          })
  }

  return tools
}

/**
 * The same arguments in a different order are the same call.
 *
 * Models re-emit their arguments freely, so comparing raw JSON would miss the
 * repeat that matters. Undefined values are dropped for the same reason: a
 * model that omits an optional field once and sends it as null the next time
 * has not asked a new question.
 */
function stableKey(input: ActionInput): string {
  const entries = Object.entries(input ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))

  return JSON.stringify(entries)
}
