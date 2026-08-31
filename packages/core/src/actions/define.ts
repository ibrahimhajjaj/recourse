import { jsonSchema, tool, type Tool, type ToolSet } from 'ai'
import type { Action, ActionContext, ActionField, ActionInput, ActionResult } from './types.js'
import { redact, shrink, type ShrinkOptions } from './shrink.js'

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
export function actionsToTools(actions: Action[], options: ToolBuildOptions): ToolSet {
  const tools: ToolSet = {}
  const repeatLimit = options.repeatLimit ?? 2
  /** Signature of every server call this turn, and how often it has been made. */
  const calls = new Map<string, number>()

  for (const action of actions) {
    if (action.procedureOnly && !options.unlocked?.has(action.name)) continue

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

              try {
                const data = await action.execute?.(input, options.context)
                return { ok: true, data: shrink(data, options.results) }
              } catch (error) {
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
