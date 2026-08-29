/**
 * Reading a ticket written in a language nobody on the team speaks.
 *
 * The scope is deliberately narrow: inbound customer messages, and nothing
 * else. Agent replies, internal notes and system events are left exactly as
 * written. Translating an outbound reply silently is how a mistranslated
 * promise gets sent to a customer over an agent's name, and the agent never
 * sees the sentence they are accountable for.
 *
 * The original is what gets stored. The translation rides alongside it in
 * metadata, so nothing is destroyed and an agent can always read what the
 * customer actually typed.
 */

import { generateText, type LanguageModel } from 'ai'

export interface TranslationOptions {
  /** The language the team reads. BCP-47, or a plain name the model knows. */
  target: string
  /** Anything the AI SDK accepts. Cheap models do this well. */
  model: LanguageModel
  /** Longest message translated. Longer ones are passed through untouched. */
  maxChars?: number
  signal?: AbortSignal
}

export interface Translated {
  /** What the model thinks the source language was, BCP-47 where it can. */
  language: string
  /** Absent when the text was already in the target language. */
  translation?: string
  /** True when nothing was sent to a model. */
  skipped: boolean
}

/** Ten thousand characters is a long email and a very long chat message. */
const DEFAULT_MAX_CHARS = 10_000

/**
 * Words that are common in English and rare as whole words elsewhere.
 *
 * Short and boring on purpose. This gate exists to make the common case free,
 * not to identify a language, and a wrong guess here costs one model call
 * rather than a wrong answer.
 */
const ENGLISH_MARKERS = new Set(
  ('the and for you your with have this that from please order not but was are ' +
    'can could would should when where what why how has been will there their ' +
    'about into out them they we i is it my me on at to of in a an').split(' '),
)

/**
 * Whether the text is plainly English already.
 *
 * Two signals, both cheap. Text outside the Latin script is not English and
 * needs no further thought. Latin text is judged on how many of its words are
 * English function words, which separates English from Spanish, German and
 * Indonesian well enough at this threshold.
 *
 * A false negative costs one model call. A false positive means an agent reads
 * the original, which is what they would have done anyway.
 */
export function looksEnglish(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true

  // Anything in a non-Latin script settles it immediately: Arabic, Chinese,
  // Japanese, Korean, Cyrillic, Hebrew, Thai, Greek, Devanagari.
  if (
    /[\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0e00-\u0e7f\u0370-\u03ff\u0900-\u097f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(
      trimmed,
    )
  ) {
    return false
  }

  const words = trimmed.toLowerCase().match(/[a-z']+/g) ?? []
  if (words.length === 0) return true

  // A short message has too few words for a ratio to mean anything, so one
  // marker is enough to let it through.
  const markers = words.filter((word) => ENGLISH_MARKERS.has(word)).length
  if (words.length < 6) return markers > 0

  return markers / words.length >= 0.15
}

/**
 * Detects the language and translates, or says why it did neither.
 *
 * Returns rather than throws. A translation service having a bad afternoon
 * must not stop a ticket being filed, and an untranslated ticket is a minor
 * inconvenience next to a lost one.
 */
export async function detectAndTranslate(
  text: string,
  options: TranslationOptions,
): Promise<Translated> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const trimmed = text.trim()

  if (trimmed.length === 0 || trimmed.length > maxChars) {
    return { language: 'unknown', skipped: true }
  }

  // The whole point of the gate: an English-speaking team's English tickets
  // cost nothing at all.
  if (isTargetEnglish(options.target) && looksEnglish(trimmed)) {
    return { language: 'en', skipped: true }
  }

  try {
    const { text: raw } = await generateText({
      model: options.model,
      // Zero, because a translation that varies between runs is a translation
      // nobody can check.
      temperature: 0,
      system: [
        'You are a translation service inside a support system.',
        `Translate the message into ${options.target}.`,
        '',
        'Rules:',
        '- Translate. Never answer the message, never add to it, never explain it.',
        // The single most damaging failure here. An order number translated
        // into words, or a decimal point moved, turns a readable ticket into a
        // wrong one, and the agent has no reason to doubt it.
        '- Copy every number, order id, code, url and email address across exactly as written.',
        '- Keep the tone. An angry message stays angry.',
        '- If it is already in the target language, return it unchanged.',
        '',
        'Reply with JSON only, no prose and no code fence:',
        '{"language":"<BCP-47 code of the message you were given>","translation":"<the translation>"}',
      ].join('\n'),
      prompt: trimmed,
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })

    const parsed = parse(raw)

    if (!parsed) {
      console.warn('[helpdeck] the translation model did not return usable JSON')
      return { language: 'unknown', skipped: true }
    }

    // Same language in as out means there was nothing to do, and storing a
    // translation identical to the original just doubles what an agent reads.
    if (parsed.translation.trim() === trimmed || sameLanguage(parsed.language, options.target)) {
      return { language: parsed.language, skipped: true }
    }

    return { language: parsed.language, translation: parsed.translation, skipped: false }
  } catch (error) {
    console.warn(`[helpdeck] translation failed: ${error instanceof Error ? error.message : String(error)}`)
    return { language: 'unknown', skipped: true }
  }
}

/**
 * Reads the model's JSON, allowing for the ways models wrap it.
 *
 * Small models fence JSON in markdown and add a sentence before it however
 * firmly they are told not to, and a translation thrown away over a code fence
 * is a translation nobody gets.
 */
function parse(raw: string): { language: string; translation: string } | null {
  const withoutFence = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')

  if (start === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as {
      language?: unknown
      translation?: unknown
    }

    if (typeof parsed.translation !== 'string' || parsed.translation.trim().length === 0) {
      return null
    }

    return {
      language: typeof parsed.language === 'string' ? parsed.language.toLowerCase() : 'unknown',
      translation: parsed.translation,
    }
  } catch {
    return null
  }
}

/** `en`, `en-GB` and `English` all mean the same thing to a support team. */
function sameLanguage(a: string, b: string): boolean {
  const base = (value: string) => value.toLowerCase().split(/[-_]/)[0] ?? value.toLowerCase()
  return base(a) === base(b)
}

function isTargetEnglish(target: string): boolean {
  return sameLanguage(target, 'en') || target.trim().toLowerCase() === 'english'
}
