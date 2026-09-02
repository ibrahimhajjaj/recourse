import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { streamText } from 'ai'
import { ingest, writeIndex } from '../ingest.js'
import { parseIndex } from '../knowledge/serialize.js'
import { createRetriever } from '../retrieve/retriever.js'
import { canReachGateway, createEmbedder } from '../embed.js'
import { buildInstructions } from '../server/prompt.js'
import type { ProgressEvent } from '../types.js'
import { init, model as chooseModel } from './init.js'
import { list, num, parseArgs } from './args.js'
import { checkCredentials, checkModel, checkStorage, exitCodeFor, formatChecks, type Check } from './doctor.js'

const DEFAULT_OUT = 'recourse/knowledge.json'

const HELP = `
recourse: a support agent trained on your own content

Usage
  recourse init                       Set it up here: learn, wire the endpoint, print
                                      the widget snippet
  recourse model                      Choose how it answers, or change it later
  recourse plan --url <site>          List what a crawl would read, without reading it
  recourse ingest --url <site>        Learn a website and write the knowledge index
  recourse ingest --path <dir>        Learn a folder of markdown instead
  recourse ask "<question>"           Ask the index a question from the terminal
  recourse stats                      Show what is in the index
  recourse doctor                     Check the index, the model and any
                                      credentials you pass, before a customer
                                      finds the problem for you

Options
  --index <file>    Path to the knowledge index        (default ${DEFAULT_OUT})
  --max-pages <n>   Cap on pages fetched              (default 50)
  --include <a,b>   Only paths containing these
  --exclude <a,b>   Skip paths containing these
  --embed           Force embeddings on, fail without a credential
  --no-embed        Keyword-only index, no credentials needed at all
  --fresh           Re-embed everything, ignoring the index already there
  --embed-url <u>   Any OpenAI-compatible embeddings endpoint, such as a local
                    Ollama on http://localhost:11434/v1
  --embed-model <m> Embedding model on that endpoint  (default nomic-embed-text)
  --no-install      For init: write the files but add no dependency
  --provider <p>    For init: local, gateway, compatible or later, without asking
  --retrieve-only   For ask: show the matched passages, do not call a model
  --model <id>      Chat model through the Vercel AI Gateway
  --top-k <n>       Passages retrieved per question    (default 6)

Credentials
  None are required. FIRECRAWL_API_KEY raises crawl limits, and
  AI_GATEWAY_API_KEY enables embeddings and answers locally. On Vercel the
  Gateway authenticates itself through OIDC with nothing to configure.
`

/** Everything the commands write to or read the working directory from. */
export interface Io {
  out: (line: string) => void
  err: (line: string) => void
  cwd: string
}

/**
 * Built per call rather than held as a constant, so the working directory is
 * whatever it is when a command runs rather than whatever it was when the
 * module happened to load.
 */
function processIo(): Io {
  return {
    out: (line) => process.stdout.write(line),
    err: (line) => process.stderr.write(line),
    cwd: process.cwd(),
  }
}

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv)

  if (!command || flags.help || command === 'help') {
    io.out(`${HELP}\n`)
    return 0
  }

  switch (command) {
    case 'init':
      return runInit(flags, io)
    case 'model':
      return chooseModel({
        cwd: io.cwd,
        write: io.out,
        ...(typeof flags.provider === 'string' ? { provider: flags.provider as never } : {}),
      })
    case 'ingest':
      return runIngest(flags, io)
    case 'plan':
      return runPlan(flags, io)
    case 'ask':
      return runAsk(positionals.join(' '), flags, io)
    case 'stats':
      return runStats(flags, io)
    case 'doctor':
      return runDoctor(flags, io)
    default:
      io.err(`unknown command: ${command}\n${HELP}\n`)
      return 1
  }
}

/**
 * Shows what an ingest would read, before it reads it.
 *
 * The usual problem with a knowledge base is not a page that failed but one
 * that succeeded and should not have: a login screen, a privacy policy, ten
 * years of press releases. Those only show up later, as an agent answering
 * questions nobody asked, and the crawl has already been paid for.
 *
 * Reads the sitemap and stops. No page is fetched and nothing is charged.
 */
async function runPlan(flags: Record<string, string | boolean>, io: Io): Promise<number> {
  const url = typeof flags.url === 'string' ? flags.url : undefined

  if (!url) {
    io.err('plan needs --url <site>\n')
    return 1
  }

  const { planCrawl } = await import('../sources/website.js')

  const plan = await planCrawl({
    url,
    ...(typeof flags.max === 'string' ? { maxPages: Number(flags.max) } : {}),
    ...(typeof flags.exclude === 'string' ? { exclude: flags.exclude.split(',') } : {}),
    ...(typeof flags.include === 'string' ? { include: flags.include.split(',') } : {}),
  })

  if (plan.discovered === 'links') {
    io.err(
      `${url} has no sitemap and no llms.txt, so pages are found by following links.\n` +
        'That means fetching them, which is the one thing this is for avoiding. Run ingest instead.\n',
    )
    return 1
  }

  io.out(`${plan.pages.length} pages, found in the ${plan.discovered}\n\n`)
  for (const page of plan.pages) {
    io.out(`  ${page.url}${page.lastmod ? `  (changed ${page.lastmod})` : ''}\n`)
  }

  if (plan.skipped.length > 0) {
    io.out(`\n${plan.skipped.length} left out\n\n`)
    for (const entry of plan.skipped) {
      io.out(`  ${entry.url}\n    ${entry.because}\n`)
    }
  }

  if (plan.overflow > 0) {
    io.out(`\n${plan.overflow} more would be cut by the page limit. Raise it with --max.\n`)
  }

  io.out('\nAnything here you do not want answered from, add with --exclude and run it again.\n')

  return 0
}

async function runIngest(flags: Record<string, string | boolean>, io: Io): Promise<number> {
  const url = typeof flags.url === 'string' ? flags.url : undefined
  const path = typeof flags.path === 'string' ? flags.path : undefined

  if (!url && !path) {
    io.err('ingest needs --url <site> or --path <dir>\n')
    return 1
  }

  const out = indexPath(flags, io.cwd)
  const started = Date.now()

  // Unchanged pages keep the vectors the last run paid for, so a re-crawl of
  // a site that shipped one edit costs one embedding rather than all of them.
  const previous = flags.fresh === true ? undefined : await readIndexIfPresent(out)

  const index = await ingest({
    url,
    path,
    ...(previous ? { previous } : {}),
    maxPages: num(flags['max-pages'], 50),
    include: list(flags.include),
    exclude: list(flags.exclude),
    embed: typeof flags.embed === 'boolean' ? flags.embed : undefined,
    ...embeddingEndpoint(flags),
    onProgress: progress(io),
  })

  await writeIndex(out, index)

  const size = (await stat(out)).size
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  io.err('\n')
  io.out(
    [
      `Indexed ${index.stats.documents} documents into ${index.stats.chunks} chunks in ${seconds}s`,
      ...(previous && index.stats.embedded !== undefined && index.stats.embedded < index.stats.chunks
        ? [`Embedded ${index.stats.embedded} changed chunks, kept ${index.stats.chunks - index.stats.embedded}`]
        : []),
      `Retrieval: ${index.vectors ? 'hybrid (keyword + vectors)' : 'keyword only'}`,
      `Written to ${displayPath(out, io.cwd)} (${(size / 1024).toFixed(0)} KB)`,
      '',
      'Next:',
      `recourse ask "how do I get a refund?" --retrieve-only${flagSuffix(flags)}`,
      '',
    ].join('\n'),
  )

  if (!index.vectors) {
    io.out('Tip: set AI_GATEWAY_API_KEY and re-run to add vector search for better paraphrase matching.\n\n')
  }

  return 0
}

async function runAsk(question: string, flags: Record<string, string | boolean>, io: Io): Promise<number> {
  if (!question.trim()) {
    io.err('ask needs a question: recourse ask "how do I cancel?"\n')
    return 1
  }

  const index = await loadIndex(flags, io.cwd)
  const embedder = index.vectors ? embedderFor(index.vectors.model, flags) : undefined
  const retriever = createRetriever({ index, embedder, topK: num(flags['top-k'], 6) })
  const matches = await retriever.retrieve(question)

  if (matches.length === 0) {
    io.out('Nothing in the index matched that question.\n')
    return 0
  }

  if (flags['retrieve-only'] === true || !canReachGateway()) {
    if (!canReachGateway() && flags['retrieve-only'] !== true) {
      io.out('No AI_GATEWAY_API_KEY set, showing retrieved passages instead of an answer.\n\n')
    }
    for (const [position, match] of matches.entries()) {
      const heading = headingOf(match.chunk.title, match.chunk.section)
      io.out(
        `[${position + 1}] ${heading}  (${match.from.join('+')}, ${match.score.toFixed(4)})\n` +
          `${match.chunk.text.slice(0, 300).replace(/\s+/g, ' ')}...\n` +
          `${match.chunk.url ?? ''}\n\n`,
      )
    }
    return 0
  }

  const result = streamText({
    model: typeof flags.model === 'string' ? flags.model : 'openai/gpt-4o-mini',
    instructions: buildInstructions({ matches }),
    messages: [{ role: 'user', content: question }],
  })

  for await (const delta of result.textStream) io.out(delta)

  io.out('\n\nSources:\n')
  for (const [position, match] of matches.entries()) {
    io.out(`  [${position + 1}] ${match.chunk.url ?? match.chunk.title}\n`)
  }

  return 0
}

/**
 * Everything a deployment needs, checked in one go.
 *
 * Credentials are read from the environment here rather than from flags, so
 * nothing secret ends up in a shell history or a CI log.
 */
async function runDoctor(flags: Record<string, string | boolean>, io: Io): Promise<number> {
  const checks: Check[] = []

  // The index first: without it nothing else matters.
  const path = indexPath(flags, io.cwd)
  try {
    const index = parseIndex(await readFile(path, 'utf8'))
    checks.push({
      name: 'index',
      status: 'ok',
      detail: `${index.stats.chunks} chunks from ${index.stats.documents} documents, ${index.vectors ? 'hybrid' : 'keyword only'}`,
    })

    if (index.vectors) {
      const stored = index.vectors.model.replace(/^(gateway|endpoint|provider):/, '')
      const configured = process.env.OPENAI_COMPATIBLE_EMBED_MODEL
      if (configured && configured !== stored) {
        // The failure this catches is silent: query vectors from one model
        // against stored vectors from another are not comparable, and the
        // symptom is bad answers rather than an error.
        checks.push({
          name: 'embedding model',
          status: 'fail',
          detail: `the index was built with "${stored}" but the environment says "${configured}"`,
          fix: 'rebuild the index, or point OPENAI_COMPATIBLE_EMBED_MODEL back at the model it was built with',
        })
      }
    }
  } catch (error) {
    checks.push({
      name: 'index',
      status: 'fail',
      detail:
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? `nothing at ${displayPath(path, io.cwd)}` : String(error),
      fix: 'run `recourse ingest --url <site>` first',
    })
  }

  checks.push(
    ...(await checkModel({
      ...(typeof flags['base-url'] === 'string' ? { baseURL: flags['base-url'] } : process.env.OPENAI_COMPATIBLE_BASE_URL ? { baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL } : {}),
      ...(process.env.OPENAI_COMPATIBLE_API_KEY ? { apiKey: process.env.OPENAI_COMPATIBLE_API_KEY } : {}),
      ...(process.env.OPENAI_COMPATIBLE_MODEL ? { model: process.env.OPENAI_COMPATIBLE_MODEL } : {}),
      ...(process.env.OPENAI_COMPATIBLE_EMBED_MODEL ? { embedModel: process.env.OPENAI_COMPATIBLE_EMBED_MODEL } : {}),
    })),
  )

  checks.push(
    ...(await checkCredentials({
      ...(process.env.SLACK_BOT_TOKEN ? { slack: { botToken: process.env.SLACK_BOT_TOKEN } } : {}),
      ...(process.env.TELEGRAM_BOT_TOKEN ? { telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN } } : {}),
      ...(process.env.DISCORD_BOT_TOKEN ? { discord: { botToken: process.env.DISCORD_BOT_TOKEN } } : {}),
      ...(process.env.WHATSAPP_TOKEN
        ? {
            whatsapp: {
              accessToken: process.env.WHATSAPP_TOKEN,
              ...(process.env.WHATSAPP_PHONE_ID ? { phoneNumberId: process.env.WHATSAPP_PHONE_ID } : {}),
            },
          }
        : {}),
      ...(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
        ? { twilio: { accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN } }
        : {}),
      ...(process.env.ELEVENLABS_API_KEY ? { elevenlabs: { apiKey: process.env.ELEVENLABS_API_KEY } } : {}),
      firecrawl: process.env.FIRECRAWL_API_KEY ? { apiKey: process.env.FIRECRAWL_API_KEY } : {},
    })),
  )

  // Object storage, when the environment describes a bucket. Checked by using
  // it: credentials that can list a bucket but not write to it are the usual
  // R2 mistake, and nothing else notices until a customer's upload fails.
  if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    const { s3Blobs } = await import('../storage/s3.js')
    checks.push(
      ...(await checkStorage(
        s3Blobs({
          bucket: process.env.S3_BUCKET,
          endpoint:
            process.env.S3_ENDPOINT ??
            `https://${process.env.R2_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com`,
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          ...(process.env.S3_REGION ? { region: process.env.S3_REGION } : {}),
        }),
      )),
    )
  }

  io.out(`\n${formatChecks(checks)}\n\n`)
  return exitCodeFor(checks)
}

async function runStats(flags: Record<string, string | boolean>, io: Io): Promise<number> {
  const index = await loadIndex(flags, io.cwd)
  const terms = Object.keys(index.keyword.postings).length

  io.out(
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
 * Where embeddings come from: the flags, or the environment already pointing
 * everything else at a local endpoint.
 *
 * Reading the environment matters more than it looks. Someone who sets
 * OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_EMBED_MODEL has said where
 * their models live, and ingest used to ignore both, hand back a keyword-only
 * index, and suggest a gateway key they had deliberately not set. `doctor`
 * then checked the index against the very variable ingest had not read.
 */
function embeddingEndpoint(flags: Record<string, string | boolean>): {
  embedBaseURL?: string
  embedModel?: string
  embedApiKey?: string
} {
  const baseURL =
    typeof flags['embed-url'] === 'string' ? flags['embed-url'] : process.env.OPENAI_COMPATIBLE_BASE_URL
  const model =
    typeof flags['embed-model'] === 'string' ? flags['embed-model'] : process.env.OPENAI_COMPATIBLE_EMBED_MODEL
  const apiKey =
    typeof flags['embed-key'] === 'string' ? flags['embed-key'] : process.env.OPENAI_COMPATIBLE_API_KEY

  // Both or neither. A model name with no endpoint would be sent to the
  // gateway, which has never heard of the model somebody runs at home.
  if (!baseURL || !model) return {}

  return { embedBaseURL: baseURL, embedModel: model, ...(apiKey ? { embedApiKey: apiKey } : {}) }
}

/**
 * Rebuilds the embedder the index was written with. A query vector has to come
 * from the same model as the stored ones or the distances are meaningless, so
 * the model name travels inside the index rather than being guessed here.
 */
function embedderFor(storedModel: string, flags: Record<string, string | boolean>) {
  const model = storedModel.replace(/^(gateway|endpoint|provider):/, '')
  const endpoint = embeddingEndpoint(flags)

  return createEmbedder({
    model,
    baseURL: endpoint.embedBaseURL,
    apiKey: endpoint.embedApiKey,
  })
}

/** Wires the flags through to the scaffold. */
async function runInit(flags: Record<string, string | boolean>, io: Io): Promise<number> {
  return init({
    ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
    ...(typeof flags.path === 'string' ? { path: flags.path } : {}),
    index: typeof flags.index === 'string' ? flags.index : DEFAULT_OUT,
    cwd: io.cwd,
    write: io.out,
    ...(flags.install === false ? { install: false } : {}),
    ...(typeof flags.provider === 'string' ? { provider: flags.provider as never } : {}),
  })
}

/**
 * The index already at that path, when there is one worth reading.
 *
 * Every failure here is the same failure: there is nothing usable to carry
 * over, so the build embeds everything, which is what it did before this
 * existed. A first run, a deleted file and a half-written one all take that
 * path, and none of them is worth stopping an ingest for.
 */
async function readIndexIfPresent(path: string) {
  try {
    return parseIndex(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** One flag for the index path, so ingest and ask can never disagree on it. */
function indexPath(flags: Record<string, string | boolean>, cwd: string): string {
  const value = flags.index ?? flags.out
  return resolve(cwd, typeof value === 'string' ? value : DEFAULT_OUT)
}

async function loadIndex(flags: Record<string, string | boolean>, cwd: string) {
  const path = indexPath(flags, cwd)
  try {
    return parseIndex(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`no index at ${displayPath(path, cwd)}. Run \`recourse ingest --url <site>\` first.`)
    }
    throw error
  }
}

/**
 * A path inside the project reads better relative; one outside it turns into a
 * ladder of `../..` that is harder to read than the absolute path.
 */
function displayPath(path: string, cwd: string): string {
  const relative_ = relative(cwd, path)
  return relative_.startsWith('..') ? path : relative_
}

/** Repeats a non-default --index so the printed next step actually runs. */
function flagSuffix(flags: Record<string, string | boolean>): string {
  const value = flags.index ?? flags.out
  return typeof value === 'string' ? ` --index ${value}` : ''
}

/** Progress on stderr so stdout stays clean enough to pipe. */
function progress(io: Io): (event: ProgressEvent) => void {
  let last = ''
  const interactive = process.stderr.isTTY === true

  return (event) => {
    const count = event.total ? ` ${event.done ?? 0}/${event.total}` : ''
    const line = `  ${event.phase}${count}  ${event.message}`.slice(0, 100)
    if (line === last) return
    last = line
    // Redrawing one line is nice in a terminal and unreadable in a log file.
    io.err(interactive ? `\r${' '.repeat(100)}\r${line}` : `${line}\n`)
  }
}
