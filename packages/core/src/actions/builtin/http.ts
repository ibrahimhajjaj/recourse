import { defineAction } from '../define.js'
import type { Action, ActionField, ActionInput } from '../types.js'
import { fetchWithRetry } from '../../util/http.js'

export interface HttpActionOptions {
  name: string
  whenToUse: string
  collect?: ActionField[]
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Collected inputs interpolate as `{{field}}`, url-encoded on the way in. */
  url: string
  headers?: Record<string, string>
  /** JSON body template. String values interpolate the same way. */
  body?: Record<string, unknown>
  /**
   * Which response fields the agent may see. Omit for all of them.
   *
   * Worth setting on anything that returns a customer record: the agent repeats
   * what it is given, so a response containing an internal note or another
   * customer's data is a leak waiting for the right question.
   */
  allowFields?: string[]
  /** Caps what comes back, because every byte lands in the context window. */
  maxBytes?: number
  /** Keeps it off the agent's own initiative; only a procedure can call it. */
  procedureOnly?: boolean
}

const DEFAULT_MAX_BYTES = 20_000

/**
 * Calls your own API and hands the response to the agent.
 *
 * This is the escape hatch that makes the agent useful beyond documentation:
 * order status, subscription state, stock levels, anything already behind an
 * HTTP endpoint you own.
 */
export function httpAction(options: HttpActionOptions): Action {
  const method = options.method ?? 'GET'
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  return defineAction({
    name: options.name,
    whenToUse: options.whenToUse,
    collect: options.collect,
    procedureOnly: options.procedureOnly,

    async execute(input: ActionInput, ctx) {
      const url = interpolate(options.url, input, true)


      const response = await fetchWithRetry(
        url,
        {
          method,
          headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
          body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(fill(options.body ?? {}, input)),
        },
        { signal: ctx.signal, attempts: 2 },
      )

      const text = await response.text()

      if (!response.ok) {
        // The status goes to the model, the body does not: an error page can
        // carry stack traces and internal hostnames.
        throw new Error(`${options.name} failed with status ${response.status}`)
      }

      if (text.length > maxBytes) {
        throw new Error(`${options.name} returned more than ${maxBytes} bytes; narrow the request`)
      }

      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`${options.name} did not return JSON`)
      }

      return options.allowFields?.length ? pick(data, options.allowFields) : data
    },
  })
}

/** Replaces `{{field}}`, encoding when the target is a URL. */
function interpolate(template: string, input: ActionInput, encode: boolean): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = input[key]
    if (value === undefined) return ''
    const raw = String(value)
    return encode ? encodeURIComponent(raw) : raw
  })
}

/** Walks a JSON body template, interpolating every string leaf. */
function fill(template: Record<string, unknown>, input: ActionInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') out[key] = interpolate(value, input, false)
    else if (Array.isArray(value)) out[key] = value.map((item) => (typeof item === 'string' ? interpolate(item, input, false) : item))
    else if (value && typeof value === 'object') out[key] = fill(value as Record<string, unknown>, input)
    else out[key] = value
  }

  return out
}

/** Keeps only the allowed keys, at any depth, so nested records stay filtered. */
function pick(data: unknown, allow: string[]): unknown {
  if (Array.isArray(data)) return data.map((item) => pick(item, allow))
  if (!data || typeof data !== 'object') return data

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!allow.includes(key)) continue
    out[key] = value && typeof value === 'object' ? pick(value, allow) : value
  }
  return out
}
