import { describe, expect, it, vi } from 'vitest'
import { createRateLimiter, callerKey, type RateLimiter } from '../src/server/ratelimit.js'
import { redisRateLimiter, upstashRateLimiter, type RedisLike } from '../src/server/ratelimit-shared.js'

/**
 * One set of assertions, three implementations. A limiter that only passes a
 * suite written for it is not interchangeable with the others, which is the
 * whole point of the interface.
 */

/** A Redis that lives in a Map, so the fixed-window logic is testable. */
function fakeRedis(): RedisLike & { store: Map<string, { count: number; expiresAt: number }> } {
  const store = new Map<string, { count: number; expiresAt: number }>()

  return {
    store,
    async incr(key) {
      const now = Date.now()
      const entry = store.get(key)
      if (!entry || (entry.expiresAt > 0 && now >= entry.expiresAt)) {
        store.set(key, { count: 1, expiresAt: 0 })
        return 1
      }
      entry.count += 1
      return entry.count
    },
    async pexpire(key, ms) {
      const entry = store.get(key)
      if (entry) entry.expiresAt = Date.now() + ms
      return 1
    },
    async pttl(key) {
      const entry = store.get(key)
      if (!entry || entry.expiresAt === 0) return -1
      return Math.max(0, entry.expiresAt - Date.now())
    },
  }
}

/** An Upstash whose sorted set lives in memory, driven through the same HTTP shape. */
function fakeUpstash(): { limiter: RateLimiter; calls: string[] } {
  const sets = new Map<string, Array<{ member: string; score: number }>>()
  const calls: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(String(url))
      const commands = JSON.parse(String(init.body)) as string[][]
      const results: Array<{ result: unknown }> = []

      for (const [name, key, ...args] of commands) {
        const entries = sets.get(key as string) ?? []

        if (name === 'ZREMRANGEBYSCORE') {
          const max = Number(args[1])
          sets.set(key as string, entries.filter((entry) => entry.score > max))
          results.push({ result: 0 })
        } else if (name === 'ZADD') {
          entries.push({ score: Number(args[0]), member: String(args[1]) })
          sets.set(key as string, entries)
          results.push({ result: 1 })
        } else if (name === 'ZCARD') {
          results.push({ result: entries.length })
        } else if (name === 'ZRANGE') {
          const oldest = [...entries].sort((a, b) => a.score - b.score)[0]
          results.push({ result: oldest ? [oldest.member, String(oldest.score)] : [] })
        } else {
          results.push({ result: 1 })
        }
      }

      return new Response(JSON.stringify(results), { status: 200 })
    }),
  )

  return { limiter: upstashRateLimiter({ url: 'https://fake.upstash.io', token: 't', limit: 3, windowMs: 1000 }), calls }
}

const implementations: Array<[string, () => RateLimiter]> = [
  ['memory', () => ({ check: createRateLimiter({ limit: 3, windowMs: 1000 }) })],
  ['redis', () => redisRateLimiter({ client: fakeRedis(), limit: 3, windowMs: 1000 })],
  ['upstash', () => fakeUpstash().limiter],
]

for (const [name, make] of implementations) {
  describe(`${name} limiter`, () => {
    it('allows up to the limit and then refuses', async () => {
      const limiter = make()

      for (let attempt = 1; attempt <= 3; attempt++) {
        expect((await limiter.check('caller')).ok, `attempt ${attempt}`).toBe(true)
      }

      const blocked = await limiter.check('caller')
      expect(blocked.ok).toBe(false)
      expect(blocked.retryAfter).toBeGreaterThan(0)
    })

    it('counts each caller separately', async () => {
      const limiter = make()

      for (let attempt = 0; attempt < 3; attempt++) await limiter.check('noisy')
      expect((await limiter.check('noisy')).ok).toBe(false)

      // One caller exhausting their budget must not shut out everybody else.
      expect((await limiter.check('quiet')).ok).toBe(true)
    })

    it('lets the caller back in once the window passes', async () => {
      vi.useFakeTimers()
      try {
        const limiter = make()
        for (let attempt = 0; attempt < 4; attempt++) await limiter.check('caller')
        expect((await limiter.check('caller')).ok).toBe(false)

        vi.advanceTimersByTime(1500)
        expect((await limiter.check('caller')).ok).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives a retryAfter in whole seconds, never zero when refusing', async () => {
      const limiter = make()
      for (let attempt = 0; attempt < 4; attempt++) await limiter.check('caller')

      const blocked = await limiter.check('caller')
      // A Retry-After of 0 tells a client to try again immediately, which is
      // the opposite of what a refusal means.
      expect(blocked.retryAfter).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(blocked.retryAfter)).toBe(true)
    })
  })
}

describe('a limit of zero', () => {
  it('turns the limiter off rather than refusing everything', async () => {
    for (const limiter of [
      { check: createRateLimiter({ limit: 0 }) },
      redisRateLimiter({ client: fakeRedis(), limit: 0 }),
      upstashRateLimiter({ url: 'https://fake.upstash.io', token: 't', limit: 0 }),
    ]) {
      for (let attempt = 0; attempt < 20; attempt++) {
        expect((await limiter.check('anyone')).ok).toBe(true)
      }
    }
  })
})

describe('when the limiter itself is down', () => {
  it('lets the request through rather than closing the support channel', async () => {
    // A Redis outage turning every customer away is a worse failure than a few
    // minutes of unmetered traffic.
    const broken: RedisLike = {
      async incr() { throw new Error('connection refused') },
      async pexpire() { throw new Error('connection refused') },
      async pttl() { throw new Error('connection refused') },
    }

    expect((await redisRateLimiter({ client: broken, limit: 1 }).check('caller')).ok).toBe(true)
  })

  it('does the same when Upstash is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const limiter = upstashRateLimiter({ url: 'https://fake.upstash.io', token: 't', limit: 1 })

    expect((await limiter.check('caller')).ok).toBe(true)
    vi.unstubAllGlobals()
  })

  it('does the same when Upstash returns an error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ error: 'WRONGTYPE' }]), { status: 200 })))
    const limiter = upstashRateLimiter({ url: 'https://fake.upstash.io', token: 't', limit: 1 })

    expect((await limiter.check('caller')).ok).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('the Upstash request itself', () => {
  it('goes to multi-exec, because pipelining is not atomic', async () => {
    // Upstash documents /pipeline as non-atomic: another caller's commands can
    // interleave between the count and the write, and both be told they were
    // under the limit.
    const { limiter, calls } = fakeUpstash()
    await limiter.check('caller')

    expect(calls[0]).toContain('/multi-exec')
    expect(calls[0]).not.toContain('/pipeline')
    vi.unstubAllGlobals()
  })
})

describe('through the chat handler', () => {
  it('uses a shared limiter when one is given', async () => {
    const seen: string[] = []
    const shared: RateLimiter = {
      check(key) {
        seen.push(key)
        return { ok: false, retryAfter: 42 }
      },
    }

    const { createChatHandler } = await import('../src/server/handler.js')
    const handler = createChatHandler({
      index: { version: 1, createdAt: '', chunks: [], keyword: { postings: {}, lengths: [], averageLength: 0, documents: 0 }, stats: { documents: 0, chunks: 0, characters: 0, embedded: 0 } } as never,
      rateLimiter: shared,
    })

    const response = await handler(
      new Request('https://example.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
        body: JSON.stringify({ message: 'hello' }),
      }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('42')
    // Keyed on the caller, not on the whole endpoint.
    expect(seen).toEqual(['203.0.113.5'])
  })
})

describe('identifying the caller', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18' },
    })
    expect(callerKey(request)).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip, then to unknown', () => {
    expect(callerKey(new Request('https://example.com', { headers: { 'x-real-ip': '198.51.100.7' } }))).toBe('198.51.100.7')
    expect(callerKey(new Request('https://example.com'))).toBe('unknown')
  })
})
