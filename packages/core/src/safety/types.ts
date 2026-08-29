/**
 * The vocabulary of the safety layer.
 *
 * A support agent on a real site needs a line, and where that line sits is the
 * business's decision rather than ours: one shop wants every off-topic message
 * refused, another is happy to chat. So the policy is configuration and the
 * detectors are code.
 */

import type { Rule } from './rules.js'

/** What a detector found. One message can produce several. */
export interface Signal {
  /** The category name, matched against the configured policy. */
  category: string
  /** Confidence, 0 to 1. Compared against the category's threshold. */
  score: number
  /** Why it fired, in words worth putting in a log a human will read. */
  reason: string
}

/**
 * What to do about a category that fired.
 *
 * `crisis` must never be `refuse`. A person in distress being told "I can't
 * help with that" is the worst outcome this system can produce.
 */
export type Action = 'allow' | 'flag' | 'deflect' | 'refuse' | 'handoff'

/**
 * How much evidence a category needs before it fires.
 *
 * A word rather than a number because most people tuning this are not going to
 * have measured anything yet. `threshold` is there for when they have.
 */
export type Sensitivity = 'low' | 'medium' | 'high'

export interface CategoryPolicy {
  name: string
  action: Action
  sensitivity?: Sensitivity
  /** Overrides `sensitivity`. A score at or above this fires the category. */
  threshold?: number
  /** Shown to the customer when this category refuses or deflects. */
  message?: string
}

export interface ClassifierPolicy {
  categories?: CategoryPolicy[]
  /**
   * Checks the drafted answer as well as the question. Input-only is half a
   * system: it cannot catch a leaked prompt or an answer that contradicts
   * every source it was given.
   *
   * Streaming forces a real choice here, so it is explicit rather than hidden:
   *
   * - `true` releases the answer a sentence at a time, each one checked before
   *   it is sent. Nothing unchecked reaches the browser, and the customer sees
   *   the first sentence as soon as it is written rather than waiting for the
   *   whole answer. A sentence already read cannot be taken back, so a hit
   *   stops the rest and says so.
   * - `'buffer'` holds the whole answer, checks it, then releases it. Nothing
   *   unsafe ever reaches the browser, and the customer waits for the full
   *   generation before the first word. Right when a leak would be serious.
   */
  output?: boolean | 'buffer'
  /**
   * A classifier of your own, run after the built-in rules. This is where a
   * model tier, or an existing moderation service, plugs in.
   */
  classify?: (text: string, context: ClassifyContext) => Promise<Signal[]> | Signal[]
  /**
   * Detectors of your own, run alongside the built-in ones rather than
   * instead of them.
   *
   * The shipped phrase lists are English. A business answering in another
   * language inherits detection that does not cover it, and replacing the
   * whole rule set to add one list would throw away the ones that are not
   * language-specific at all. Append instead.
   */
  rules?: Rule[]
  /**
   * How sure the rules must be that a *retrieved passage* is carrying
   * instructions before it is kept out of the prompt. 0.8 by default.
   *
   * Lower it if you would rather lose a page than risk one, raise it if a
   * legitimate page keeps being dropped. `1` disables the screen.
   */
  passageThreshold?: number
  /** Called for every decision, including the ones that allowed. For metrics. */
  onDecision?: (decision: Decision) => void
}

export interface ClassifyContext {
  /** `input` for the customer's message, `output` for the drafted answer. */
  stage: 'input' | 'output'
  conversationId?: string
  /** The passages retrieval found, when checking an answer against them. */
  sources?: string[]
}

export interface Decision {
  action: Action
  /** Everything that fired, strongest first. Empty when nothing did. */
  signals: Signal[]
  /** The signal that decided the action. */
  matched?: Signal
  /** What to say instead, when the action is not `allow` or `flag`. */
  message?: string
  /**
   * The text to carry on with. Detectors may rewrite rather than refuse:
   * stripping smuggled invisible characters is better than a refusal, because
   * the visible question is usually a real one.
   */
  text: string
}

/**
 * Thresholds behind the words.
 *
 * `high` fires on weak evidence and over-refuses more; `low` fires only on
 * what is obvious. The numbers are a starting point to be measured and
 * replaced, not a claim about accuracy.
 */
export const THRESHOLDS: Record<Sensitivity, number> = {
  high: 0.3,
  medium: 0.5,
  low: 0.75,
}

/**
 * The policy when none is given.
 *
 * Deliberately narrow. Everything here is something a support agent should
 * refuse or escalate on any site, in any industry; anything arguable is left
 * for the business to turn on.
 */
export const DEFAULT_CATEGORIES: CategoryPolicy[] = [
  {
    name: 'injection',
    action: 'refuse',
    sensitivity: 'medium',
    message: 'I can only help with questions about our products and your orders.',
  },
  {
    name: 'abuse',
    action: 'refuse',
    sensitivity: 'medium',
    message: 'I want to help, but I need us to keep this civil. What do you need?',
  },
  {
    name: 'crisis',
    action: 'handoff',
    sensitivity: 'high',
    message: 'I am putting you through to a person who can help properly. One moment.',
  },
]

export function thresholdFor(policy: CategoryPolicy): number {
  return policy.threshold ?? THRESHOLDS[policy.sensitivity ?? 'medium']
}
