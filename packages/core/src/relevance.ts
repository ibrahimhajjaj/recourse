/**
 * Whether a conversation is about a particular thing.
 *
 * Used for two decisions that look different and are the same question: is
 * this procedure's trigger what the customer is talking about, and is this
 * action worth putting in front of the model this turn.
 *
 * Deliberately generous. A missed match takes something away from a turn that
 * needed it, which breaks a working deployment; a loose match only leaves
 * things as they were before any of this existed. So one shared distinctive
 * word is enough, and a phrase with no distinctive words matches everything.
 */

import { tokenize } from './knowledge/tokenize.js'

/**
 * Support vocabulary that says nothing about which of them applies.
 *
 * Nearly every trigger contains some of these, so matching on one matches
 * everything: "where is my order" turned on a refund procedure because both
 * mention an order. The general stopword list does not cover them because
 * they carry plenty of meaning in a document; they just carry none here.
 *
 * Stemmed, because that is what the tokeniser returns.
 */
const GENERIC = new Set([
  'custom',
  'customer',
  'client',
  'user',
  'account',
  'order',
  'purchas',
  'item',
  'product',
  'request',
  'ask',
  'want',
  'need',
  'help',
  'support',
  'question',
  'issu',
  'problem',
  'about',
  'their',
  'them',
  'someth',
  'anyth',
])

/** Whether `conversation` shares a distinctive word with `about`. */
export function mentions(about: string, conversation: string): boolean {
  const wanted = distinctive(about)
  if (wanted.size === 0) return true

  for (const term of tokenize(conversation)) {
    if (wanted.has(term)) return true
  }

  return false
}

/**
 * How many of `about`'s distinctive words `text` contains.
 *
 * `mentions` answers whether at all, which is the right question when the
 * decision is to offer a tool or not. Choosing between two things that both
 * match needs a degree, and this is it. Zero for a phrase with no distinctive
 * words, where `mentions` says yes to everything: something that matches
 * everything cannot be evidence for one candidate over another.
 */
export function sharedTerms(about: string, text: string): number {
  const wanted = distinctive(about)
  if (wanted.size === 0) return 0

  const found = new Set<string>()
  for (const term of tokenize(text)) {
    if (wanted.has(term)) found.add(term)
  }

  return found.size
}

function distinctive(about: string): Set<string> {
  return new Set(tokenize(about).filter((term) => !GENERIC.has(term)))
}
