import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { list, num, parseArgs } from '../src/cli/args.js'
import { main, type Io } from '../src/cli/main.js'

describe('the four ways a flag can be written', () => {
  it('reads a value that follows the flag', () => {
    const parsed = parseArgs(['ingest', '--url', 'https://x.example'])

    expect(parsed.command).toBe('ingest')
    expect(parsed.flags.url).toBe('https://x.example')
    expect(parsed.positionals).toEqual([])
  })

  it('reads a value joined to the flag by an equals sign', () => {
    expect(parseArgs(['ingest', '--url=https://x.example']).flags.url).toBe('https://x.example')
  })

  it('turns a no- prefix into a false rather than a flag called no-something', () => {
    expect(parseArgs(['ingest', '--no-embed']).flags.embed).toBe(false)
    expect(parseArgs(['ingest', '--no-embed']).flags['no-embed']).toBeUndefined()
  })

  it('treats a flag with nothing after it as true', () => {
    expect(parseArgs(['doctor', '--verbose']).flags.verbose).toBe(true)
  })

  it('never swallows the next flag as a value', () => {
    // `--index` here means "the default index", not "the index called --top-k".
    // Consuming the next token blindly would eat the flag after it and lose one
    // of the two settings the caller asked for.
    const parsed = parseArgs(['ask', '--index', '--top-k', '3'])

    expect(parsed.flags.index).toBe(true)
    expect(parsed.flags['top-k']).toBe('3')
  })

  it('keeps a whole question as positionals', () => {
    const parsed = parseArgs(['ask', 'how', 'do', 'I', 'cancel'])

    expect(parsed.command).toBe('ask')
    expect(parsed.positionals).toEqual(['how', 'do', 'I', 'cancel'])
  })

  it('still collects a positional that arrives after a flag', () => {
    const parsed = parseArgs(['ingest', '--path', './docs', 'extra'])

    expect(parsed.flags.path).toBe('./docs')
    expect(parsed.positionals).toEqual(['extra'])
  })

  it('lets the last of a repeated flag win', () => {
    expect(parseArgs(['ingest', '--url', 'a', '--url', 'b']).flags.url).toBe('b')
  })

  it('has no command when given nothing', () => {
    const parsed = parseArgs([])

    expect(parsed.command).toBeUndefined()
    expect(parsed.positionals).toEqual([])
    expect(parsed.flags).toEqual({})
  })
})

describe('turning a flag into the type a command wants', () => {
  it('falls back to the default for anything that is not a number', () => {
    expect(num('7', 5)).toBe(7)
    expect(num(undefined, 5)).toBe(5)
    // `--top-k` with no value parses as `true`, and a default beats a NaN.
    expect(num(true, 5)).toBe(5)
    expect(num('nonsense', 5)).toBe(5)
  })

  it('splits a list on commas and drops the gaps', () => {
    expect(list('a, b ,,c')).toEqual(['a', 'b', 'c'])
    expect(list(undefined)).toBeUndefined()
    expect(list(true)).toBeUndefined()
  })
})

describe('every command the cli dispatches', () => {
  let dir: string
  let out: string[]
  let err: string[]
  let io: Io
  let tty: boolean | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'recourse-cli-'))
    out = []
    err = []
    io = { out: (line) => void out.push(line), err: (line) => void err.push(line), cwd: dir }

    await mkdir(join(dir, 'docs'), { recursive: true })
    await writeFile(
      join(dir, 'docs', 'a.md'),
      '# Refunds\n\nWe refund any order within thirty days of it arriving. Email\n' +
        'support with the order number and we handle it the same day, with the\n' +
        'money back on the original card within a week.\n',
    )
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^15' } }))

    // A credential in the environment of whoever runs this suite would turn
    // these into network tests: `ask` would call a model, `ingest` would embed,
    // and `doctor` would go and check every service it found a token for.
    for (const name of [
      'AI_GATEWAY_API_KEY',
      'VERCEL_OIDC_TOKEN',
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAI_COMPATIBLE_MODEL',
      'OPENAI_COMPATIBLE_EMBED_MODEL',
      'OPENAI_COMPATIBLE_API_KEY',
      'FIRECRAWL_API_KEY',
      'SLACK_BOT_TOKEN',
      'TELEGRAM_BOT_TOKEN',
      'DISCORD_BOT_TOKEN',
      'WHATSAPP_TOKEN',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'ELEVENLABS_API_KEY',
      'S3_BUCKET',
    ]) {
      vi.stubEnv(name, undefined)
    }

    // `init` draws interactive prompts when stdout is a terminal, so the same
    // run behaves differently from a terminal than from a pipe. Pinning it
    // makes the assertions below mean the same thing either way.
    tty = process.stdout.isTTY
    process.stdout.isTTY = false
  })

  afterEach(async () => {
    process.stdout.isTTY = tty as boolean
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  })

  it('prints the usage block when asked for nothing at all', async () => {
    expect(await main([], io)).toBe(0)
    expect(out.join('')).toContain('recourse: a support agent trained on your own content')
  })

  it('prints the same usage block for help and for --help on a command', async () => {
    expect(await main(['help'], io)).toBe(0)
    expect(out.join('')).toContain('recourse: a support agent trained on your own content')

    out.length = 0
    expect(await main(['ingest', '--help'], io)).toBe(0)
    expect(out.join('')).toContain('recourse: a support agent trained on your own content')
  })

  it('refuses a command it does not have', async () => {
    expect(await main(['nonsense'], io)).toBe(1)
    expect(err.join('')).toContain('unknown command: nonsense')
  })

  it('asks for a site before planning a crawl', async () => {
    // Guarded on purpose: with a --url this command reaches the network, so the
    // only branch a test may take is the one that stops before it.
    expect(await main(['plan'], io)).toBe(1)
    expect(err.join('')).toContain('plan needs --url <site>')
  })

  it('asks for something to learn from before ingesting', async () => {
    expect(await main(['ingest'], io)).toBe(1)
    expect(err.join('')).toContain('ingest needs --url <site> or --path <dir>')
  })

  it('writes the index into the directory it was pointed at', async () => {
    // The regression this locks in: an index written into whichever directory
    // the process happened to start in rather than the one the caller named.
    expect(await main(['ingest', '--path', join(dir, 'docs'), '--no-embed'], io)).toBe(0)
    expect(out.join('')).toContain('Indexed')

    const written = await stat(join(dir, 'recourse', 'knowledge.json'))
    expect(written.isFile()).toBe(true)
  })

  it('counts what is in the index', async () => {
    await main(['ingest', '--path', join(dir, 'docs'), '--no-embed'], io)
    out.length = 0

    expect(await main(['stats'], io)).toBe(0)
    expect(out.join('')).toContain('Documents:')
    expect(out.join('')).toContain('Chunks:')
  })

  it('asks where the store is before reporting outcomes', async () => {
    expect(await main(['outcomes'], io)).toBe(1)
    expect(err.join('')).toContain('outcomes needs --store <dir>')
  })

  it('reports outcomes off a file store, including the empty one', async () => {
    // An empty store is the first thing anybody runs this against, and a
    // report that threw there would look like a broken command rather than a
    // store with nothing in it yet.
    expect(await main(['outcomes', '--store', join(dir, 'store')], io)).toBe(0)
    expect(out.join('')).toContain('Conversations:  0')
    expect(out.join('')).toContain('Thumbs, agent alone:   0 up, 0 down')
  })

  it('shows the passages it matched when no model is configured', async () => {
    await main(['ingest', '--path', join(dir, 'docs'), '--no-embed'], io)
    out.length = 0

    // With no gateway credential this prints what it retrieved and stops, which
    // is a success and not a failure: retrieval is the part that needs no key.
    expect(await main(['ask', 'how', 'do', 'I', 'get', 'a', 'refund'], io)).toBe(0)
    expect(out.join('')).toContain('[1]')
    expect(out.join('')).toContain('showing retrieved passages')
  })

  it('asks for a question before answering one', async () => {
    expect(await main(['ask'], io)).toBe(1)
    expect(err.join('')).toContain('ask needs a question')
  })

  it('says where the index should have been when there is none', async () => {
    // The throw travels up to the entry point rather than being turned into an
    // exit code here, so the assertion has to be on the rejection.
    await expect(main(['stats'], io)).rejects.toThrow(/no index at/)
  })

  it('fails the check-up when there is no index yet', async () => {
    expect(await main(['doctor'], io)).toBe(1)
    expect(out.join('')).toContain('FAIL')
    expect(out.join('')).toContain('index')
  })

  it('passes the check-up once there is one', async () => {
    await main(['ingest', '--path', join(dir, 'docs'), '--no-embed'], io)
    out.length = 0

    expect(await main(['doctor'], io)).toBe(0)
    expect(out.join('')).toContain('Everything checked is working.')
  })

  it('sets a project up without reaching for a package manager', async () => {
    // Without --no-install this spawns the project's installer, which is both
    // slow and a network call.
    expect(await main(['init', '--path', join(dir, 'docs'), '--no-install', '--provider', 'later'], io)).toBe(0)

    const written = await stat(join(dir, 'recourse', 'knowledge.json'))
    expect(written.isFile()).toBe(true)
    expect(out.join('')).toContain('app/api/chat/route.ts')
    expect(out.join('')).toContain('data-endpoint="/api/chat"')
  })
})
