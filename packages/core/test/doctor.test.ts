import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCredentials, checkModel, checkStorage, exitCodeFor, formatChecks, type Check } from '../src/cli/doctor.js'
import { memoryBlobs } from '../src/storage/blobs.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Answers each URL from a map, so several providers can be checked at once. */
function stubFetch(routes: Record<string, { body: unknown; status?: number }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const match = Object.keys(routes).find((pattern) => String(url).includes(pattern))
      if (!match) return new Response('{}', { status: 404 })
      const route = routes[match] as { body: unknown; status?: number }
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
    }),
  )
}

describe('the model endpoint', () => {
  it('is skipped when none is configured, not failed', async () => {
    // No endpoint means the Gateway, which is a valid setup rather than a
    // problem to report.
    const [check] = await checkModel({})
    expect(check?.status).toBe('skip')
  })

  it('names the models it found', async () => {
    stubFetch({ '/models': { body: { data: [{ id: 'qwen3:4b' }, { id: 'nomic-embed-text' }] } } })
    const checks = await checkModel({ baseURL: 'http://localhost:11434/v1' })

    expect(checks[0]?.status).toBe('ok')
    expect(checks[0]?.detail).toContain('2 models')
  })

  it('says which model is missing and what is there instead', async () => {
    // The round trip this saves is going to look up what you actually have.
    stubFetch({ '/models': { body: { data: [{ id: 'qwen3:4b' }] } } })
    const checks = await checkModel({ baseURL: 'http://x/v1', model: 'llama3:70b' })

    const failure = checks.find((check) => check.status === 'fail')
    expect(failure?.detail).toContain('llama3:70b')
    expect(failure?.fix).toContain('qwen3:4b')
  })

  it('accepts a model named without its tag', async () => {
    stubFetch({ '/models': { body: { data: [{ id: 'nomic-embed-text:latest' }] } } })
    const checks = await checkModel({ baseURL: 'http://x/v1', embedModel: 'nomic-embed-text' })

    expect(checks.every((check) => check.status === 'ok')).toBe(true)
  })

  it('reports a rejected key differently from a wrong URL', async () => {
    stubFetch({ '/models': { body: {}, status: 401 } })
    const [check] = await checkModel({ baseURL: 'http://x/v1', apiKey: 'wrong' })

    expect(check?.status).toBe('fail')
    expect(check?.fix).toContain('key')
  })

  it('does not let an unreachable endpoint throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const [check] = await checkModel({ baseURL: 'http://nothing/v1' })

    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('ECONNREFUSED')
  })
})

describe('provider credentials', () => {
  it('checks nothing it was not given', async () => {
    expect(await checkCredentials({})).toEqual([])
  })

  it('confirms a Slack token and names the workspace', async () => {
    // A valid token for the wrong workspace is a real mistake, and the
    // workspace name is what catches it.
    stubFetch({ 'slack.com': { body: { ok: true, team: 'Lumen Coffee' } } })
    const [check] = await checkCredentials({ slack: { botToken: 'xoxb-test' } })

    expect(check?.status).toBe('ok')
    expect(check?.detail).toContain('Lumen Coffee')
  })

  it('reports Slack rejecting a token, with its reason', async () => {
    stubFetch({ 'slack.com': { body: { ok: false, error: 'invalid_auth' } } })
    const [check] = await checkCredentials({ slack: { botToken: 'bad' } })

    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('invalid_auth')
  })

  it('names the Telegram bot', async () => {
    stubFetch({ 'api.telegram.org': { body: { ok: true, result: { username: 'lumen_bot' } } } })
    const [check] = await checkCredentials({ telegram: { botToken: '123:abc' } })

    expect(check?.detail).toContain('@lumen_bot')
  })

  it('reads a Meta error rather than the status code', async () => {
    // Graph answers 200 with an error body, so the status alone says nothing.
    stubFetch({ 'graph.facebook.com': { body: { error: { message: 'Session has expired' } } } })
    const [check] = await checkCredentials({ whatsapp: { accessToken: 'expired' } })

    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('Session has expired')
  })

  it('warns when ElevenLabs is nearly out of characters', async () => {
    // This is the failure that happens mid-call rather than at startup.
    stubFetch({ 'api.elevenlabs.io': { body: { character_count: 9800, character_limit: 10000 } } })
    const [check] = await checkCredentials({ elevenlabs: { apiKey: 'xi' } })

    expect(check?.status).toBe('warn')
    expect(check?.detail).toContain('200 characters left')
  })

  it('is content with plenty of characters left', async () => {
    stubFetch({ 'api.elevenlabs.io': { body: { character_count: 100, character_limit: 10000 } } })
    const [check] = await checkCredentials({ elevenlabs: { apiKey: 'xi' } })

    expect(check?.status).toBe('ok')
  })

  it('treats a missing Firecrawl key as fine, because keyless works', async () => {
    const [check] = await checkCredentials({ firecrawl: {} })

    expect(check?.status).toBe('ok')
    expect(check?.detail).toContain('keyless')
  })

  it('checks several providers without one failure hiding the rest', async () => {
    stubFetch({
      'slack.com': { body: { ok: false, error: 'invalid_auth' } },
      'api.telegram.org': { body: { ok: true, result: { username: 'bot' } } },
    })

    const checks = await checkCredentials({
      slack: { botToken: 'bad' },
      telegram: { botToken: 'good' },
    })

    expect(checks).toHaveLength(2)
    expect(checks.find((check) => check.name === 'telegram')?.status).toBe('ok')
  })
})

describe('the report', () => {
  const checks: Check[] = [
    { name: 'index', status: 'ok', detail: 'fine' },
    { name: 'slack', status: 'fail', detail: 'rejected', fix: 'check the token' },
    { name: 'elevenlabs', status: 'warn', detail: 'nearly out' },
  ]

  it('puts problems first, because that is what a reader wants', () => {
    const lines = formatChecks(checks).split('\n').filter(Boolean)
    expect(lines[0]).toContain('slack')
  })

  it('shows the fix only for things that are not ok', () => {
    expect(formatChecks(checks)).toContain('check the token')
    expect(formatChecks([{ name: 'a', status: 'ok', detail: 'd', fix: 'unnecessary' }])).not.toContain('unnecessary')
  })

  it('fails a script on a failure but not on a warning', () => {
    expect(exitCodeFor(checks)).toBe(1)
    expect(exitCodeFor([{ name: 'a', status: 'warn', detail: 'd' }])).toBe(0)
    expect(exitCodeFor([{ name: 'a', status: 'ok', detail: 'd' }])).toBe(0)
  })

  it('says so plainly when everything works', () => {
    expect(formatChecks([{ name: 'a', status: 'ok', detail: 'd' }])).toContain('Everything checked is working')
  })
})

describe('storage', () => {
  it('confirms a bucket by writing to it, and leaves nothing behind', async () => {
    const blobs = memoryBlobs()
    const written: string[] = []
    const watched = {
      ...blobs,
      put: async (...args: Parameters<typeof blobs.put>) => (written.push(args[0]), blobs.put(...args)),
    }

    const [check] = await checkStorage(watched)

    expect(check?.status).toBe('warn')
    expect(check?.detail).toContain('cannot sign')
    expect(await blobs.head(written[0] as string)).toBeNull()
  })

  it('says which permission is missing when a write is refused', async () => {
    const blobs = memoryBlobs()
    const readOnly = {
      ...blobs,
      put: async () => {
        throw new Error('could not store "x": AccessDenied (403)')
      },
    }

    const [check] = await checkStorage(readOnly)

    expect(check?.status).toBe('fail')
    expect(check?.fix).toContain('write permission')
  })

  it('catches a bucket that accepts writes and returns nothing', async () => {
    // The shape of a misconfigured lifecycle rule, or two different buckets
    // behind one name. Green on write, empty on read.
    const blobs = memoryBlobs()
    const forgetful = { ...blobs, get: async () => null }

    const [check] = await checkStorage(forgetful)

    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('did not return it')
  })
})
