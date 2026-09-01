/**
 * A deliberately small tokeniser. No dictionary, no language model, no
 * dependency: it runs in every JavaScript runtime and costs microseconds, which
 * matters because it runs on every keystroke-length query in the hot path.
 */

/**
 * The usual English filler. Removing it stops "how do I cancel my account"
 * from matching every page that happens to contain "do" and "my".
 */
const STOPWORDS = new Set(
  (
    // Function words.
    'a about after all also am an and any are as at be because been before being but by can could did do ' +
    'does doing done down during each few for from further had has have having he her here hers him his how ' +
    'i if in into is it its just me more most my no nor not of off on once only or other our out over own ' +
    'same she should so some such than that the their them then there these they this those through to too ' +
    'under until up us very was we were what when where which while who whom why will with would you your yours ' +
    // Light verbs and fillers that carry no topic. Without these, a question
    // like "how long does delivery take" matches every page containing the
    // word "takes", which is most of them.
    'get gets got getting take takes taken taking make makes made making need needs want wants know known ' +
    'like see go going come came say says said tell tells ask asks please thanks thank hi hello ' +
    'one two many much lot really actually still even ever never always sure ok okay yes'
  ).split(' '),
)

/**
 * Light suffix normalisation, so "pause"/"pausing" and "ship"/"shipping"/
 * "shipped" collapse to one term. A full Porter stemmer buys very little more
 * on support content and costs several hundred lines of edge cases, but the
 * rules below are the ones that actually matter in practice:
 *
 * The order is deliberate. Stripping "-ing" from "pausing" leaves "paus", so
 * "pause" has to lose its silent "e" as well or the two never meet, which is
 * exactly the kind of miss that makes a keyword-only bot look stupid. Likewise
 * "shipping" leaves "shipp", which only matches "ship" once the doubled
 * consonant is collapsed.
 */
function hasVowel(word: string): boolean {
  return /[aeiouy]/.test(word)
}

/**
 * Suffixes that turn one part of speech into another without changing what the
 * word is about. "Freshness" is a heading, "stay fresh" is how somebody asks
 * about it, and a keyword index that cannot connect the two loses the answer.
 *
 * Deliberately short. Each entry earns its place by connecting words a support
 * corpus and a customer actually use; a longer list buys recall at the cost of
 * precision on every other query.
 */
const DERIVATIONS: Array<[string, string]> = [
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['iveness', 'ive'],
  ['ability', 'able'],
  ['ibility', 'ible'],
  ['ational', 'ate'],
  ['ization', 'ize'],
  ['fulness', 'ful'],
  ['ication', 'ify'],
  ['iveness', 'ive'],
  ['ousness', 'ous'],
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['ements', 'e'],
  ['ement', 'e'],
  ['ments', ''],
  ['ness', ''],
  ['ment', ''],
  ['ities', 'ity'],
  ['ance', ''],
  ['ence', ''],
  ['able', ''],
  ['ible', ''],
  ['ical', 'ic'],
  ['less', ''],
  ['ity', ''],
  ['ful', ''],
]

function stem(word: string): string {
  let out = word

  // Plurals first: they compose with nothing else.
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`
  else if (out.length > 4 && out.endsWith('sses')) out = out.slice(0, -2)
  else if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss') && !out.endsWith('us')) {
    out = out.slice(0, -1)
  }

  // Derivational endings, so a heading like "Freshness" and a question asking
  // "stay fresh" land on the same term. Ordered longest first, applied once,
  // and guarded on what is left behind: over-stemming costs precision on every
  // query, so nothing here fires on a short word.
  for (const [suffix, replacement] of DERIVATIONS) {
    if (out.length > suffix.length + 3 && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length) + replacement
      break
    }
  }

  // Verb endings, only when something pronounceable is left behind.
  if (out.length > 5 && out.endsWith('ing') && hasVowel(out.slice(0, -3))) out = out.slice(0, -3)
  else if (out.length > 4 && out.endsWith('ed') && hasVowel(out.slice(0, -2))) out = out.slice(0, -2)

  // Collapse a doubled final consonant, applied to every word rather than only
  // to stripped ones so "call" and "calling" land on the same term.
  const last = out.slice(-1)
  if (out.length > 3 && out.slice(-2) === `${last}${last}` && !'sz'.includes(last)) {
    out = out.slice(0, -1)
  }

  // Silent trailing "e". Guarded on length so "use" does not collapse onto "us".
  if (out.length > 4 && out.endsWith('e')) out = out.slice(0, -1)

  return out
}

/**
 * Splits on anything that is not part of a word.
 *
 * Combining marks count. A vowel sign is not a letter, so a rule of "letters
 * and digits" cut words apart at their own vowels: Arabic for "delivery"
 * written with the marks a careful writer types came out as two fragments that
 * matched neither each other nor the plain spelling of the same word, and Thai
 * came apart the same way.
 */
const SPLIT = /[^\p{L}\p{N}\p{M}]+/u

/**
 * Scripts that put no spaces between words.
 *
 * Splitting on spaces is a definition of "word" that half the world does not
 * use. A Japanese sentence has none, so the rule above returned the entire
 * sentence as one term, and a term that long matches only an identical
 * sentence: a shop whose pages are in Japanese or Chinese retrieved nothing at
 * all, silently, and the agent reported that it had no information on a
 * subject it had a page about.
 *
 * Hangul is absent on purpose. Korean is written with spaces, so it wants the
 * ordinary path.
 */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u

/** Runs of unspaced script, and runs of everything else, in order. */
const RUNS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]+/gu

/**
 * Overlapping character pairs, which is how you index a script with no word
 * boundaries and no dictionary to find them with.
 *
 * A pair is short enough to survive whatever the real boundary turns out to
 * be, and specific enough to rank: a query and a page that discuss the same
 * thing share pairs even when neither knows where the words end. Single
 * characters are kept as themselves, because plenty of them are whole words.
 *
 * The alternative is a morphological analyser, which means a dictionary per
 * language, megabytes of it, in a plugin whose entire argument is that it runs
 * on shared hosting.
 */
function pairs(run: string): string[] {
  const characters = [...run]
  if (characters.length === 1) return characters

  const out: string[] = []
  for (let at = 0; at + 1 < characters.length; at++) out.push(`${characters[at]}${characters[at + 1]}`)

  return out
}

/**
 * Marks that are optional to write and never change which word it is.
 *
 * Arabic vowel marks and Hebrew points are pronunciation aids. Most writing
 * omits them, some includes them, and the same word appears both ways in one
 * corpus, so a reader who types the careful spelling must still find the plain
 * one. Tatweel is pure typography: a stretched letter for justification.
 *
 * Thai vowel signs are deliberately not here. Those are not optional;
 * removing one leaves a different word.
 */
const OPTIONAL_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g

/**
 * Spellings of one Arabic letter that writers use interchangeably.
 *
 * The hamza on an alef is dropped constantly in ordinary typing, final ya and
 * alef maqsura are the same key to most people, and ta marbuta against ha is
 * the single most common Arabic misspelling there is. Collapsing them is what
 * every Arabic search does, because a customer who writes a word the ordinary
 * way should still find the page that spelled it carefully.
 */
const ARABIC_FORMS: Array<[RegExp, string]> = [
  [/[\u0622\u0623\u0625\u0671]/g, '\u0627'],
  [/\u0649/g, '\u064A'],
  [/\u0629/g, '\u0647'],
  [/[\u06CC]/g, '\u064A'],
  [/[\u06A9]/g, '\u0643'],
]

/** One spelling per word, before anything tries to match two of them. */
function normalise(text: string): string {
  let out = text.normalize('NFC').replace(OPTIONAL_MARKS, '')
  for (const [pattern, replacement] of ARABIC_FORMS) out = out.replace(pattern, replacement)

  return out
}

export function tokenize(text: string): string[] {
  const out: string[] = []

  // Composed first, so one spelling produces one term. The same "café" arrives
  // as four characters from one editor and five from another, and without this
  // the two are different words that never match: the accent is its own
  // character in the second, and a rule that keeps combining marks would keep
  // them apart rather than throwing the accent away.
  for (const raw of normalise(text).toLowerCase().split(SPLIT)) {
    if (!raw) continue

    // The common path, unchanged. Checked first because it is nearly always
    // the answer and the test is one regex against a short string.
    if (!UNSPACED.test(raw)) {
      if (raw.length < 2 || raw.length > 40) continue
      if (STOPWORDS.has(raw)) continue
      out.push(stem(raw))
      continue
    }

    // Mixed, which is ordinary rather than exotic: a Japanese sentence naming
    // an English product, a Chinese page with a model number in it.
    for (const run of raw.match(RUNS) ?? []) {
      if (UNSPACED.test(run)) {
        out.push(...pairs(run))
        continue
      }

      if (run.length < 2 || run.length > 40) continue
      if (STOPWORDS.has(run)) continue
      out.push(stem(run))
    }
  }

  return out
}
