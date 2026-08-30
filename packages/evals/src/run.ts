/**
 * Running the suites.
 *
 * A runner, not a framework. It builds an index from a corpus, asks the agent
 * each question, and grades what came back. Everything configurable lives in
 * the suite files rather than here, so adding a case never means editing code.
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { buildIndex, createAgent, createEmbedder, createRetriever, textSource, parseIndex } from 'helpdeck'
import type { Document, KnowledgeIndex, LanguageModel } from './types.js'
import { citationsIn, grade, isRefusal, type Observed } from './grade.js'
import { parseSuite, type CaseResult, type EvalCase } from './case.js'
import { testActions } from './actions.js'

export interface RunOptions {
  /** Where the corpora and suites live. */
  root: string
  /** The model under test. Omit to run only the cases that need no model. */
  model?: LanguageModel
  /** Named for the results file, so runs are comparable across models. */
  modelName: string
  /** Passages retrieved per question. */
  topK?: number
  /** Prints each case as it finishes. */
  onCase?: (result: CaseResult) => void
  /** Caps a single case, so one hung request cannot stall a whole suite. */
  timeoutMs?: number
  /**
   * Only the first n cases of each suite.
   *
   * A full local run is several minutes of the machine being unusable for
   * anything else. A slice is how you check a change without paying that.
   */
  limit?: number
  /**
   * Adds vector search, using an OpenAI-compatible embeddings endpoint.
   *
   * Off by default, so the retrieval suite stays a deterministic thing CI can
   * run with no credential. Some cases genuinely need it: no keyword index can
   * connect "money back" to a page that only ever says "refund".
   */
  embed?: { baseURL: string; apiKey?: string; model: string }
}

const FALLBACK = "I can't find that in our help pages. Email hello@lumen.example and a human will pick it up today."

/** The classifier's own refusal lines, so a screened turn grades as a refusal. */
const REFUSALS = [
  FALLBACK,
  'I can only help with questions about our products and your orders.',
  'I want to help, but I need us to keep this civil.',
]

export interface SuiteRun {
  suite: string
  results: CaseResult[]
}

export async function run(suites: string[], options: RunOptions): Promise<SuiteRun[]> {
  const corpora = new Map<string, KnowledgeIndex>()

  async function indexFor(name: string): Promise<KnowledgeIndex> {
    const existing = corpora.get(name)
    if (existing) return existing

    const documents = JSON.parse(
      await readFile(join(options.root, 'corpora', `${name}.json`), 'utf8'),
    ) as Document[]

    // Keyword-only on purpose: no `embedder` is passed. Embeddings would make
    // the retrieval suite depend on a credential and on an embedding model's
    // version, which is exactly the kind of drift a regression suite exists to
    // detect rather than to contain.
    const embedder = options.embed
      ? createEmbedder({ model: options.embed.model, baseURL: options.embed.baseURL, apiKey: options.embed.apiKey })
      : undefined

    const built = await buildIndex({ sources: [textSource(documents)], ...(embedder ? { embedder } : {}) })
    corpora.set(name, built)
    return built
  }

  const runs: SuiteRun[] = []

  for (const path of suites) {
    const suite = basename(path).replace(/\.jsonl$/, '')
    const all = parseSuite(await readFile(path, 'utf8'), suite)
    const cases = options.limit ? all.slice(0, options.limit) : all
    const results: CaseResult[] = []

    for (const item of cases) {
      const needsModel = !isRetrievalOnly(item)
      if (needsModel && !options.model) continue

      const result = await runCase(item, await indexFor(item.corpus ?? 'shop'), options)
      results.push(result)
      options.onCase?.(result)
    }

    runs.push({ suite, results })
  }

  return runs
}

/** A case that only asserts on retrieval needs no model and can run in CI. */
export function isRetrievalOnly(item: EvalCase): boolean {
  return (
    (item.mustRetrieve !== undefined || item.mustNotRetrieve !== undefined) &&
    item.mustContain === undefined &&
    item.mustNotContain === undefined &&
    item.mustCite === undefined &&
    item.mustRefuse === undefined &&
    item.mustCallAction === undefined
  )
}

async function runCase(
  item: EvalCase,
  index: KnowledgeIndex,
  options: RunOptions,
): Promise<CaseResult> {
  const started = Date.now()

  const embedder = options.embed
    ? createEmbedder({ model: options.embed.model, baseURL: options.embed.baseURL, apiKey: options.embed.apiKey })
    : undefined

  const retriever = createRetriever({ index, topK: options.topK ?? 6, ...(embedder ? { embedder } : {}) })
  const matches = await retriever.retrieve(item.question)
  const retrieved = matches.map((match) => match.chunk.docId)

  if (isRetrievalOnly(item) || !options.model) {
    return grade(item, {
      answer: '',
      cited: [],
      actions: [],
      retrieved,
      refused: false,
      ms: Date.now() - started,
    })
  }

  // A fresh log per case: sharing one would let an earlier case's call satisfy
  // a later case's assertion.
  const log = testActions()

  const agent = createAgent({
    index,
    model: options.model,
    embedder: embedder ?? false,
    topK: options.topK ?? 6,
    // A suite that samples cannot detect a regression. At the provider's
    // default temperature an intermittent failure is recorded as a pass or a
    // fail at random, and two such runs compared against each other produce a
    // conclusion neither supports. This measured 2 in 6 on one injection case,
    // which is the difference between a green suite and a red one on the same
    // build.
    temperature: 0,
    actions: log.actions,
    persona: { name: 'Nadia', business: 'Lumen Coffee Roasters', fallback: FALLBACK },
  })

  let answer = ''
  let error: string | undefined

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000)

  try {
    const result = await agent.answer(
      [...(item.history ?? []), { role: 'user', content: item.question }],
      [],
      { signal: controller.signal },
    )
    answer = result.text
    error = result.error
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  } finally {
    clearTimeout(timeout)
  }

  const observed: Observed = {
    // A provider failure is not a wrong answer, and grading it as one would
    // quietly turn an outage into a quality regression.
    answer: error ? `[error] ${error}` : answer,
    cited: citationsIn(answer),
    actions: log.called,
    retrieved,
    refused: isRefusal(answer, REFUSALS),
    ms: Date.now() - started,
  }

  const graded = grade(item, observed)
  if (error) graded.failures.unshift(`the provider failed: ${error}`)
  return { ...graded, passed: graded.failures.length === 0 }
}

/** Loads a previously recorded run, for comparing against it. */
export async function loadBaseline(path: string): Promise<Record<string, boolean> | null> {
  try {
    const saved = JSON.parse(await readFile(path, 'utf8')) as {
      cases: Array<{ id: string; passed: boolean }>
    }
    return Object.fromEntries(saved.cases.map((item) => [item.id, item.passed]))
  } catch {
    return null
  }
}

export { parseIndex }
