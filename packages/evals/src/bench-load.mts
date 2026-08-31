/**
 * What the library costs per turn, with the model taken out of it.
 *
 * A load test against a real model measures the provider, which is neither
 * ours to fix nor stable enough to compare two builds with. This drives the
 * whole path around the model instead, so what it reports is the part this
 * repository is responsible for: retrieval, the safety classifier on the way
 * in and on every sentence on the way out, and the store write.
 *
 *   npx tsx src/bench-load.mts [--clients 32] [--seconds 10] [--docs 500]
 *
 * Screening is measured both ways, because it became the default today and
 * the honest question about that decision is what it costs.
 */

import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { memoryStore } from '@recourse-ai/core/store'
import type { KnowledgeIndex } from '@recourse-ai/core'

const flag = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : Number(process.argv[at + 1])
}

const CLIENTS = flag('clients', 32)
const SECONDS = flag('seconds', 10)
const DOCS = flag('docs', 500)
const ROUNDS = flag('rounds', 5)

/** A believable answer: several sentences, a citation, no model behind it. */
const ANSWER =
  'Delivery to Ireland takes 3 to 5 working days [1]. ' +
  'Orders over 30 pounds ship free, and anything ordered before 2pm goes the same day. ' +
  'If it has not arrived within a week, tell me the order number and I will chase the courier.'

function instantModel() {
  // The chunk union the mock accepts is wider than what a double emits, and
  // the type that describes it lives in `@ai-sdk/provider`, which is not a
  // dependency here and should not become one for a benchmark. The shape is
  // checked by the mock at runtime either way.
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '0' },
          ...ANSWER.split(' ').map((word, position) => ({
            type: 'text-delta' as const,
            id: '0',
            delta: position === 0 ? word : ` ${word}`,
          })),
          { type: 'text-end' as const, id: '0' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop', raw: 'stop' } as const,
            usage: { inputTokens: 900, outputTokens: 60, totalTokens: 960 },
          },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  } as ConstructorParameters<typeof MockLanguageModelV4>[0])
}

async function corpus(): Promise<KnowledgeIndex> {
  // Enough pages that retrieval is doing real work rather than scanning three.
  const documents = Array.from({ length: DOCS }, (_, n) => ({
    id: `doc-${n}`,
    title: `Help page ${n}`,
    url: `https://shop.example/help/${n}`,
    text:
      `# Help page ${n}\n\nDelivery to Ireland takes 3-5 working days. ` +
      `Returns are accepted within 30 days of delivery. Order ${n} shipped from the roastery. ` +
      `Free delivery over 30 pounds. Subscriptions can be paused for a month at a time.`,
  }))

  return buildIndex({ sources: [textSource(documents)] })
}

function percentile(sorted: number[], nth: number): number {
  if (sorted.length === 0) return 0
  const at = Math.min(sorted.length - 1, Math.floor((nth / 100) * sorted.length))
  return sorted[at] as number
}

interface Round {
  throughput: number
  p50: number
  p95: number
  failures: number
}

async function measure(index: KnowledgeIndex, screening: boolean): Promise<Round> {
  const agent = createAgent({
    index,
    model: instantModel(),
    embedder: false,
    store: memoryStore(),
    temperature: 0,
    persona: { name: 'Ada', business: 'Lumen Coffee Roasters' },
    ...(screening ? {} : { classifier: { output: false as const } }),
  })

  const questions = [
    'how long is delivery to ireland',
    'can I return an engraved mug',
    'do you ship to a PO box',
    'how do I pause my subscription',
  ]

  const latencies: number[] = []
  const deadline = Date.now() + SECONDS * 1000
  let failures = 0

  const client = async (slot: number): Promise<void> => {
    for (let turn = 0; Date.now() < deadline; turn++) {
      const started = performance.now()
      try {
        // A new conversation each turn. Reusing one grows its history all
        // round, so every turn carries more than the last and the numbers
        // measure the length of the benchmark rather than the cost of a turn.
        await agent.answer(questions[(slot + turn) % questions.length] as string, [], {
          conversationId: `bench-${slot}-${turn}`,
        })
        latencies.push(performance.now() - started)
      } catch (error) {
        failures++
        if (failures === 1) console.error(`  turn failed: ${error instanceof Error ? error.message : error}`)
      }
    }
  }

  const wall = performance.now()
  await Promise.all(Array.from({ length: CLIENTS }, (_, slot) => client(slot)))
  const elapsed = (performance.now() - wall) / 1000

  latencies.sort((a, b) => a - b)
  return {
    throughput: latencies.length / elapsed,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    failures,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[half - 1] as number) + (sorted[half] as number)) / 2
    : (sorted[half] as number)
}

async function main(): Promise<void> {
  console.log(`building an index of ${DOCS} pages`)
  const index = await corpus()

  console.log(`\n${CLIENTS} concurrent clients, ${SECONDS}s a round, no model in the way`)
  console.log(`${ROUNDS} rounds each way, alternating\n`)

  const results: Record<'on' | 'off', Round[]> = { on: [], off: [] }
  let dropped = 0

  // Alternating rather than one block each, and reported as a median of
  // rounds. Run as two blocks this machine gave 29 then 50 turns a second and
  // then 22, 24, 35, 41: the ordering moved the number more than the setting
  // being measured did, so a single pass of each was measuring warm-up.
  for (let round = 0; round <= ROUNDS; round++) {
    const on = await measure(index, true)
    const off = await measure(index, false)

    // Round zero is the warm-up and is thrown away.
    if (round === 0) continue

    // A round that completed no turns measured nothing. It happens on a busy
    // machine when a collection pause outlasts the round, and averaging it in
    // as zero would report the pause as the thing being measured.
    if (on.throughput > 0) results.on.push(on)
    if (off.throughput > 0) results.off.push(off)
    dropped += (on.throughput > 0 ? 0 : 1) + (off.throughput > 0 ? 0 : 1)
  }

  if (results.on.length === 0 || results.off.length === 0) {
    console.log('  every round stalled. This machine is too busy to measure anything.')
    return
  }

  if (dropped > 0) {
    console.log(`  ${dropped} round(s) completed no turns and were dropped\n`)
  }

  const ms = (value: number) => `${value.toFixed(0)}ms`
  const show = (label: string, rounds: Round[]) => {
    const throughput = rounds.map((one) => one.throughput)
    console.log(
      `  ${label.padEnd(14)}` +
        `${median(throughput).toFixed(0).padStart(5)} turns/s` +
        `  (${Math.min(...throughput).toFixed(0)} to ${Math.max(...throughput).toFixed(0)})` +
        `   p50 ${ms(median(rounds.map((one) => one.p50))).padStart(7)}` +
        `   p95 ${ms(median(rounds.map((one) => one.p95))).padStart(7)}` +
        (rounds.some((one) => one.failures > 0)
          ? `   ${rounds.reduce((sum, one) => sum + one.failures, 0)} failed`
          : ''),
    )
  }

  show('screening on', results.on)
  show('screening off', results.off)

  const on = median(results.on.map((one) => one.throughput))
  const off = median(results.off.map((one) => one.throughput))
  const spread = Math.max(...results.on.map((one) => one.throughput)) -
    Math.min(...results.on.map((one) => one.throughput))

  console.log(
    Math.abs(on - off) < spread
      ? '\n  The difference between them is smaller than the spread within one of\n' +
          '  them, so this machine cannot tell them apart. That is the result.'
      : `\n  Screening ${on > off ? 'costs nothing measurable here' : `costs about ${(((off - on) / off) * 100).toFixed(0)}%`}.`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
