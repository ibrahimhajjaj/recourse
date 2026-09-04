import type { Channel } from '../store/types.js'

/**
 * A procedure is a standard operating procedure for the agent: a trigger that
 * says when it applies, and an ordered list of steps to work through.
 *
 * Use them where improvising is expensive. An agent left to its own judgment on
 * a refund will sometimes ask for the order number and sometimes not, sometimes
 * check eligibility and sometimes not. A procedure makes that flow the same
 * every time, and makes the sensitive actions inside it unreachable elsewhere.
 */

export interface Branch {
  /** Checked in order; the first true one runs and the rest are skipped. */
  if: string
  then: string
}

export interface Decision {
  /** The ordered conditions. */
  branches: Branch[]
  /** Runs when no condition matched. */
  otherwise?: string
}

/** A plain instruction, or a decision point. */
export type Step = string | Decision

export interface Procedure {
  /** Human-readable, shown in transcripts and analytics. */
  name: string
  /** When this procedure applies. The agent matches on this, so be concrete. */
  trigger: string
  steps: Step[]
  /** Turns the procedure off without deleting it. */
  enabled?: boolean
  /**
   * The channels this procedure runs on. Unset means all of them.
   *
   * A flow written around a form, a file upload or a button is a flow that only
   * works where those exist. Restricting the procedure is better than letting
   * it match on WhatsApp and stall at the step nothing can carry out.
   */
  channels?: Channel[]
}

/** Matches `@action_name` inside a step. */
export const ACTION_REFERENCE = /@([a-z][a-z0-9_]*)/g

/** Matches `{{ token }}` inside a step or condition. */
export const VARIABLE_REFERENCE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

/**
 * Limits taken from the behaviour this mirrors, and worth keeping: a procedure
 * long enough to exceed them is really several procedures, and a model asked to
 * hold twenty ordered steps in mind stops following any of them reliably.
 */
export const MAX_STEPS = 15
export const MAX_BRANCHES = 5
