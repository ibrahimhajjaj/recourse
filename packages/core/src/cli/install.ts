/**
 * Getting the library into the project it was just scaffolded into.
 *
 * `init` writes a route that imports this package and then tells somebody to
 * start their dev server. If nothing installs it in between, that server dies
 * on a module it cannot resolve, in a project they have not written a line of
 * yet, which reads as the tool being broken rather than unfinished.
 *
 * The decisions live here as plain functions so they can be checked without
 * spawning anything; `init` owns the one call that actually runs a process.
 */

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm'

/**
 * What the generated route imports, and therefore what has to be installed.
 *
 * Written out rather than read off disk at runtime, and held to the manifest
 * by a test, so a rename fails in the suite instead of in somebody's terminal.
 */
export const PACKAGE = '@recourse-ai/core'

/** What a project's manifest tells us about what it already depends on. */
export interface Manifest {
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
}

/**
 * Which package manager the project uses, read from the lockfile it keeps.
 *
 * npm is the fallback rather than a guess: it ships with node, so it is the
 * answer least likely to fail outright on a machine we know nothing about.
 * Checked in the order that a project with more than one lockfile most likely
 * means, which is the more deliberate tool rather than the default one.
 */
export function detectPackageManager(files: string[]): PackageManager {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm'
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun'
  if (files.includes('yarn.lock')) return 'yarn'
  return 'npm'
}

/**
 * The argv for adding one package, in that manager's own spelling.
 *
 * npm is the odd one out: everything else says `add`, and `npm add` is an
 * alias rather than the documented form, so it gets `install`.
 */
export function installCommand(manager: PackageManager, pkg: string): string[] {
  return manager === 'npm' ? ['npm', 'install', pkg] : [manager, 'add', pkg]
}

/**
 * How that manager runs a package script.
 *
 * Telling a pnpm user to run `npm run dev` is the kind of small wrongness that
 * makes somebody doubt everything else the tool just told them.
 */
export function runScript(manager: PackageManager, script: string): string {
  return manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`
}

/**
 * Whether the project already depends on this, under either kind of dependency.
 *
 * Somebody running `init` a second time to re-learn their content should not
 * sit through an install they do not need.
 */
export function alreadyInstalled(manifest: Manifest | undefined, pkg: string): boolean {
  if (!manifest) return false

  return Object.hasOwn(manifest.dependencies ?? {}, pkg) || Object.hasOwn(manifest.devDependencies ?? {}, pkg)
}
