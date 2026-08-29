/**
 * A safety layer with a dial on it.
 *
 * Three tiers, cheapest first, because the answer path is fast and a naive
 * extra model call per turn would be the slowest thing in it:
 *
 * 1. Deterministic rules. Always on, no credential, no network, no measurable
 *    latency. Catches the boring majority: override phrasing, encoded
 *    payloads, invisible characters, conversation floods.
 * 2. Your own classifier, through `classify`. A small model, a hosted
 *    moderation service, anything that returns scores. Optional.
 * 3. The model's own judgment, via the system prompt, which is already there.
 *
 * Defence in depth is the point. Anthropic's own classifier research reports
 * jailbreak success falling from 86% to 4.4% with input and output classifiers
 * in front of a model, and still recommends complementary defences, because
 * ciphers, role-play, keyword substitution and injection all got through
 * something. No single layer here is expected to hold alone.
 */

export { createClassifier, blocks, type Classifier } from './classify.js'
export { INPUT_RULES, OUTPUT_RULES, phraseRule, runRules, type Rule } from './rules.js'
export {
  DEFAULT_CATEGORIES,
  THRESHOLDS,
  thresholdFor,
  type Action,
  type CategoryPolicy,
  type ClassifierPolicy,
  type ClassifyContext,
  type Decision,
  type Sensitivity,
  type Signal,
} from './types.js'
export {
  modelClassifier,
  buildPrompt,
  type ModelClassifierOptions,
  type LabelledExample,
} from './model-classifier.js'
