import type { Match, Message } from '../types.js'
import type { Action } from '../actions/types.js'
import type { Procedure } from '../procedures/types.js'
import type { Logger } from '../diagnostics.js'
import { offeredActions } from '../actions/define.js'
import { matchingProcedures, unlockedBy } from '../procedures/index.js'
import { INPUT_RULES, runRules } from '../safety/rules.js'
import { passageText } from '../server/prompt.js'

export interface TurnContext {
  /** The passages, with any that carry instructions dropped. */
  matches: Match[]
  /** The procedures this turn is about. */
  applicable: Procedure[]
  /** The action names those procedures reach. */
  unlocked: Set<string>
  /** The actions worth putting in front of the model this turn. */
  offered: Action[]
}

/**
 * What this turn is about, decided once from the whole conversation.
 *
 * The prompt and the tool set are built from the same answer, because they have
 * to agree: describing a procedure whose actions are not bound tells the model
 * to call something it has not been given.
 *
 * The retrieved passages are read as part of the conversation, because matching
 * on the customer's words alone misses the paraphrase: "do you have this in a
 * medium" is a stock question that contains none of the words a stock action
 * would be described with. Whatever the retriever found is what the turn is
 * about, in the vocabulary the business uses.
 */
export function resolveContext(input: {
  messages: Message[]
  found: Match[]
  procedures: Procedure[]
  actions: Action[]
  /** Null when no classifier is configured, in which case passages are not screened. */
  passageThreshold: number | null
  logger: Logger
}): TurnContext {
  const matches =
    input.passageThreshold === null ? input.found : withoutPoisoned(input.found, input.passageThreshold, input.logger)

  const said = input.messages.map((message) => message.content).join('\n')
  const applicable = matchingProcedures(input.procedures, said)
  const unlocked = unlockedBy(applicable)

  const offered = offeredActions(input.actions, {
    unlocked,
    conversation: `${said}\n${matches.map((match) => match.chunk.text).join('\n')}`,
  })

  return { matches, applicable, unlocked, offered }
}

/**
 * Drops retrieved passages that carry instructions rather than information.
 *
 * The whole passage is inspected, heading and all, because that is what the
 * prompt will contain: a page whose title reads "ignore all previous
 * instructions" is as much an attack as one whose body does.
 *
 * The bar is high by default because a false positive here silently removes a
 * real help page from the answer, which is its own kind of failure. What
 * clears it is unambiguous: text telling the reader to ignore its
 * instructions, adopt a new role, or emit a marker.
 */
function withoutPoisoned(matches: Match[], threshold: number, logger: Logger): Match[] {
  const kept: Match[] = []

  for (const match of matches) {
    const { signals } = runRules(passageText(match), INPUT_RULES)
    const worst = signals
      .filter((signal) => signal.category === 'injection')
      .reduce((highest, signal) => Math.max(highest, signal.score), 0)

    if (worst >= threshold) {
      // Loud on purpose. A poisoned knowledge base is something the business
      // has to go and fix; quietly dropping the page hides an intrusion.
      logger.warn(
        `ignoring a retrieved passage from "${match.chunk.title}": ` +
          `${signals.find((signal) => signal.score === worst)?.reason}. ` +
          'Check this page for text aimed at the agent rather than the reader.',
      )
      continue
    }

    kept.push(match)
  }

  return kept
}
