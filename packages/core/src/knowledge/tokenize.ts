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
 * Splits on anything that is not a letter or a digit. The unicode property
 * escapes keep accented Latin, Arabic, Cyrillic and Greek intact instead of
 * being thrown away a character at a time.
 */
const SPLIT = /[^\p{L}\p{N}]+/u

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

export function tokenize(text: string): string[] {
  const out: string[] = []

  for (const raw of text.toLowerCase().split(SPLIT)) {
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
