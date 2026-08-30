#!/usr/bin/env -S npx tsx
/**
 * One command, a scored table, and a saved result file.
 *
 * The saved file is the point. A pass rate on its own tells you nothing;
 * a pass rate next to the last recorded one for the same model tells you
 * whether the change you just made was an improvement or a regression.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { loadBaseline, run, type SuiteRun } from './run.js'
import { headroom, tooTightToRun, unload } from './machine.js'
import type { LanguageModel } from './types.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The suites that exist, read rather than listed.
 *
 * Written out by hand this went stale the moment a suite was added, and help
 * text that names three of four is worse than none: it is read as the complete
 * list and the fourth is never run.
 */
function suiteNames(): string {
  return readdirSync(join(ROOT, 'suites'))
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace(/\.jsonl$/, ''))
    .sort()
    .join(' | ')
}

const HELP = `
helpdeck evals

Usage
  pnpm eval                          Retrieval suite only. No model, no credential.
  pnpm eval --model qwen3:4b         Every suite, against a local Ollama model.
  pnpm eval --suite injection        One suite.

Options
  --model <id>       The model under test. Without it, only the cases that
                     need no model run, which is what CI should do.
  --base-url <url>   An OpenAI-compatible endpoint (default a local Ollama on
                     http://localhost:11434/v1).
  --api-key <key>    For that endpoint. Ollama ignores it.
  --suite <name>     ${suiteNames()} | all   (default all)
  --top-k <n>        Passages retrieved per question (default 6).
  --timeout <ms>     Per case (default 120000).
  --embed            Add vector search, using --base-url with
                     --embed-model (default nomic-embed-text). Some cases
                     cannot pass without it.
  --embed-model <m>  The embedding model on that endpoint.
  --limit <n>        Only the first n cases of each suite. A local run is the
                     whole machine for its duration; this makes it a minute
                     rather than ten.
  --force            Start even when memory is tight.
  --keep-loaded      Leave the model in memory afterwards. By default it is
                     unloaded, because the next thing you do needs the RAM.
  --no-save          Skip writing results/<date>-<model>.json. Saved by default.
  --compare <file>   Compare against a recorded run and fail on a regression.
  --verbose          Print every case, not only the failures.
`

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.help) {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  const modelId = typeof flags.model === 'string' ? flags.model : undefined
  const model = modelId ? buildModel(modelId, flags) : undefined
  // The embedding setting is part of the run's identity: the same model with
  // and without vectors produces different numbers, and filing both under one
  // name would make the comparison meaningless.
  const modelName = `${modelId ?? 'no-model'}${flags.embed ? '+vectors' : ''}`

  const wanted = typeof flags.suite === 'string' ? flags.suite : 'all'
  const suites = (await readdir(join(ROOT, 'suites')))
    .filter((file) => file.endsWith('.jsonl'))
    .filter((file) => wanted === 'all' || file === `${wanted}.jsonl`)
    .sort()
    .map((file) => join(ROOT, 'suites', file))

  if (suites.length === 0) {
    process.stderr.write(`no suite matched "${wanted}"\n`)
    return 1
  }

  if (!model) {
    process.stdout.write('No --model given, so only the cases that need no model will run.\n\n')
  }

  // A local model takes the whole machine for as long as it runs. Better to
  // say so now than to have it discovered as a laptop that stopped responding.
  if (model && !flags.force) {
    const blocked = await tooTightToRun()
    if (blocked) {
      process.stderr.write(`${blocked}\n`)
      return 1
    }
  }

  if (model) {
    const { free, source } = await headroom()
    process.stdout.write(`${(free * 100).toFixed(0)}% memory free (${source})\n`)
  }

  const started = Date.now()
  const runs = await run(suites, {
    root: ROOT,
    model,
    modelName,
    topK: typeof flags['top-k'] === 'string' ? Number(flags['top-k']) : undefined,
    ...(flags.embed
      ? {
          embed: {
            baseURL: typeof flags['base-url'] === 'string' ? flags['base-url'] : 'http://localhost:11434/v1',
            apiKey: typeof flags['api-key'] === 'string' ? flags['api-key'] : 'ollama',
            model: typeof flags['embed-model'] === 'string' ? flags['embed-model'] : 'nomic-embed-text',
          },
        }
      : {}),
    timeoutMs: typeof flags.timeout === 'string' ? Number(flags.timeout) : undefined,
    ...(typeof flags.limit === 'string' ? { limit: Number(flags.limit) } : {}),
    onCase: (result) => {
      if (result.passed && !flags.verbose) return
      const mark = result.passed ? 'ok  ' : result.case.known ? 'known' : 'FAIL'
      process.stdout.write(`  ${mark} ${result.case.id}\n`)
      for (const failure of result.failures) process.stdout.write(`         ${failure}\n`)
      if (!result.passed && result.case.note) process.stdout.write(`         why: ${result.case.note}\n`)
      if (!result.passed && result.answer) {
        process.stdout.write(`         got: ${result.answer.replace(/\s+/g, ' ').slice(0, 160)}\n`)
      }
    },
  })

  // Handed back before anything else, including writing the results file: the
  // numbers are already in memory and the machine wants its RAM more.
  if (modelId && !flags['keep-loaded']) {
    const baseURL = typeof flags['base-url'] === 'string' ? flags['base-url'] : 'http://localhost:11434/v1'
    if (await unload(baseURL, modelId)) {
      process.stdout.write(`\nunloaded ${modelId}\n`)
    }
  }

  report(runs, modelName, Date.now() - started)

  // On by default. A pass rate on its own is a number that cannot be argued
  // with or learned from: the answers are where the next defect is, and the
  // one that mattered most on this suite was found by reading a reply rather
  // than a score. `--no-save` is there for a throwaway run.
  if (!flags['no-save']) {
    const path = await save(runs, modelName)
    process.stdout.write(`\nWritten to ${path}\n`)
  }

  const regressions = typeof flags.compare === 'string' ? await compare(runs, flags.compare) : []
  if (regressions.length > 0) {
    process.stdout.write(`\nRegressions against ${flags.compare}:\n`)
    for (const id of regressions) process.stdout.write(`  ${id} passed before and fails now\n`)
    return 1
  }

  // A known failure is recorded, not fatal. Anything else is.
  const broken = runs.flatMap((suite) => suite.results.filter((r) => !r.passed && !r.case.known))
  return broken.length > 0 ? 1 : 0
}

function report(runs: SuiteRun[], modelName: string, ms: number): void {
  process.stdout.write(`\n${modelName}\n`)

  let total = 0
  let passed = 0

  for (const suite of runs) {
    if (suite.results.length === 0) continue
    const ok = suite.results.filter((result) => result.passed).length
    const known = suite.results.filter((result) => !result.passed && result.case.known).length
    total += suite.results.length
    passed += ok

    const rate = ((ok / suite.results.length) * 100).toFixed(0)
    process.stdout.write(
      `  ${suite.suite.padEnd(12)} ${String(ok).padStart(3)}/${String(suite.results.length).padEnd(3)} ${rate.padStart(3)}%` +
        `${known > 0 ? `  (${known} known)` : ''}\n`,
    )
  }

  if (total === 0) {
    process.stdout.write('  nothing ran\n')
    return
  }

  process.stdout.write(
    `  ${'total'.padEnd(12)} ${String(passed).padStart(3)}/${String(total).padEnd(3)} ` +
      `${((passed / total) * 100).toFixed(0).padStart(3)}%   in ${(ms / 1000).toFixed(1)}s\n`,
  )
}

async function save(runs: SuiteRun[], modelName: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  const safe = modelName.replace(/[^a-z0-9.-]/gi, '-')
  const path = join(ROOT, 'results', `${date}-${safe}.json`)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify(
      {
        model: modelName,
        recordedAt: new Date().toISOString(),
        cases: runs.flatMap((suite) =>
          suite.results.map((result) => ({
            id: result.case.id,
            suite: suite.suite,
            passed: result.passed,
            known: result.case.known,
            failures: result.failures,
            // Kept so a later reader can see what the model actually said,
            // which is the only way to tell a real regression from a reworded
            // but still correct answer.
            answer: result.answer.replace(/\s+/g, ' ').slice(0, 400),
            ms: result.ms,
          })),
        ),
      },
      null,
      2,
    )}\n`,
  )

  return path
}

async function compare(runs: SuiteRun[], path: string): Promise<string[]> {
  const baseline = await loadBaseline(resolve(path))
  if (!baseline) {
    process.stderr.write(`could not read ${path}, skipping the comparison\n`)
    return []
  }

  return runs
    .flatMap((suite) => suite.results)
    .filter((result) => !result.passed && baseline[result.case.id] === true)
    .map((result) => result.case.id)
}

function buildModel(id: string, flags: Record<string, string | boolean>): LanguageModel {
  const baseURL = typeof flags['base-url'] === 'string' ? flags['base-url'] : 'http://localhost:11434/v1'
  const apiKey = typeof flags['api-key'] === 'string' ? flags['api-key'] : 'ollama'
  return createOpenAICompatible({ name: 'evals', baseURL, apiKey })(id)
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {}

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string
    if (!argument.startsWith('--')) continue

    const name = argument.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags[name] = next
      index++
    } else {
      flags[name] = true
    }
  }

  return flags
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
