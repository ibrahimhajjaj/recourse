import type { StreamFrame } from '../types.js'
import type { Store } from '../store/types.js'
import type { Webhooks } from '../webhooks/index.js'

/**
 * One piece of information an action needs before it can run. These become the
 * tool's input schema, so the model knows to gather them conversationally
 * rather than guessing.
 */
export interface ActionField {
  name: string
  type: 'string' | 'number' | 'boolean'
  /** Written for the model, not the customer. Say what good input looks like. */
  description: string
  /** Optional fields let the model proceed without nagging for everything. */
  required?: boolean
  /** Constrains the value to a fixed set. */
  options?: string[]
}

/** Who the agent is talking to, when the host knows. */
export interface Contact {
  id?: string
  name?: string
  email?: string
  phone?: string
  /** Anything else the host wants actions and prompts to see. */
  attributes?: Record<string, string | number | boolean>
  /**
   * True when the host cryptographically proved this identity. Actions that
   * expose personal data must refuse to run when this is false.
   */
  verified?: boolean
}

export interface ActionContext {
  conversationId?: string
  contact?: Contact
  /**
   * Verified facts the model never sees.
   *
   * `contact.attributes` reaches procedure text and therefore the prompt, so a
   * billing id or a date of birth put there can end up in an answer. These
   * arrive in a signed token and stop here, where an action can look something
   * up with them without the model ever holding them.
   */
  private?: Record<string, unknown>
  signal?: AbortSignal
  /** Present when the agent was given one. Actions persist through it. */
  store?: Store
  /** Present when the agent was given webhooks. Actions announce through it. */
  webhooks?: Webhooks
  /** Pushes a frame to the client while the action is still running. */
  emit(frame: StreamFrame): void
}

export type ActionInput = Record<string, string | number | boolean | undefined>

export interface Action {
  /** The tool name the model calls. Lowercase with underscores. */
  name: string
  /**
   * When the agent should reach for this. This is the single highest-leverage
   * string in the whole configuration: a vague one gets the action called at
   * the wrong moment, or never.
   */
  whenToUse: string
  collect?: ActionField[]
  /**
   * Keeps the action off the agent's own initiative, so it fires only as a step
   * inside a procedure. Use it for anything with consequences: refunds,
   * cancellations, anything that writes to another system.
   */
  procedureOnly?: boolean
  /**
   * `client` actions are executed by the browser rather than here, because they
   * need page context the server does not have. The server pauses, the widget
   * runs them, and the result comes back on the next request.
   */
  runs?: 'server' | 'client'
  /**
   * Configuration the browser needs in order to carry the action out, sent
   * with the request. A form ships its fields this way, since the model
   * decides when to show it but not what is on it.
   */
  clientPayload?: Record<string, unknown>
  execute?(input: ActionInput, ctx: ActionContext): Promise<unknown>
}

/** What an action hands back to the model. */
export interface ActionResult {
  ok: boolean
  /** Shown to the model. Keep it small; it costs context on every later turn. */
  data?: unknown
  /** Read by the model when something went wrong, so it can recover in words. */
  error?: string
}
