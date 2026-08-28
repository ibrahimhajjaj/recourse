#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { streamText } from 'ai'
import { ingest, writeIndex } from '../ingest.js'
import { parseIndex } from '../knowledge/serialize.js'
import { createRetriever } from '../retrieve/retriever.js'
import { canReachGateway, createEmbedder } from '../embed.js'
import { buildInstructions } from '../server/prompt.js'
import type { ProgressEvent } from '../types.js'
import { list, num, parseArgs } from './args.js'

const DEFAULT_OUT = 'helpdeck/knowledge.json'

const HELP = `
helpdeck: a support agent trained on your own content

Usage
  helpdeck ingest --url <site>        Learn a website and write the knowledge index
  helpdeck ingest --path <dir>        Learn a folder of markdown instead
  helpdeck ask "<question>"           Ask the index a question from the terminal
  helpdeck stats                      Show what is in the index

Options
  --index <file>    Path to the knowledge index        (default ${DEFAULT_OUT})
  --max-pages <n>   Cap on pages fetched              (default 50)
  --include <a,b>   Only paths containing these
  --exclude <a,b>   Skip paths containing these
  --embed           Force embeddings on, fail without a credential
  --no-embed        Keyword-only index, no credentials needed at all
  --embed-url <u>   Any OpenAI-compatible embeddings endpoint, such as a local
                    Ollama on http://localhost:11434/v1
  --embed-model <m> Embedding model on that endpoint  (default nomic-embed-text)
  --retrieve-only   For ask: show the matched passages, do not call a model
  --model <id>      Chat model through the Vercel AI Gateway
  --top-k <n>       Passages retrieved per question    (default 6)

Credentials
  None are required. FIRECRAWL_API_KEY raises crawl limits, and
  AI_GATEWAY_API_KEY enables embeddings and answers locally. On Vercel the
  Gateway authenticates itself through OIDC with nothing to configure.
`

async function main(): Promise<number> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2))

  if (!command || flags.help || command === 'help') {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  switch (command) {
    case 'ingest':
      return runIngest(flags)
    case 'ask':
      return runAsk(positionals.join(' '), flags)
    case 'stats':
      return runStats(flags)
    default:
      process.stderr.write(`unknown command: ${command}\n${HELP}\n`)
      return 1
  }
}

async function runIngest(flags: Record<string, string | boolean>): Promise<number> {
  const url = typeof flags.url === 'string' ? flags.url : undefined
  const path = typeof flags.path === 'string' ? flags.path : undefined

  if (!url && !path) {
    process.stderr.write('ingest needs --url <site> or --path <dir>\n')
    return 1
  }

  const out = indexPath(flags)
  const started = Date.now()

  const index = await ingest({
    url,
    path,
    maxPages: num(flags['max-pages'], 50),
    include: list(flags.include),
    exclude: list(flags.exclude),
    embed: typeof flags.embed === 'boolean' ? flags.embed : undefined,
    embedBaseURL: typeof flags['embed-url'] === 'string' ? flags['embed-url'] : undefined,
    embedModel: typeof flags['embed-model'] === 'string' ? flags['embed-model'] : undefined,
    embedApiKey: typeof flags['embed-key'] === 'string' ? flags['embed-key'] : undefined,
    onProgress: progress(),
  })

  await writeIndex(out, index)

  const size = (await stat(out)).size
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  process.stderr.write('\n')
  process.stdout.write(
    [
      `Indexed ${index.stats.documents} documents into ${index.stats.chunks} chunks in ${seconds}s`,
      `Retrieval: ${index.vectors ? 'hybrid (keyword + vectors)' : 'keyword only'}`,
      `Written to ${displayPath(out)} (${(size / 1024).toFixed(0)} KB)`,
      '',
      'Next:',
      `helpdeck ask "how do I get a refund?" --retrieve-only${flagSuffix(flags)}`,
      '',
    ].join('\n'),
  )

  if (!index.vectors) {
    process.stdout.write(
      'Tip: set AI_GATEWAY_API_KEY and re-run to add vector search for better paraphrase matching.\n\n',
    )
  }

  return 0
}

async function runAsk(question: string, flags: Record<string, string | boolean>): Promise<number> {
  if (!question.trim()) {
    process.stderr.write('ask needs a question: helpdeck ask "how do I cancel?"\n')
    return 1
  }

  const index = await loadIndex(flags)
  const embedder = index.vectors ? embedderFor(index.vectors.model, flags) : undefined
  const retriever = createRetriever({ index, embedder, topK: num(flags['top-k'], 6) })
  const matches = await retriever.retrieve(question)

  if (matches.length === 0) {
    process.stdout.write('Nothing in the index matched that question.\n')
    return 0
  }

  if (flags['retrieve-only'] === true || !canReachGateway()) {
    if (!canReachGateway() && flags['retrieve-only'] !== true) {
      process.stdout.write('No AI_GATEWAY_API_KEY set, showing retrieved passages instead of an answer.\n\n')
    }
    for (const [position, match] of matches.entries()) {
      const heading = headingOf(match.chunk.title, match.chunk.section)
      process.stdout.write(
        `[${position + 1}] ${heading}  (${match.from.join('+')}, ${match.score.toFixed(4)})\n` +
          `${match.chunk.text.slice(0, 300).replace(/\s+/g, ' ')}...\n` +
          `${match.chunk.url ?? ''}\n\n`,
      )
    }
    return 0
  }

  const result = streamText({
    model: typeof flags.model === 'string' ? flags.model : 'openai/gpt-4o-mini',
    instructions: buildInstructions({}, matches),
    messages: [{ role: 'user', content: question }],
  })

  for await (const delta of result.textStream) process.stdout.write(delta)

  process.stdout.write('\n\nSources:\n')
  for (const [position, match] of matches.entries()) {
    process.stdout.write(`  [${position + 1}] ${match.chunk.url ?? match.chunk.title}\n`)
  }

  return 0
}

async function runStats(flags: Record<string, string | boolean>): Promise<number> {
  const index = await loadIndex(flags)
  const terms = Object.keys(index.keyword.postings).length

  process.stdout.write(
    [
      `Built:      ${index.createdAt}`,
      `Documents:  ${index.stats.documents}`,
      `Chunks:     ${index.stats.chunks}`,
      `Characters: ${index.stats.characters.toLocaleString('en-US')}`,
      `Terms:      ${terms.toLocaleString('en-US')}`,
      `Vectors:    ${index.vectors ? `${index.stats.embedded} x ${index.vectors.dimensions}d (${index.vectors.model})` : 'none, keyword-only'}`,
      '',
    ].join('\n'),
  )

  return 0
}

/**
 * The heading trail already starts at the page's own H1, which is usually the
 * title too, so joining them blindly prints it twice.
 */
function headingOf(title: string, section?: string): string {
  if (!section) return title
  if (section === title) return title
  if (section.startsWith(`${title} > `)) return section
  return `${title} > ${section}`
}

/**
 * Rebuilds the embedder the index was written with. A query vector has to come
 * from the same model as the stored ones or the distances are meaningless, so
 * the model name travels inside the index rather than being guessed here.
 */
function embedderFor(storedModel: string, flags: Record<string, string | boolean>) {
  const model = storedModel.replace(/^(gateway|endpoint|provider):/, '')
  const baseURL = typeof flags['embed-url'] === 'string' ? flags['embed-url'] : undefined
  return createEmbedder({
    model,
    baseURL,
    apiKey: typeof flags['embed-key'] === 'string' ? flags['embed-key'] : undefined,
  })
}

/** One flag for the index path, so ingest and ask can never disagree on it. */
function indexPath(flags: Record<string, string | boolean>): string {
  const value = flags.index ?? flags.out
  return resolve(typeof value === 'string' ? value : DEFAULT_OUT)
}

async function loadIndex(flags: Record<string, string | boolean>) {
  const path = indexPath(flags)
  try {
    return parseIndex(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`no index at ${displayPath(path)}. Run \`helpdeck ingest --url <site>\` first.`)
    }
    throw error
  }
}

/**
 * A path inside the project reads better relative; one outside it turns into a
 * ladder of `../..` that is harder to read than the absolute path.
 */
function displayPath(path: string): string {
  const relative_ = relative(process.cwd(), path)
  return relative_.startsWith('..') ? path : relative_
}

/** Repeats a non-default --index so the printed next step actually runs. */
function flagSuffix(flags: Record<string, string | boolean>): string {
  const value = flags.index ?? flags.out
  return typeof value === 'string' ? ` --index ${value}` : ''
}

/** Progress on stderr so stdout stays clean enough to pipe. */
function progress(): (event: ProgressEvent) => void {
  let last = ''
  const interactive = process.stderr.isTTY === true

  return (event) => {
    const count = event.total ? ` ${event.done ?? 0}/${event.total}` : ''
    const line = `  ${event.phase}${count}  ${event.message}`.slice(0, 100)
    if (line === last) return
    last = line
    // Redrawing one line is nice in a terminal and unreadable in a log file.
    process.stderr.write(interactive ? `\r${' '.repeat(100)}\r${line}` : `${line}\n`)
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
