import { jsonSchema, tool, type Tool, type ToolSet } from 'ai'
import type { Action, ActionContext, ActionField, ActionInput, ActionResult } from './types.js'

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
}

/**
 * Compiles actions into an AI SDK tool set.
 *
 * A client action gets a tool with no `execute`, which is how the SDK signals
 * "this call has no result yet". The turn stops there, the frame goes to the
 * browser, and the result arrives on the next request.
 */
export function actionsToTools(actions: Action[], options: ToolBuildOptions): ToolSet {
  const tools: ToolSet = {}

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
              try {
                const data = await action.execute?.(input, options.context)
                return { ok: true, data }
              } catch (error) {
                // Handed back as data rather than thrown, so the agent can tell
                // the customer what failed instead of the turn dying silently.
                return { ok: false, error: error instanceof Error ? error.message : String(error) }
              }
            },
          })
  }

  return tools
}
