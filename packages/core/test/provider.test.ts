import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OLLAMA, envFileFor, envFor, mergeEnv, pickLocalModel, summarise } from '../src/cli/provider.js'
import { init, model } from '../src/cli/init.js'

describe('where the variables go', () => {
  it('uses the file each framework actually reads', () => {
    expect(envFileFor('next')).toBe('.env.local')
    // Wrangler reads this one locally and ignores `.env`, so getting it wrong
    // writes a file nothing loads.
    expect(envFileFor('worker')).toBe('.dev.vars')
    expect(envFileFor('node')).toBe('.env')
    expect(envFileFor('unknown')).toBe('.env')
  })
})

describe('what each choice comes down to', () => {
  it('points a local choice at Ollama', () => {
    expect(envFor('local')).toEqual({
      OPENAI_COMPATIBLE_BASE_URL: OLLAMA.baseURL,
      OPENAI_COMPATIBLE_MODEL: OLLAMA.model,
    })
  })

  it('writes a gateway key only when there is one', () => {
    expect(envFor('gateway', { key: 'vck_x' })).toEqual({ AI_GATEWAY_API_KEY: 'vck_x' })
    expect(envFor('gateway')).toEqual({})
  })

  it('needs both halves of an endpoint before it writes either', () => {
    expect(envFor('compatible', { baseURL: 'https://x/v1' })).toEqual({})
    expect(envFor('compatible', { model: 'm' })).toEqual({})
    expect(envFor('compatible', { baseURL: 'https://x/v1', model: 'm' })).toEqual({
      OPENAI_COMPATIBLE_BASE_URL: 'https://x/v1',
      OPENAI_COMPATIBLE_MODEL: 'm',
    })
  })

  it('leaves the key out for an endpoint that needs none', () => {
    const withKey = envFor('compatible', { baseURL: 'https://x/v1', model: 'm', apiKey: 'k' })
    expect(withKey.OPENAI_COMPATIBLE_API_KEY).toBe('k')
    expect(envFor('compatible', { baseURL: 'https://x/v1', model: 'm', apiKey: '' })).not.toHaveProperty(
      'OPENAI_COMPATIBLE_API_KEY',
    )
  })

  it('writes nothing for a decision put off', () => {
    expect(envFor('later')).toEqual({})
  })
})

describe('merging into a file somebody already has', () => {
  it('never overwrites a value that is already set', () => {
    // The damage from getting this wrong is invisible until a deploy fails on
    // a credential that used to work.
    const before = 'AI_GATEWAY_API_KEY=mine\n'
    expect(mergeEnv(before, { AI_GATEWAY_API_KEY: 'theirs' })).toBe(before)
  })

  it('adds what is missing and keeps what is there', () => {
    const merged = mergeEnv('EXISTING=1\n', { OPENAI_COMPATIBLE_MODEL: 'qwen3:4b' })

    expect(merged).toContain('EXISTING=1')
    expect(merged).toContain('OPENAI_COMPATIBLE_MODEL=qwen3:4b')
  })

  it('ignores comments and blank lines when working out what is set', () => {
    const merged = mergeEnv('# AI_GATEWAY_API_KEY=commented out\n\n', { AI_GATEWAY_API_KEY: 'real' })
    expect(merged).toContain('AI_GATEWAY_API_KEY=real')
  })

  it('does not run two values together when the file has no trailing newline', () => {
    expect(mergeEnv('A=1', { B: '2' })).toBe('A=1\nB=2\n')
    expect(mergeEnv('', { B: '2' })).toBe('B=2\n')
  })
})

describe('what it says afterwards', () => {
  it('names the model it actually chose, not the default', () => {
    expect(summarise('local', '.env.local', 'granite4.1:8b')).toContain('granite4.1:8b')
    expect(summarise('local', '.env.local', 'granite4.1:8b')).toContain('ollama pull granite4.1:8b')
  })

  it('is honest that an unconfigured agent hands over rather than answers', () => {
    const said = summarise('later', '.env.local')

    expect(said).toContain('hand over to a person')
    // Names the command rather than leaving somebody to guess the variables.
    expect(said).toContain('recourse model')
  })
})

describe('what init writes for the choice', () => {
  let dir = ''
  let lines: string[] = []

  const options = (extra: Record<string, unknown> = {}) => ({
    path: join(dir, 'docs'),
    index: 'recourse/knowledge.json',
    cwd: dir,
    write: (line: string) => void lines.push(line),
    run: async () => true,
    ...extra,
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'recourse-prov-'))
    lines = []
    await mkdir(join(dir, 'docs'), { recursive: true })
    await writeFile(
      join(dir, 'docs', 'a.md'),
      '# Refunds\n\nWe refund any order within thirty days of it arriving. Email\n' +
        'support with the order number and we handle it the same day, with the\n' +
        'money back on the original card within a week.\n',
    )
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^15' } }))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('configures a local model into the file Next.js reads', async () => {
    expect(await init(options({ provider: 'local' }))).toBe(0)

    const env = await readFile(join(dir, '.env.local'), 'utf8')
    expect(env).toContain(`OPENAI_COMPATIBLE_BASE_URL=${OLLAMA.baseURL}`)
    // Not pinned to the default: whichever model it resolved, it has to write
    // one. Asserting the default here passed while the flag path was skipping
    // the lookup entirely.
    expect(env).toMatch(/OPENAI_COMPATIBLE_MODEL=.+/)
  })

  it('writes a route that reads that file rather than assuming a gateway', async () => {
    // The bug this exists to stop: a route with no model, which falls back to
    // a gateway id and answers every question with "unavailable" until
    // somebody happens to set the one variable that was never mentioned.
    expect(await init(options({ provider: 'local' }))).toBe(0)

    const route = await readFile(join(dir, 'app', 'api', 'chat', 'route.ts'), 'utf8')
    expect(route).toContain('models.fromEnvironment()')
    expect(route).toContain('model')
  })

  it('leaves no environment file behind for a decision put off', async () => {
    expect(await init(options({ provider: 'later' }))).toBe(0)

    await expect(readFile(join(dir, '.env.local'), 'utf8')).rejects.toThrow()
    expect(lines.join('')).toContain('hand over to a person')
  })

  it('does not touch a key the project already had', async () => {
    await writeFile(join(dir, '.env.local'), 'AI_GATEWAY_API_KEY=already-mine\n')

    expect(await init(options({ provider: 'gateway' }))).toBe(0)
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe('AI_GATEWAY_API_KEY=already-mine\n')
  })
})

describe('picking a local model', () => {
  it('keeps the default when it is one of the pulled ones', () => {
    expect(pickLocalModel([OLLAMA.model, 'llama3:8b'])).toBe(OLLAMA.model)
  })

  it('takes something that is actually there when the default is not', () => {
    // The papercut this exists to stop: choosing "a model on this machine",
    // then getting told that model does not exist on the first question.
    expect(pickLocalModel(['granite4.1:8b', 'moondream:latest'])).toBe('granite4.1:8b')
  })

  it('never picks an embedding model, which cannot hold a conversation', () => {
    expect(pickLocalModel(['nomic-embed-text:latest', 'gemma4:12b'])).toBe('gemma4:12b')
    expect(pickLocalModel(['nomic-embed-text:latest'])).toBe(OLLAMA.model)
  })

  it('falls back to the default when Ollama told us nothing', () => {
    expect(pickLocalModel([])).toBe(OLLAMA.model)
  })
})

describe('changing the model after the fact', () => {
  let dir = ''
  let lines: string[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'recourse-model-'))
    lines = []
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^15' } }))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const options = (provider: string) => ({
    cwd: dir,
    write: (line: string) => void lines.push(line),
    provider: provider as never,
  })

  it('configures a project that was set up with no model at all', async () => {
    // "Decide later" was a dead end before this: the only way back was knowing
    // which variables to write by hand.
    expect(await model(options('local'))).toBe(0)

    const env = await readFile(join(dir, '.env.local'), 'utf8')
    expect(env).toContain(`OPENAI_COMPATIBLE_BASE_URL=${OLLAMA.baseURL}`)
  })

  it('needs no index and writes no route, unlike init', async () => {
    expect(await model(options('local'))).toBe(0)

    await expect(readFile(join(dir, 'app', 'api', 'chat', 'route.ts'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dir, 'recourse', 'knowledge.json'), 'utf8')).rejects.toThrow()
  })

  it('still refuses to clobber a key that is already set', async () => {
    await writeFile(join(dir, '.env.local'), 'AI_GATEWAY_API_KEY=already-mine\n')

    expect(await model(options('gateway'))).toBe(0)
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe('AI_GATEWAY_API_KEY=already-mine\n')
  })
})
