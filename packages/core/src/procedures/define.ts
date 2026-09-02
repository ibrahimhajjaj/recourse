import { mentions } from '../relevance.js'
import type { Action } from '../actions/types.js'
import { ACTION_REFERENCE, MAX_BRANCHES, MAX_STEPS, type Decision, type Procedure, type Step } from './types.js'

/**
 * Declares a procedure, checking the things that fail silently at runtime.
 *
 * A misspelled `@action` reference is the expensive mistake here: the procedure
 * looks right, the agent reaches that step, and nothing happens. Better to
 * refuse at startup than to discover it from a customer.
 */
export function defineProcedure(procedure: Procedure): Procedure {
  if (!procedure.name.trim()) throw new Error('a procedure needs a name')
  if (!procedure.trigger.trim()) throw new Error(`procedure "${procedure.name}" needs a trigger`)
  if (procedure.steps.length === 0) throw new Error(`procedure "${procedure.name}" has no steps`)

  if (procedure.steps.length > MAX_STEPS) {
    throw new Error(
      `procedure "${procedure.name}" has ${procedure.steps.length} steps; the limit is ${MAX_STEPS}. Split it into two.`,
    )
  }

  for (const step of procedure.steps) {
    if (typeof step === 'string') continue
    if (step.branches.length === 0) throw new Error(`a decision in "${procedure.name}" has no branches`)
    if (step.branches.length > MAX_BRANCHES) {
      throw new Error(`a decision in "${procedure.name}" has more than ${MAX_BRANCHES} branches`)
    }
  }

  return procedure
}

/** Every action name a procedure mentions, across steps and branches. */
export function referencedActions(procedure: Procedure): Set<string> {
  const names = new Set<string>()

  for (const text of stepTexts(procedure.steps)) {
    for (const match of text.matchAll(ACTION_REFERENCE)) names.add(match[1] as string)
  }

  return names
}

function stepTexts(steps: Step[]): string[] {
  const texts: string[] = []
  for (const step of steps) {
    if (typeof step === 'string') {
      texts.push(step)
      continue
    }
    const decision = step as Decision
    for (const branch of decision.branches) texts.push(branch.if, branch.then)
    if (decision.otherwise) texts.push(decision.otherwise)
  }
  return texts
}

/**
 * Drops procedures that reference an action this agent does not have.
 *
 * Half a procedure is worse than none: the agent follows the first four steps,
 * reaches a tool that is not there, and improvises the ending it was written to
 * prevent.
 */
export function usableProcedures(
  procedures: Procedure[],
  actions: Action[],
): { usable: Procedure[]; dropped: Array<{ name: string; missing: string[] }> } {
  const available = new Set(actions.map((action) => action.name))
  const usable: Procedure[] = []
  const dropped: Array<{ name: string; missing: string[] }> = []

  for (const procedure of procedures) {
    if (procedure.enabled === false) continue

    const missing = [...referencedActions(procedure)].filter((name) => !available.has(name))
    if (missing.length > 0) dropped.push({ name: procedure.name, missing })
    else usable.push(procedure)
  }

  return { usable, dropped }
}

/**
 * The procedures the conversation is actually about.
 *
 * Computed once and handed to both the prompt and the unlock check, so the two
 * cannot disagree. They did: every procedure was described in the prompt on
 * every turn while only the matching one had its actions bound, which told the
 * model to call a tool it had not been given. On a conversation of "hi" that
 * meant a refund procedure spelled out in full, naming an action that was not
 * there.
 *
 * Not just a saving, though it is one. Eight ordinary procedures render to
 * around nine hundred tokens, and almost none of them have anything to do with
 * what is being said.
 */
export function matchingProcedures(procedures: Procedure[], conversation?: string): Procedure[] {
  if (conversation === undefined) return procedures

  return procedures.filter((procedure) => mentions(procedure.trigger, conversation))
}

/**
 * Action names any usable procedure needs, so procedure-only ones unlock.
 *
 * Pass the **whole conversation** rather than the last message, which is what
 * makes a match stay decided: a refund procedure matched at "I want a refund"
 * is still matched three turns later at "LUM-1234", so an action does not
 * vanish from under a flow halfway through it. Omit it and everything unlocks,
 * for a caller with no conversation to judge.
 */
export function unlockedBy(procedures: Procedure[], conversation?: string): Set<string> {
  const names = new Set<string>()

  for (const procedure of procedures) {
    if (conversation !== undefined && !mentions(procedure.trigger, conversation)) continue
    for (const name of referencedActions(procedure)) names.add(name)
  }

  return names
}

