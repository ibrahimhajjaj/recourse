import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PACKAGE,
  alreadyInstalled,
  detectPackageManager,
  installCommand,
  runScript,
} from '../src/cli/install.js'
import { init } from '../src/cli/init.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('the package it installs', () => {
  it('is the one this package publishes under', async () => {
    // The route `init` writes imports this name. If the two ever drift, the
    // scaffold installs one package and imports another, and the only place
    // that shows up is somebody else's terminal.
    const manifest = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8')) as { name: string }

    expect(PACKAGE).toBe(manifest.name)
  })
})

describe('working out which package manager a project uses', () => {
  it('reads it off the lockfile', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm')
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn')
    expect(detectPackageManager(['bun.lockb'])).toBe('bun')
    expect(detectPackageManager(['bun.lock'])).toBe('bun')
    expect(detectPackageManager(['package-lock.json'])).toBe('npm')
  })

  it('falls back to npm, which is the one that is always there', () => {
    expect(detectPackageManager([])).toBe('npm')
    expect(detectPackageManager(['package.json', 'src'])).toBe('npm')
  })

  it('prefers the deliberate tool when a project carries more than one lockfile', () => {
    expect(detectPackageManager(['package-lock.json', 'pnpm-lock.yaml'])).toBe('pnpm')
    expect(detectPackageManager(['package-lock.json', 'yarn.lock'])).toBe('yarn')
  })
})

describe('the commands', () => {
  it('adds a package in each manager’s own spelling', () => {
    expect(installCommand('npm', 'x')).toEqual(['npm', 'install', 'x'])
    expect(installCommand('pnpm', 'x')).toEqual(['pnpm', 'add', 'x'])
    expect(installCommand('yarn', 'x')).toEqual(['yarn', 'add', 'x'])
    expect(installCommand('bun', 'x')).toEqual(['bun', 'add', 'x'])
  })

  it('runs a script the way that manager runs scripts', () => {
    expect(runScript('npm', 'dev')).toBe('npm run dev')
    expect(runScript('pnpm', 'dev')).toBe('pnpm dev')
    expect(runScript('yarn', 'dev')).toBe('yarn dev')
    expect(runScript('bun', 'dev')).toBe('bun dev')
  })
})

describe('whether it is already there', () => {
  it('counts both kinds of dependency', () => {
    expect(alreadyInstalled({ dependencies: { x: '^1' } }, 'x')).toBe(true)
    expect(alreadyInstalled({ devDependencies: { x: '^1' } }, 'x')).toBe(true)
  })

  it('says no for a project that has neither', () => {
    expect(alreadyInstalled({ dependencies: { other: '^1' } }, 'x')).toBe(false)
    expect(alreadyInstalled({}, 'x')).toBe(false)
    expect(alreadyInstalled(undefined, 'x')).toBe(false)
  })
})

describe('what init actually does about the dependency', () => {
  let dir = ''
  let lines: string[] = []
  let ran: Array<{ command: string; args: string[] }> = []

  const options = (extra: Record<string, unknown> = {}) => ({
    path: join(dir, 'docs'),
    index: 'recourse/knowledge.json',
    cwd: dir,
    write: (line: string) => void lines.push(line),
    run: async (command: string, args: string[]) => {
      ran.push({ command, args })
      return true
    },
    ...extra,
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'recourse-init-'))
    lines = []
    ran = []
    await mkdir(join(dir, 'docs'), { recursive: true })
    await writeFile(
      join(dir, 'docs', 'a.md'),
      '# Refunds\n\nWe refund any order within thirty days of it arriving. Email\n' +
        'support with the order number and we handle it the same day, with the\n' +
        'money back on the original card within a week.\n',
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const project = async (manifest: object, ...files: string[]) => {
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    for (const name of files) await writeFile(join(dir, name), '')
  }

  it('installs the package the route it just wrote imports', async () => {
    // Without this the scaffold finishes, says "run npm run dev", and that
    // server dies on a module nothing ever added.
    await project({ dependencies: { next: '^15' } })

    expect(await init(options())).toBe(0)
    expect(ran).toEqual([{ command: 'npm', args: ['install', PACKAGE] }])

    const route = await readFile(join(dir, 'app', 'api', 'chat', 'route.ts'), 'utf8')
    expect(route).toContain(`from '${PACKAGE}/server'`)
  })

  it('uses the manager the project already uses', async () => {
    await project({ dependencies: { next: '^15' } }, 'pnpm-lock.yaml')

    expect(await init(options())).toBe(0)
    expect(ran).toEqual([{ command: 'pnpm', args: ['add', PACKAGE] }])
    expect(lines.join('')).toContain('pnpm dev')
  })

  it('does not install again for somebody re-learning their content', async () => {
    await project({ dependencies: { next: '^15', [PACKAGE]: '^0.1.0' } })

    expect(await init(options())).toBe(0)
    expect(ran).toEqual([])
  })

  it('leaves it alone when asked to, and says what to run', async () => {
    await project({ dependencies: { next: '^15' } })

    expect(await init(options({ install: false }))).toBe(0)
    expect(ran).toEqual([])
    expect(lines.join('')).toContain(`npm install ${PACKAGE}`)
  })

  it('hands over the command rather than failing when the install does not work', async () => {
    await project({ dependencies: { next: '^15' } }, 'yarn.lock')

    const code = await init(options({ run: async () => false }))

    // The index and the route are both written by this point, so throwing the
    // run away over a failed install would cost more than it saved.
    expect(code).toBe(0)
    expect(lines.join('')).toContain(`yarn add ${PACKAGE}`)
  })
})
