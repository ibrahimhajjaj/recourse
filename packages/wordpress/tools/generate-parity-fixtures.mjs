/**
 * Records what the TypeScript implementation does, so the PHP port can be
 * asserted against it rather than eyeballed.
 *
 * Two implementations of one ranking is the risk this plugin takes on, and the
 * only thing that makes it survivable is a fixture the PHP tests read. Run this
 * after any change to the tokeniser, the chunker or BM25, and the PHP suite
 * will tell you what the port missed.
 *
 *   node tools/generate-parity-fixtures.mjs
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { tokenize } from '../../core/dist/knowledge/tokenize.js'
import { buildKeywordIndex, searchKeyword, queryTermCount } from '../../core/dist/knowledge/bm25.js'
import { markdownChunker } from '../../core/dist/chunk/index.js'
import { buildIndex } from '../../core/dist/knowledge/build.js'
import { createRetriever } from '../../core/dist/retrieve/retriever.js'
import { textSource } from '../../core/dist/sources/text.js'
import { buildInstructions } from '../../core/dist/server/prompt.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Words chosen because each one exercises a rule that is easy to port wrongly:
 * the plural rules, the derivational list, the doubled consonant, the silent
 * "e", and the guards that stop a short word being stemmed to nothing.
 *
 * The non-English entries are not decoration. A tokeniser written with
 * `strtolower` and `strlen` passes every English case and silently halves
 * recall on an Arabic or German site.
 */
const WORDS = [
  'pause', 'pausing', 'paused', 'pauses',
  'ship', 'shipping', 'shipped', 'ships',
  'freshness', 'fresh', 'refund', 'refunds', 'refunded', 'refunding',
  'delivery', 'deliveries', 'cancel', 'cancelled', 'cancellation',
  'subscription', 'subscriptions', 'availability', 'available',
  'happiness', 'careless', 'organization', 'international', 'management',
  'classes', 'glasses', 'analysis', 'status', 'business', 'address',
  'use', 'used', 'using', 'call', 'calling', 'called',
  'is', 'a', 'the', 'and', 'i', 'ok',
  'Größe', 'Grösse', 'CAFÉ', 'café', 'ÜBER',
  'فاتورة', 'الشحن', 'التوصيل',
  // The same word spelled the ways people actually spell it. Each pair has to
  // land on one term or a customer's spelling misses the page's.
  'التَّوْصِيل', 'أحمد', 'احمد', 'مدرسة', 'مدرسه', 'على', 'علي', 'كتابی',
  // No spaces, so these become pairs rather than one unmatchable term.
  '配送', '返品', '配送时间需要多久', '配送にはどのくらいかかりますか', '茶',
  // Written with spaces, so it must not become pairs.
  '배송은', '걸리나요',
  // A composed accent and a decomposed one, which are the same word.
  'caf\u00e9', 'cafe\u0301',
  'ORDER-1042', 'sku_88', '2026', 'v2.1',
]

const SENTENCES = [
  'How long does delivery take to Ireland?',
  'I want my money back on order 1042.',
  'Do you ship to the United Arab Emirates, and what does it cost?',
  'كيف يمكنني إرجاع الطلب؟',
  'كَيْفَ يُمْكِنُنِي إِرْجَاعُ الطَّلَب؟',
  '配送时间通常需要三天',
  'LUM-1234の配送はいつですか',
  '배송은 얼마나 걸리나요',
  'การจัดส่งใช้เวลานานเท่าไร',
  'Wie lange dauert der Versand nach Österreich?',
  '   ',
  'a the and of',
  'ORDER-1042 arrived cracked!!! Replacement please.',
]

/**
 * A corpus with the shapes that break a chunker: nested headings, a fenced
 * code block containing something that looks like a heading, a navigation run,
 * a paragraph over the size budget, and a section too small to stand alone.
 */
const DOCUMENTS = [
  {
    id: 'shipping',
    title: 'Shipping',
    url: 'https://shop.example/shipping',
    text: [
      '# Shipping',
      '',
      'We ship worldwide from our roastery in Bristol.',
      '',
      '## Delivery times',
      '',
      'United Kingdom orders arrive in 1-2 working days. Ireland and the EU take 3-5 working days.',
      '',
      '### Outside Europe',
      '',
      'The United States takes 4-7 working days. Everywhere else takes 7-14.',
      '',
      '## [​](/shipping#costs) Costs',
      '',
      'Delivery is free over £30.',
    ].join('\n'),
  },
  {
    id: 'returns',
    title: 'Returns',
    url: 'https://shop.example/returns',
    text: [
      '[Home](/)',
      '[Shop](/shop)',
      '[About](/about)',
      '[Contact](/contact)',
      '[Blog](/blog)',
      '',
      '# Returns',
      '',
      'Damaged items are replaced free of charge. Send a photo within 14 days.',
      '',
      '## Refunds',
      '',
      'Short.',
      '',
      '## The long one',
      '',
      `A very long paragraph that has to be split hard because there is no better seam inside it. ${'Coffee beans are roasted in small batches. '.repeat(60)}`,
      '',
      '```',
      '# this is not a heading',
      'curl https://shop.example/api',
      '```',
      '',
      'After the fence.',
    ].join('\n'),
  },
]

const QUERIES = [
  'how long does delivery take',
  'refund policy',
  'is delivery free',
  'do you ship to the united states',
  'money back',
  'bicycles',
  'shipping shipping shipping',
  'الشحن',
]

const chunker = markdownChunker()

const chunks = DOCUMENTS.flatMap((doc) => chunker.split(doc))
const searchable = chunks.map((chunk) =>
  [chunk.title, chunk.section, chunk.text].filter(Boolean).join('\n'),
)
const keyword = buildKeywordIndex(searchable)

const index = await buildIndex({ sources: [textSource(DOCUMENTS)] })
const retriever = createRetriever({ index })

const retrieval = {}
for (const query of QUERIES) {
  const matches = await retriever.retrieve(query)
  retrieval[query] = matches.map((match) => ({ id: match.chunk.id, score: match.score }))
}

/**
 * The answering rules, taken out of the built prompt.
 *
 * Six of these were added to both implementations by hand over one evening of
 * live testing, which is exactly how two ports drift apart. A rule that reaches
 * only the TypeScript side is a WordPress site answering "hello" with the
 * fallback long after the bug was fixed everywhere else.
 *
 * Only the dashed lines are compared. The persona sentence differs by
 * construction (one knows the site's name from WordPress), and the sources
 * block carries the documents, so neither belongs in a parity check.
 */
function answeringRules(instructions) {
  return instructions
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || /^\d+\. /.test(line))
}

const PROMPTS = {
  bare: buildInstructions({ matches: [] }),
  withActions: buildInstructions({
    matches: [],
    actions: [{ name: 'look_up_order', whenToUse: 'when they ask about an order', parameters: {} }],
  }),
  brisk: buildInstructions({ matches: [], persona: { tone: 'brisk' } }),
}

const fixture = {
  note: 'Generated by tools/generate-parity-fixtures.mjs. Do not edit by hand.',
  prompt: Object.fromEntries(
    Object.entries(PROMPTS).map(([name, text]) => [name, answeringRules(text)]),
  ),
  tokens: Object.fromEntries(WORDS.map((word) => [word, tokenize(word)])),
  sentences: Object.fromEntries(SENTENCES.map((sentence) => [sentence, tokenize(sentence)])),
  queryTermCounts: Object.fromEntries(QUERIES.map((query) => [query, queryTermCount(query)])),
  documents: DOCUMENTS,
  chunks,
  keyword,
  search: Object.fromEntries(
    QUERIES.map((query) => [query, searchKeyword(keyword, query, 10)]),
  ),
  retrieval,
}

const out = join(here, '..', 'tests', 'fixtures', 'parity.json')
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `wrote ${out}\n  ${WORDS.length} words, ${SENTENCES.length} sentences, ` +
    `${chunks.length} chunks, ${Object.keys(keyword.postings).length} terms, ${QUERIES.length} queries, ` +
    `${Object.values(fixture.prompt).flat().length} prompt rules`,
)
