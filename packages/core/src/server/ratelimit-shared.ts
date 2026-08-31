/**
 * Rate limiters that several instances share.
 *
 * The in-memory one is per-instance, so on serverless N instances give a caller
 * N times the budget and every cold start hands out a fresh one. That is an
 * honest trade for having nothing to run, and it is not a budget control on a
 * public endpoint that spends model tokens.
 *
 * Neither of these adds a dependency. Upstash is reached over HTTP with fetch,
 * and the Redis one takes a client you already have rather than importing one.
 */

import type { RateLimiter, RateLimitResult } from './ratelimit.js'

export interface UpstashRateLimitOptions {
  /** The REST URL from the Upstash console. */
  url: string
  /** The REST token. The read-only one will not do: this writes. */
  token: string
  /** Requests per window, per caller. */
  limit?: number
  windowMs?: number
  /** Distinguishes deployments sharing one database. */
  prefix?: string
}

/**
 * A sliding window over Upstash Redis, through their REST API.
 *
 * Sliding rather than fixed because a fixed window lets a caller spend their
 * whole budget in the last second of one window and again in the first second
 * of the next, which is twice the limit across a moment that spans the
 * boundary.
 *
 * Sent to `/multi-exec` rather than `/pipeline`: pipelining is explicitly not
 * atomic in their API, so another caller's commands can interleave between the
 * count and the write and both be told they were under the limit.
 */
export function upstashRateLimiter(options: UpstashRateLimitOptions): RateLimiter {
  const limit = options.limit ?? 30
  const windowMs = options.windowMs ?? 60_000
  const prefix = options.prefix ?? 'recourse:rl'
  const root = options.url.replace(/\/+$/, '')

  return {
    async check(key: string): Promise<RateLimitResult> {
      if (limit <= 0) return { ok: true, retryAfter: 0 }

      const now = Date.now()
      const bucket = `${prefix}:${key}`
      // Unique per request, or two requests in the same millisecond would be
      // one member of the sorted set and count once.
      const member = `${now}-${Math.random().toString(36).slice(2, 10)}`

      let results: Array<{ result?: unknown; error?: string }>

      try {
        const response = await fetch(`${root}/multi-exec`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            // Anything older than the window is no longer spending budget.
            ['ZREMRANGEBYSCORE', bucket, '0', String(now - windowMs)],
            ['ZADD', bucket, String(now), member],
            ['ZCARD', bucket],
            // The oldest surviving entry says when a slot frees up.
            ['ZRANGE', bucket, '0', '0', 'WITHSCORES'],
            // So an idle caller's key does not live forever.
            ['PEXPIRE', bucket, String(windowMs)],
          ]),
        })

        if (!response.ok) return failOpen()
        results = (await response.json()) as Array<{ result?: unknown; error?: string }>
      } catch {
        return failOpen()
      }

      if (!Array.isArray(results) || results.some((entry) => entry?.error)) return failOpen()

      const count = Number(results[2]?.result ?? 0)
      if (count <= limit) return { ok: true, retryAfter: 0 }

      // ZRANGE WITHSCORES returns [member, score]. The oldest request leaves
      // the window one full window after it arrived.
      const oldest = Number((results[3]?.result as unknown[] | undefined)?.[1] ?? now)
      const freesAt = oldest + windowMs
      return { ok: false, retryAfter: Math.max(1, Math.ceil((freesAt - now) / 1000)) }
    },
  }
}

/**
 * Any Redis client with `incr` and `pexpire`.
 *
 * Deliberately structural rather than an ioredis import: node-redis, ioredis
 * and most wrappers all satisfy it, and none of them becomes a dependency of
 * this package.
 */
export interface RedisLike {
  incr(key: string): Promise<number>
  pexpire(key: string, milliseconds: number): Promise<unknown>
  pttl(key: string): Promise<number>
}

export interface RedisRateLimitOptions {
  client: RedisLike
  limit?: number
  windowMs?: number
  prefix?: string
}

/**
 * A fixed window over any Redis.
 *
 * Fixed rather than sliding because `INCR` plus `PEXPIRE` is two commands
 * every client already has, where a sliding window wants sorted sets and a
 * transaction. The boundary burst is real, up to twice the limit across the
 * moment a window rolls, and for a chat endpoint that is an acceptable trade
 * against the setup it saves. Use the Upstash one if it is not.
 */
export function redisRateLimiter(options: RedisRateLimitOptions): RateLimiter {
  const limit = options.limit ?? 30
  const windowMs = options.windowMs ?? 60_000
  const prefix = options.prefix ?? 'recourse:rl'

  return {
    async check(key: string): Promise<RateLimitResult> {
      if (limit <= 0) return { ok: true, retryAfter: 0 }

      const bucket = `${prefix}:${key}`

      try {
        const count = await options.client.incr(bucket)

        // Only the request that created the key sets the expiry, so the window
        // is measured from the first request rather than sliding forward with
        // every one after it.
        if (count === 1) {
          await options.client.pexpire(bucket, windowMs)
          return { ok: true, retryAfter: 0 }
        }

        if (count <= limit) return { ok: true, retryAfter: 0 }

        const remaining = await options.client.pttl(bucket)
        // A key with no expiry would block that caller forever; give it one.
        if (remaining < 0) await options.client.pexpire(bucket, windowMs)

        return { ok: false, retryAfter: Math.max(1, Math.ceil((remaining > 0 ? remaining : windowMs) / 1000)) }
      } catch {
        return failOpen()
      }
    },
  }
}

/**
 * What to do when the limiter itself is unreachable.
 *
 * Letting the request through. A rate limiter exists to protect a budget, and
 * a Redis outage turning every customer away is a worse failure than a few
 * minutes of unmetered traffic. The alternative, failing closed, means one
 * dependency can take the whole support channel down.
 */
function failOpen(): RateLimitResult {
  return { ok: true, retryAfter: 0 }
}
