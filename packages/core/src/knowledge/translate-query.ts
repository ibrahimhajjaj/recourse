/**
 * Searching English content with a question that is not in English.
 *
 * Retrieval compares the question against the text of the documents. Ask about
 * delivery in Arabic and there is nothing in an English index for it to match,
 * so a shop whose help pages answer the question perfectly well returns
 * nothing, and the agent says it cannot find something it is standing on.
 *
 * The fix is one cheap call: put the question into the language the content is
 * written in, search with that, and let the answer come back in the language
 * the customer used. Only the search key is translated. The question the model
 * answers is still theirs, so nothing is lost in the reply.
 *
 * The alternative is embeddings that place every language in one space, which
 * is better and costs a re-index. This works with whatever is already there.
 */

import type { LanguageModel } from 'ai'

export interface TranslateQueryOptions {
  /** The language the indexed content is written in, as a name the model knows. */
  indexLanguage: string
  /** Something small and fast. This runs before retrieval, on the clock. */
  model: LanguageModel
  signal?: AbortSignal
}

/**
 * The handful of words a language cannot make a sentence without.
 *
 * Function words rather than vocabulary: a question in English almost always
 * contains one of these, and a question in another Latin-script language
 * almost never does. Cheaper and more honest than guessing from vocabulary,
 * which collides constantly across related languages.
 */
const FUNCTION_WORDS: Record<string, RegExp> = {
  english: /\b(the|is|are|was|how|what|when|where|why|which|can|do|does|did|my|your|to|of|for|and|with|have|has|it|please)\b/i,
  french: /\b(le|la|les|est|sont|comment|quoi|quand|où|pourquoi|puis|je|mon|ma|de|des|pour|et|avec|avez)\b/i,
  spanish: /\b(el|la|los|las|es|son|cómo|qué|cuándo|dónde|por|puedo|mi|de|para|y|con|tiene)\b/i,
  german: /\b(der|die|das|ist|sind|wie|was|wann|wo|warum|kann|ich|mein|von|für|und|mit|haben)\b/i,
  portuguese: /\b(o|a|os|as|é|são|como|que|quando|onde|porque|posso|meu|de|para|e|com|tem)\b/i,
  italian: /\b(il|la|lo|è|sono|come|che|quando|dove|perché|posso|mio|di|per|e|con|ha)\b/i,
}

/**
 * Whether a question is worth translating before searching.
 *
 * Two checks, cheapest first. A script that is not the content's is a certain
 * mismatch and free to spot. Latin-script languages are the harder half, and
 * ignoring them was the first version's mistake: French, Spanish, German,
 * Turkish and Vietnamese all look Latin to a script check and none of them
 * retrieve against English content.
 *
 * So a Latin-script question is judged on function words, the small set a
 * language cannot form a sentence without. A question with none of the index
 * language's is probably not in it. This is a heuristic and says so: it errs
 * toward translating, because a needless translation costs a few hundred
 * milliseconds and a missed one costs the answer.
 */
export function needsTranslation(question: string, indexLanguage = 'English'): boolean {
  const letters = question.replace(/[\s\d\p{P}\p{S}]/gu, '')
  if (letters.length === 0) return false

  const latin = letters.match(/\p{Script=Latin}/gu)?.length ?? 0

  // Half is deliberate rather than strict: a question that mixes scripts, like
  // an Arabic sentence naming an English city, still needs translating.
  if (latin / letters.length < 0.5) return true

  const words = FUNCTION_WORDS[indexLanguage.toLowerCase()]
  // An index language we hold no word list for cannot be judged this way, and
  // guessing would translate every question it ever saw.
  if (!words) return false

  // Too short to judge. "refund?" is not evidence of anything.
  if (question.trim().split(/\s+/).length < 3) return false

  return !words.test(question)
}

/**
 * The question, in the language the content is written in.
 *
 * Returns the original when nothing needs doing or the model cannot be
 * reached: searching with the untranslated question is what happened before
 * this existed, and is better than failing the turn over a translation.
 */
export async function translateQuery(question: string, options: TranslateQueryOptions): Promise<string> {
  const trimmed = question.trim()
  if (!trimmed || !needsTranslation(trimmed, options.indexLanguage)) return question

  try {
    const { generateText } = await import('ai')
    const { text } = await generateText({
      model: options.model,
      // Pinned, because a search key is not the place for variety.
      temperature: 0,
      // Enough for a question, not enough for the model to start explaining.
      maxOutputTokens: 200,
      system:
        `Translate the user's message into ${options.indexLanguage}. ` +
        'Reply with the translation and nothing else: no quotes, no notes, no explanation. ' +
        'Keep names, order numbers and product names exactly as written.',
      prompt: trimmed,
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })

    const translated = text.trim()

    return translated || question
  } catch (error) {
    console.error('[recourse] could not translate the question for search:', error)

    return question
  }
}

/**
 * Whether the embedder already places languages in one space.
 *
 * The two ways out of this problem are translating the question or embedding
 * every language together, and the second is better when it is available:
 * no extra call, no clock, and it catches French against English content,
 * which the script check deliberately does not.
 *
 * So the choice is made from what the index was actually built with rather
 * than asked of the caller. A model known to span languages needs no
 * translation; an English-centric one does; an unrecognised one is treated as
 * English-centric, because translating unnecessarily costs a few hundred
 * milliseconds and skipping it wrongly costs the answer.
 */
export function embedderSpansLanguages(model: string | undefined): boolean {
  if (!model) return false

  const name = model.toLowerCase()

  // Explicitly single-language, even where the family name suggests otherwise.
  if (/nomic-embed-text|all-minilm|gte-small|bge-small-en|bge-base-en|bge-large-en/.test(name)) return false

  return /multilingual|text-embedding-3|jina-embeddings-v[34]|bge-m3|e5-(base|large|small)?-?multi|labse|paraphrase-multi/.test(
    name,
  )
}
