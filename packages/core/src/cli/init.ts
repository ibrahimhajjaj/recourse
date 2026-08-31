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
 * when there is a terminal to draw them in. Everything below also works from
 * flags alone, so a run in CI, or with the output piped somewhere, takes the
 * flag path rather than stopping on a question nobody is there to answer.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { detect, routeFor, snippetFor, type Detected, type Project } from './scaffold.js'
import {
  PACKAGE,
  alreadyInstalled,
  detectPackageManager,
  installCommand,
  runScript,
  type Manifest,
  type PackageManager,
} from './install.js'
import {
  OLLAMA,
  envFileFor,
  envFor,
  mergeEnv,
  pickLocalModel,
  summarise,
  type Provider,
  type ProviderAnswers,
} from './provider.js'

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
  /** Add the library to the project. Off with `--no-install`. */
  install?: boolean | undefined
  /** How to run the installer. Injected so tests never spawn a process. */
  run?: ((command: string, args: string[], cwd: string) => Promise<boolean>) | undefined
  /** Skip the model question and leave it unconfigured. */
  provider?: Provider | undefined
}

export async function init(options: InitOptions): Promise<number> {
  const prompts = await loadPrompts()
  const { project, found } = await look(options.cwd)
  const manager = detectPackageManager(found.files)

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

  // The route imports this package, so the project has to have it. Skipping
  // this is what turns a finished `init` into a dev server that dies on a
  // module-not-found for a file the tool wrote thirty seconds earlier.
  const installed = await add(options, manager, found.manifest)
  const start = startFor(project, manager)

  const chosen = await chooseProvider(options, prompts)
  await writeEnv(options, project, chosen.provider, chosen.answers)

  // Said here rather than at the end, so the steps arrive in the order they
  // have to happen in: install, paste, run.
  if (!installed) {
    options.write(`\nInstall it before starting:\n\n  ${installCommand(manager, PACKAGE).join(' ')}\n`)
  }

  if (prompts) {
    prompts.note(snippetFor(), 'Paste this into your page')
    prompts.outro(`${written ? `Wrote ${project.route}. ` : ''}Run ${start} and ask it something.`)
  } else {
    options.write(
      `\n${written ? `Wrote ${project.route}\n` : ''}\nPaste this into your page:\n\n${snippetFor()}\n\n` +
        `Then run ${start} and ask it something.\n`,
    )
  }



  return 0
}

/**
 * The model question on its own, for a project that already has the rest.
 *
 * `init` asks this once. Somebody who picked "decide later", or who has since
 * moved from a local model to a hosted one, had no way back other than knowing
 * which environment variables to write by hand, which is a dead end dressed up
 * as a choice.
 */
export async function model(options: ModelOptions): Promise<number> {
  const prompts = await loadPrompts()
  const { project } = await look(options.cwd)

  if (prompts) prompts.intro('recourse model')

  const chosen = await chooseProvider(options, prompts)
  await writeEnv(options, project, chosen.provider, chosen.answers)

  return 0
}

export interface ModelOptions {
  cwd: string
  write: (line: string) => void
  provider?: Provider | undefined
}

/**
 * How it should answer, asked once while somebody is still at the keyboard.
 *
 * A flag settles it without asking. With no terminal there is nobody to ask,
 * so it stays unconfigured and the closing message says so, which is better
 * than blocking a scripted run on a question.
 */
async function chooseProvider(
  options: ModelOptions,
  prompts: Prompts | null,
): Promise<{ provider: Provider; answers: ProviderAnswers }> {
  // A flag still goes through the local resolution below: picking `local`
  // without checking what is pulled writes a model that may not be there.
  if (options.provider) return { provider: options.provider, answers: await answersFor(options.provider) }
  if (!prompts) return { provider: 'later', answers: {} }

  const picked = await prompts.select({
    message: 'How should it answer?',
    options: [
      { value: 'local', label: 'A model on this machine', hint: 'Ollama, no key, nothing leaves the machine' },
      { value: 'gateway', label: 'Vercel AI Gateway', hint: 'one key, many models' },
      { value: 'compatible', label: 'Another OpenAI-compatible provider', hint: 'OpenAI, Anthropic, DeepSeek, Groq' },
      { value: 'later', label: 'Decide later', hint: 'cites sources, hands over to a person' },
    ],
  })

  if (prompts.isCancel(picked)) return { provider: 'later', answers: {} }
  const provider = String(picked) as Provider

  if (provider === 'gateway') {
    const key = await prompts.text({ message: 'Paste your AI Gateway key', placeholder: 'vck_...' })
    if (prompts.isCancel(key) || !String(key).trim()) return { provider: 'later', answers: {} }

    return { provider, answers: { key: String(key).trim() } }
  }

  if (provider === 'compatible') {
    const baseURL = await prompts.text({ message: 'Base URL', placeholder: 'https://api.deepseek.com/v1' })
    if (prompts.isCancel(baseURL) || !String(baseURL).trim()) return { provider: 'later', answers: {} }

    const model = await prompts.text({ message: 'Model', placeholder: 'deepseek-chat' })
    if (prompts.isCancel(model) || !String(model).trim()) return { provider: 'later', answers: {} }

    const apiKey = await prompts.text({ message: 'API key, if it needs one', placeholder: 'leave empty for none' })

    return {
      provider,
      answers: {
        baseURL: String(baseURL).trim(),
        model: String(model).trim(),
        ...(prompts.isCancel(apiKey) ? {} : { apiKey: String(apiKey).trim() }),
      },
    }
  }

  return { provider, answers: await answersFor(provider) }
}

/** What a choice needs looked up rather than typed. */
async function answersFor(provider: Provider): Promise<ProviderAnswers> {
  return provider === 'local' ? { model: pickLocalModel(await pulled()) } : {}
}

/**
 * What Ollama has, or nothing when it is not running.
 *
 * Asked rather than assumed, because the default is only right on a machine
 * that happens to have pulled it. A short timeout keeps a wedged daemon from
 * holding up a scaffold that does not really need this answer.
 */
async function pulled(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA.baseURL.replace(/\/v1$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return []

    const body = (await response.json()) as { models?: Array<{ name?: string }> }

    return (body.models ?? []).map((entry) => entry.name).filter((name): name is string => Boolean(name))
  } catch {
    // Not running, not installed, or too slow to matter. The default stands.
    return []
  }
}

/**
 * The environment file, with anything already in it untouched.
 *
 * Written even for a choice that adds no variables, because the closing
 * message names the file and somebody who opens it should find it there.
 */
async function writeEnv(
  options: ModelOptions,
  project: Project,
  provider: Provider,
  answers: ProviderAnswers,
): Promise<void> {
  const name = envFileFor(project.framework)
  const target = resolve(options.cwd, name)
  const add = envFor(provider, answers)

  if (Object.keys(add).length > 0) {
    let existing = ''
    try {
      existing = await readFile(target, 'utf8')
    } catch {
      // No file yet, which is the usual case on a fresh project.
    }

    const merged = mergeEnv(existing, add)
    if (merged !== existing) await writeFile(target, merged, 'utf8')
  }

  options.write(`\n${summarise(provider, name, answers.model)}\n`)
}

/**
 * Adds the library, unless it is already there or was turned off.
 *
 * Returns whether the project can resolve it afterwards, which is what decides
 * if the closing message has to include the command by hand. A failure here is
 * printed rather than fatal: the route and the index are both already written,
 * and one `npm install` is a smaller thing to hand somebody than a run that
 * threw away its own work.
 */
async function add(options: InitOptions, manager: PackageManager, manifest: Manifest | undefined): Promise<boolean> {
  if (alreadyInstalled(manifest, PACKAGE)) return true
  if (options.install === false) return false

  const [command, ...args] = installCommand(manager, PACKAGE) as [string, ...string[]]
  const runner = options.run ?? spawnInstall

  options.write(`\nAdding ${PACKAGE} with ${manager}\n`)

  try {
    return await runner(command, args, options.cwd)
  } catch {
    return false
  }
}

/** The real installer, kept apart so tests can pass their own. */
async function spawnInstall(command: string, args: string[], cwd: string): Promise<boolean> {
  const { spawn } = await import('node:child_process')

  return new Promise<boolean>((done) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', () => done(false))
    child.on('close', (code) => done(code === 0))
  })
}

/**
 * What to tell them to run, in the words their own project uses.
 *
 * Only the script-running frameworks change: a Worker is started through
 * wrangler and a bare node server by node, neither of which cares which
 * package manager put the files there.
 */
function startFor(project: Project, manager: PackageManager): string {
  return project.framework === 'next' ? runScript(manager, 'dev') : project.start
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
async function look(cwd: string): Promise<{ project: Project; found: Detected }> {
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

  return { project: detect(found), found }
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
 * It reaches for `util.styleText`, which arrived in Node 20.12. The declared
 * floor is above that now, but the check stays rather than being deleted: the
 * import is attempted instead of assumed, and anything that goes wrong means
 * the flag path, which needs nothing, and not a stack trace on the first
 * command somebody ever runs.
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
