/**
 * `recourse init`: from an empty folder to a chat window that answers.
 *
 * The quickstart in the README is four steps and assumes you already have an
 * app to put a route into. Somebody who has just found this and wants to see
 * whether it works has to build the surrounding app first, which is the wrong
 * order: they should see it answer a question and then decide.
 *
 * The rule this follows is the one worth keeping: **it must end on something
 * that runs**. Not on "now add your API key". Retrieval needs no credential,
 * so a fresh `init` produces a working chat window that shows the passages it
 * found, and a model turns those into a sentence whenever one is configured.
 *
 * Interactive prompts come from `@clack/prompts`, imported only here and only
 * when needed. That library wants a newer Node than this package requires, so
 * everything below also works from flags alone, and an old Node gets the flag
 * path with an explanation rather than a stack trace.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { detect, routeFor, snippetFor, type Detected, type Project } from './scaffold.js'

/** Node version that `@clack/prompts` needs, because it uses `util.styleText`. */
const PROMPTS_NEED = [20, 12] as const

export interface InitOptions {
  /** A site to learn, or a folder of markdown. One of the two is required. */
  url?: string | undefined
  path?: string | undefined
  /** Where the index goes. */
  index: string
  /** Where the project is. */
  cwd: string
  write: (line: string) => void
}

export async function init(options: InitOptions): Promise<number> {
  const prompts = await loadPrompts()
  const project = await look(options.cwd)

  if (prompts) prompts.intro('recourse')
  else options.write('\nrecourse init\n')

  // What it should learn. A flag settles it; otherwise ask, and only ask this
  // one thing, because everything else has an answer worth defaulting to.
  let source: { url?: string; path?: string } | null = { ...(options.url ? { url: options.url } : {}), ...(options.path ? { path: options.path } : {}) }

  if (!source.url && !source.path) {
    source = prompts ? await ask(prompts) : null

    if (!source) {
      options.write(
        'Nothing to learn from. Pass --url https://your-site.com or --path ./docs.\n' +
          (prompts ? '' : `Interactive prompts need Node ${PROMPTS_NEED.join('.')} or newer; this is ${process.version}.\n`),
      )
      return 1
    }
  }

  // The index first, because it is the part that works with no credential and
  // the part everything else is pointless without.
  const spinner = prompts?.spinner()
  spinner?.start('Reading your content')

  const { ingest, writeIndex } = await import('../ingest.js')
  let chunks = 0

  try {
    const built = await ingest({
      ...(source.url ? { url: source.url } : {}),
      ...(source.path ? { path: source.path } : {}),
    })
    chunks = built.stats.chunks
    await writeIndex(resolve(options.cwd, options.index), built)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    spinner?.stop('Could not read it')
    options.write(`\n${why}\n`)
    return 1
  }

  spinner?.stop(`Learned ${chunks} chunks into ${options.index}`)

  // Then the route, which is the only thing that depends on what they have.
  if (project.framework === 'unknown') {
    options.write(
      '\nNo package.json here, so there is nothing to wire the endpoint into yet.\n' +
        'The index is written and works on its own:\n\n' +
        `  npx @recourse-ai/core ask "your question" --index ${options.index}\n\n` +
        'Come back and run init again inside a Next.js, Worker or Node project.\n',
    )
    return 0
  }

  const written = await writeRoute(options, project)

  if (prompts) {
    prompts.note(snippetFor(), 'Paste this into your page')
    prompts.outro(`${written ? `Wrote ${project.route}. ` : ''}Run ${project.start} and ask it something.`)
  } else {
    options.write(
      `\n${written ? `Wrote ${project.route}\n` : ''}\nPaste this into your page:\n\n${snippetFor()}\n\n` +
        `Then run ${project.start} and ask it something.\n`,
    )
  }

  options.write(
    '\nNo model configured yet, so it will show the passages it found rather than\n' +
      'writing a sentence. Set AI_GATEWAY_API_KEY, or any OpenAI-compatible endpoint,\n' +
      'and it starts answering. Nothing else changes.\n',
  )

  return 0
}

/**
 * The route, unless something is already there.
 *
 * Never overwrites. Somebody running `init` a second time to re-learn their
 * content should not lose the handler they have since edited, and a scaffold
 * that eats work is a scaffold nobody runs twice.
 */
async function writeRoute(options: InitOptions, project: Project): Promise<boolean> {
  const target = resolve(options.cwd, project.route)

  try {
    await readFile(target, 'utf8')
    options.write(`\n${project.route} already exists, so it was left alone.\n`)
    return false
  } catch {
    // Not there, which is the case we are here for.
  }

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, routeFor(project, options.index), 'utf8')
  return true
}

/** What is in this folder, in the shape `detect` reads. */
async function look(cwd: string): Promise<Project> {
  const found: Detected = { files: [] }

  try {
    found.files = await readdir(cwd)
  } catch {
    // An unreadable directory is an empty one for our purposes.
  }

  try {
    found.manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as Detected['manifest']
  } catch {
    // No package.json, or one that is not JSON. Either way, not a project we
    // can write into, and `detect` returns `unknown` for it.
  }

  return detect(found)
}

/** The one question, when there is a terminal to ask it in. */
async function ask(prompts: Prompts): Promise<{ url?: string; path?: string } | null> {
  const kind = await prompts.select({
    message: 'What should it learn?',
    options: [
      { value: 'url', label: 'A website', hint: 'crawled, no key needed' },
      { value: 'path', label: 'A folder of markdown', hint: 'read from disk' },
    ],
  })

  if (prompts.isCancel(kind)) return null

  const answer = await prompts.text(
    kind === 'url'
      ? { message: 'Which site?', placeholder: 'https://your-site.com' }
      : { message: 'Which folder?', placeholder: './docs', defaultValue: './docs' },
  )

  if (prompts.isCancel(answer) || !String(answer).trim()) return null

  return kind === 'url' ? { url: String(answer).trim() } : { path: String(answer).trim() }
}

/** The bits of clack this uses, so the dynamic import stays typed. */
interface Prompts {
  intro: (title: string) => void
  outro: (message: string) => void
  note: (body: string, title?: string) => void
  spinner: () => { start: (message?: string) => void; stop: (message?: string) => void }
  select: (options: { message: string; options: Array<{ value: string; label: string; hint?: string }> }) => Promise<unknown>
  text: (options: { message: string; placeholder?: string; defaultValue?: string }) => Promise<unknown>
  isCancel: (value: unknown) => boolean
}

/**
 * clack, when the runtime can load it.
 *
 * It reaches for `util.styleText`, which arrived in Node 20.12, and this
 * package supports older than that. Rather than raise the floor of the whole
 * library for one command's prompts, the import is attempted and a failure
 * means the flag path, which needs nothing.
 */
async function loadPrompts(): Promise<Prompts | null> {
  const [major, minor] = process.versions.node.split('.').map(Number) as [number, number]
  const old = major < PROMPTS_NEED[0] || (major === PROMPTS_NEED[0] && minor < PROMPTS_NEED[1])

  if (old || !process.stdout.isTTY) return null

  try {
    return (await import('@clack/prompts')) as unknown as Prompts
  } catch {
    return null
  }
}
