/**
 * What each piece of a turn costs, measured on its own.
 *
 * The concurrency benchmark next door answers a different question and answers
 * it badly on a busy machine: turns a second moved between 20 and 40 on the
 * same build, because it is competing with everything else running. These
 * numbers do not, because each one is sub-millisecond and taken as a median of
 * thousands, so a scheduler hiccup lands in the tail rather than in the middle.
 *
 *   npx tsx src/bench-parts.mts [--docs 500] [--rounds 2000]
 *
 * Add them up and you have the per-turn cost of everything this repository is
 * responsible for. Whatever is left over in a real deployment is the model,
 * which takes seconds and is the provider's to answer for.
 */

import { buildIndex, createRetriever, textSource } from 'recourse'
import { createClassifier } from 'recourse/safety'
import { memoryStore } from 'recourse/store'

const flag = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : Number(process.argv[at + 1])
}

const DOCS = flag('docs', 500)
const ROUNDS = flag('rounds', 2000)

const ANSWER =
  'Delivery to Ireland takes 3 to 5 working days [1]. ' +
  'Orders over 30 pounds ship free, and anything ordered before 2pm goes the same day. ' +
  'If it has not arrived within a week, tell me the order number and I will chase the courier.'

const QUESTIONS = [
  'how long is delivery to ireland',
  'can I return an engraved mug',
  'do you ship to a PO box',
  'how do I pause my subscription',
]

function percentile(sorted: number[], nth: number): number {
  const at = Math.min(sorted.length - 1, Math.floor((nth / 100) * sorted.length))
  return sorted[at] as number
}

/** Runs one thing many times and reports where the middle and the tail sit. */
async function time(what: string, rounds: number, run: (n: number) => unknown): Promise<number> {
  // Warmed first: the first few hundred runs of anything measure a JIT that
  // has not seen the path yet.
  for (let n = 0; n < Math.min(200, rounds); n++) await run(n)

  const taken: number[] = []
  for (let n = 0; n < rounds; n++) {
    const started = performance.now()
    await run(n)
    taken.push(performance.now() - started)
  }

  taken.sort((a, b) => a - b)
  const median = percentile(taken, 50)
  const us = (value: number) => (value < 1 ? `${(value * 1000).toFixed(0)}µs` : `${value.toFixed(2)}ms`)

  console.log(
    `  ${what.padEnd(34)}${us(median).padStart(8)}` +
      `   p95 ${us(percentile(taken, 95)).padStart(8)}` +
      `   p99 ${us(percentile(taken, 99)).padStart(8)}`,
  )

  return median
}

async function main(): Promise<void> {
  const documents = Array.from({ length: DOCS }, (_, n) => ({
    id: `doc-${n}`,
    title: `Help page ${n}`,
    url: `https://shop.example/help/${n}`,
    text:
      `# Help page ${n}\n\nDelivery to Ireland takes 3-5 working days. ` +
      `Returns are accepted within 30 days of delivery. Order ${n} shipped from the roastery. ` +
      `Free delivery over 30 pounds. Subscriptions can be paused for a month at a time.`,
  }))

  console.log(`indexing ${DOCS} pages`)
  const index = await buildIndex({ sources: [textSource(documents)] })

  const retriever = createRetriever({ index })
  const classifier = createClassifier()
  const store = memoryStore()

  // The output rules run once per sentence, which is what screening on by
  // default means, so this is the cost of one and the answer has three.
  const sentences = ANSWER.split('. ').map((one) => `${one}.`)

  console.log(`\n${ROUNDS} rounds each, median first\n`)

  const totals = [
    await time(`retrieval over ${DOCS} pages`, ROUNDS, (n) =>
      retriever.retrieve(QUESTIONS[n % QUESTIONS.length] as string),
    ),
    await time('screening the question', ROUNDS, (n) =>
      classifier.check(QUESTIONS[n % QUESTIONS.length] as string),
    ),
    await time('screening one sentence', ROUNDS, (n) =>
      classifier.checkOutput(sentences[n % sentences.length] as string, { sources: [ANSWER] }),
    ),
    await time('writing a turn to the store', ROUNDS, (n) =>
      store.appendMessage(`bench-${n}`, {
        id: `m-${n}`,
        role: 'assistant',
        content: ANSWER,
        createdAt: new Date().toISOString(),
      }),
    ),
  ]

  const [retrieval, input, sentence, write] = totals as [number, number, number, number]
  const perTurn = retrieval + input + sentence * sentences.length + write

  console.log(
    `\n  A turn is one of each, plus a screen per sentence: ${perTurn.toFixed(2)}ms\n` +
      `  Which is ${Math.round(1000 / perTurn)} turns a second on one core, before the model.\n` +
      '  A model answering in two seconds is a thousand times that, so what a\n' +
      '  deployment runs out of is provider concurrency rather than this.',
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
