/**
 * Turning what the detectors found into one decision.
 *
 * The detectors say what they saw. This says what to do about it, and that
 * split is deliberate: the business changes the policy constantly and never
 * changes the detectors.
 */

import { INPUT_RULES, OUTPUT_RULES, runRules } from './rules.js'
import {
  DEFAULT_CATEGORIES,
  thresholdFor,
  type Action,
  type ClassifierPolicy,
  type ClassifyContext,
  type Decision,
  type Signal,
} from './types.js'

/**
 * Which action wins when two categories fire at once.
 *
 * `handoff` outranks `refuse` on purpose. Somebody in distress who has also
 * said something the injection rules dislike needs a person, and refusing them
 * because of the second thing would be the worst possible reading of both.
 */
const SEVERITY: Record<Action, number> = {
  handoff: 4,
  refuse: 3,
  deflect: 2,
  flag: 1,
  allow: 0,
}

export interface Classifier {
  /** Checks a customer's message before anything is retrieved or generated. */
  check(text: string, context?: Partial<ClassifyContext>): Promise<Decision>
  /** Checks a drafted answer before the customer reads it. */
  checkOutput(text: string, context?: Partial<ClassifyContext>): Promise<Decision>
  /** Whether output checking is configured at all, so callers can skip the work. */
  readonly checksOutput: boolean
  /** True when the answer must be held back until it has been checked. */
  readonly buffers: boolean
}

export function createClassifier(policy: ClassifierPolicy = {}): Classifier {
  const categories = policy.categories ?? DEFAULT_CATEGORIES
  const byName = new Map(categories.map((category) => [category.name, category]))

  async function decide(
    text: string,
    rules: typeof INPUT_RULES,
    context: ClassifyContext,
  ): Promise<Decision> {
    const fromRules = runRules(text, rules, {
      ...(context.sources ? { sources: context.sources } : {}),
      ...(context.asked ? { asked: context.asked } : {}),
    })
    const signals = [...fromRules.signals]

    // The host's own classifier runs on the text the rules have already
    // cleaned, so a smuggled payload is not handed to it intact.
    if (policy.classify) {
      try {
        signals.push(...(await policy.classify(fromRules.text, context)))
      } catch (error) {
        // A classifier that is down must not take the conversation down with
        // it. Failing open is the right default for a support agent: the
        // system prompt and the rules above are still standing.
        console.warn(
          `[helpdeck] classifier failed, continuing without it: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    signals.sort((a, b) => b.score - a.score)

    let matched: Signal | undefined
    let action: Action = 'allow'

    for (const signal of signals) {
      const category = byName.get(signal.category)
      // A signal for a category nobody configured is still recorded. That is
      // how you measure a category for a week before you enforce it.
      if (!category) continue
      if (signal.score < thresholdFor(category)) continue

      if (SEVERITY[category.action] > SEVERITY[action]) {
        action = category.action
        matched = signal
      }
    }

    const decision: Decision = {
      action,
      signals,
      text: fromRules.text,
      ...(matched ? { matched } : {}),
      ...(matched && byName.get(matched.category)?.message
        ? { message: byName.get(matched.category)?.message }
        : {}),
    }

    policy.onDecision?.(decision)
    return decision
  }

  // Appended, not substituted. Someone adding a phrase list in their own
  // language should not lose the invisible-character stripper to get it.
  const inputRules = policy.rules ? [...INPUT_RULES, ...policy.rules] : INPUT_RULES
  const outputRules = policy.rules ? [...OUTPUT_RULES, ...policy.rules] : OUTPUT_RULES

  return {
    checksOutput: policy.output === true || policy.output === 'buffer',
    buffers: policy.output === 'buffer',
    check: (text, context = {}) => decide(text, inputRules, { stage: 'input', ...context }),
    checkOutput: (text, context = {}) => decide(text, outputRules, { stage: 'output', ...context }),
  }
}

/** True when the decision means the customer should not get a model answer. */
export function blocks(decision: Decision): boolean {
  return decision.action === 'refuse' || decision.action === 'deflect' || decision.action === 'handoff'
}
