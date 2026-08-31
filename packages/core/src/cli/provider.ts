/**
 * Deciding what the agent answers with, while somebody is still here to say.
 *
 * The alternative, which this replaces, was to write the route and mention in
 * passing that a key could be set later. That reads fine and produces a widget
 * whose first reply is that the assistant is unavailable, because the default
 * model is reached through a gateway that answers 401 to nobody.
 *
 * So the question is asked once, at the point the answer is cheap, and the
 * options include one that costs nothing and needs no account: a model already
 * running on the machine.
 *
 * Everything here is a pure function over strings. `init` owns the prompting
 * and the file writing.
 */

import type { Framework } from './scaffold.js'

/** How the agent will reach a model. */
export type Provider = 'local' | 'gateway' | 'compatible' | 'later'

/** What each choice needs somebody to type. */
export interface ProviderAnswers {
  /** For `gateway`. */
  key?: string | undefined
  /** For `compatible`. */
  baseURL?: string | undefined
  model?: string | undefined
  apiKey?: string | undefined
}

/** A model already running on the machine, and the default it is reached on. */
export const OLLAMA = { baseURL: 'http://localhost:11434/v1', model: 'qwen3:4b' } as const

/**
 * Which local model to write, given what is actually pulled.
 *
 * Writing the default blind is how the free path breaks for the person who
 * chose it: they pick the model on their own machine, and the first question
 * comes back saying that model does not exist. Anything with "embed" in the
 * name is skipped, since those cannot hold a conversation.
 */
export function pickLocalModel(installed: string[], preferred: string = OLLAMA.model): string {
  if (installed.includes(preferred)) return preferred

  // Nothing pulled, or nothing reachable to ask: keep the default, which the
  // closing message tells them how to pull.
  return installed.find((name) => !/embed/i.test(name)) ?? preferred
}

/**
 * Where a framework keeps the variables it does not commit.
 *
 * Getting this wrong is silent: the file is written, the variable is never
 * read, and the only symptom is a model that still is not configured.
 */
export function envFileFor(framework: Framework): string {
  if (framework === 'next') return '.env.local'
  // Wrangler reads `.dev.vars` locally; anything in `.env` is ignored.
  if (framework === 'worker') return '.dev.vars'

  return '.env'
}

/**
 * The variables a choice comes down to.
 *
 * `local` and `compatible` are the same two variables with different values,
 * which is the point: one code path reads them, so a local Ollama and a hosted
 * endpoint are the same kind of thing to everything downstream.
 */
export function envFor(provider: Provider, answers: ProviderAnswers = {}): Record<string, string> {
  if (provider === 'local') {
    return {
      OPENAI_COMPATIBLE_BASE_URL: OLLAMA.baseURL,
      OPENAI_COMPATIBLE_MODEL: answers.model ?? OLLAMA.model,
    }
  }

  if (provider === 'gateway') {
    return answers.key ? { AI_GATEWAY_API_KEY: answers.key } : {}
  }

  if (provider === 'compatible') {
    if (!answers.baseURL || !answers.model) return {}

    return {
      OPENAI_COMPATIBLE_BASE_URL: answers.baseURL,
      OPENAI_COMPATIBLE_MODEL: answers.model,
      ...(answers.apiKey ? { OPENAI_COMPATIBLE_API_KEY: answers.apiKey } : {}),
    }
  }

  return {}
}

/**
 * The file's new contents, with anything already set left exactly as it was.
 *
 * A scaffold that overwrites a key somebody pasted an hour ago is worse than
 * one that writes nothing, because the damage is invisible until the next
 * deploy fails on a credential that used to work.
 */
export function mergeEnv(existing: string, add: Record<string, string>): string {
  const already = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.slice(0, line.indexOf('=')).trim())
      .filter(Boolean),
  )

  const missing = Object.entries(add).filter(([name]) => !already.has(name))
  if (missing.length === 0) return existing

  const body = missing.map(([name, value]) => `${name}=${value}`).join('\n')
  const separator = existing === '' ? '' : existing.endsWith('\n') ? '' : '\n'

  return `${existing}${separator}${body}\n`
}

/**
 * What to say once the choice is made.
 *
 * `later` is the only one that leaves something undone, so it is the only one
 * that says what the widget will do in the meantime. Promising an answer it
 * cannot give is how the whole thing loses trust on the first question.
 */
export function summarise(provider: Provider, envFile: string, model: string = OLLAMA.model): string {
  if (provider === 'local') {
    return `Answering with Ollama on ${OLLAMA.baseURL} using ${model}, written to ${envFile}.\nMake sure it is pulled: ollama pull ${model}`
  }

  if (provider === 'gateway') return `Answering through the AI Gateway, key written to ${envFile}.`
  if (provider === 'compatible') return `Answering through your own endpoint, written to ${envFile}.`

  return (
    'No model yet, so the widget will cite the passages it found and hand over to a person.\n' +
    `Run \`recourse model\` whenever you like and it starts answering, or set it in ${envFile} by hand.`
  )
}
