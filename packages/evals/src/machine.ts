/**
 * Being a considerate guest on the machine running the models.
 *
 * A local benchmark is not free the way a hosted one is: it takes the whole
 * laptop for as long as it runs, and a 7GB model on a 16GB machine pushes
 * everything else into swap. That is not a theoretical concern, it happened,
 * and the answer was to kill the model server mid-run.
 *
 * So the runner checks before it starts and gives the memory back when it
 * finishes, rather than leaving a model resident because the next run might
 * want it.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { freemem, totalmem, platform } from 'node:os'

const run = promisify(execFile)

export interface Headroom {
  /** Free memory as a fraction, 0 to 1. */
  free: number
  /** How it was measured, since the platforms disagree on what "free" means. */
  source: string
}

/**
 * How much memory is actually available.
 *
 * `os.freemem()` is the wrong number on macOS: it reports genuinely untouched
 * pages, which sit near zero on a healthy machine because the OS uses
 * everything it can for cache. `memory_pressure` reports the figure that
 * corresponds to what Activity Monitor calls free, which is the one worth
 * making a decision on.
 */
export async function headroom(): Promise<Headroom> {
  if (platform() === 'darwin') {
    try {
      const { stdout } = await run('memory_pressure', [], { timeout: 5_000 })
      const match = /System-wide memory free percentage:\s*([\d.]+)%/.exec(stdout)
      if (match) return { free: Number(match[1]) / 100, source: 'memory_pressure' }
    } catch {
      // Fall through to the portable answer rather than refusing to run.
    }
  }

  return { free: freemem() / totalmem(), source: 'os.freemem' }
}

/**
 * Refuses to start a run that would make the machine unusable.
 *
 * Returns a reason to print rather than throwing, because "come back later" is
 * advice, not an error.
 */
export async function tooTightToRun(needFraction = 0.25): Promise<string | null> {
  const { free, source } = await headroom()
  if (free >= needFraction) return null

  return (
    `Only ${(free * 100).toFixed(0)}% of memory is free (${source}), and a local model needs room to work. ` +
    `Close something, or run with --force if you know better.`
  )
}

/**
 * Hands the memory back.
 *
 * Ollama keeps a model resident for five minutes after the last request, which
 * is the right default when you are chatting and the wrong one when a suite has
 * just finished and the machine has other work to do. A request with
 * `keep_alive: 0` unloads it immediately.
 */
export async function unload(baseURL: string, model: string): Promise<boolean> {
  // The generate endpoint is a sibling of the OpenAI-compatible path Ollama
  // also serves, so the /v1 suffix has to come off.
  const root = baseURL.replace(/\/v1\/?$/, '')

  try {
    const response = await fetch(`${root}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    })
    if (!response.ok) return false

    // Confirm rather than assume. Reporting a memory figure here would be
    // worse than saying nothing: the OS has not finished reclaiming the pages
    // by the time this returns, so the number reads lower than before the
    // unload and looks like the opposite of what happened.
    return await isUnloaded(root, model)
  } catch {
    // Not every endpoint is an Ollama, and failing to tidy up is not a reason
    // to fail a run that has already produced its numbers.
    return false
  }
}

/** Whether the model is really out of memory, according to the server. */
async function isUnloaded(root: string, model: string): Promise<boolean> {
  try {
    const response = await fetch(`${root}/api/ps`)
    if (!response.ok) return false

    const body = (await response.json()) as { models?: Array<{ name?: string }> }
    return !(body.models ?? []).some((loaded) => loaded.name === model || loaded.name?.startsWith(`${model}:`))
  } catch {
    return false
  }
}
