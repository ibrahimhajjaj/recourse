import { describe, expect, it, vi } from 'vitest'
import { answerFilter, createHooks } from '../src/hooks.js'
import { createOpenerFilter } from '../src/server/opener.js'

/**
 * A filter that signs whatever passes through it.
 *
 * Appended rather than prepended so the marks in an assertion read in the
 * order the filters actually ran.
 */
const marks = (mark: string) => () => ({
  push: (text: string) => (text ? `${text}${mark}` : ''),
  flush: () => '',
})

const run = (hooks: ReturnType<typeof createHooks>, pieces: string[]): string => {
  const filter = answerFilter(hooks, {})
  if (!filter) return pieces.join('')

  return pieces.map((piece) => filter.push(piece)).join('') + filter.flush()
}

describe('keeping one tenant out of another tenant', () => {
  it('does not let a fork reach the registry it came from', () => {
    // The whole reason this is not a global. A shop registering a filter must
    // not have it run on a different shop's answer.
    const house = createHooks()
    const shop = house.fork()
    shop.filter('answer', marks('[shop]'))

    expect(run(house, ['hello'])).toBe('hello')
    expect(run(shop, ['hello'])).toBe('hello[shop]')
  })

  it('does not let one fork reach a sibling', () => {
    const house = createHooks()
    const a = house.fork()
    const b = house.fork()
    a.filter('answer', marks('[a]'))
    b.filter('answer', marks('[b]'))

    expect(run(a, ['x'])).toBe('x[a]')
    expect(run(b, ['x'])).toBe('x[b]')
  })

  it('carries what the parent already had at the moment of forking', () => {
    const house = createHooks()
    house.filter('answer', marks('[house]'))
    const shop = house.fork()
    shop.filter('answer', marks('[shop]'))

    expect(run(shop, ['x'])).toBe('x[house][shop]')
  })

  it('does not push a later parent rule into an existing fork', () => {
    // A fork is a copy taken at a moment, not a live view. Otherwise adding a
    // house rule silently changes every tenant already running.
    const house = createHooks()
    const shop = house.fork()
    house.filter('answer', marks('[late]'))

    expect(run(shop, ['x'])).toBe('x')
  })
})

describe('order', () => {
  it('runs lower priority first, and ties in the order they were added', () => {
    const hooks = createHooks()
    hooks.filter('answer', marks('[third]'), 30)
    hooks.filter('answer', marks('[first]'), 5)
    hooks.filter('answer', marks('[second-a]'), 20)
    hooks.filter('answer', marks('[second-b]'), 20)

    expect(run(hooks, ['x'])).toBe('x[first][second-a][second-b][third]')
  })

  it('takes a filter off again when asked', () => {
    const hooks = createHooks()
    const remove = hooks.filter('answer', marks('[gone]'))

    expect(run(hooks, ['x'])).toBe('x[gone]')
    remove()
    expect(run(hooks, ['x'])).toBe('x')
  })
})

describe('a filter that is wrong', () => {
  it('passes the text through when one throws', () => {
    // An extension point that can break the answer is worse than none.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks = createHooks()
    hooks.filter('answer', () => ({
      push: () => {
        throw new Error('bad filter')
      },
      flush: () => '',
    }))

    expect(run(hooks, ['the answer'])).toBe('the answer')
    errors.mockRestore()
  })

  it('ignores one that returns something that is not text', () => {
    // Otherwise an object renders as "[object Object]" on a customer's screen.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks = createHooks()
    hooks.filter('answer', () => ({ push: () => ({ nope: true }) as never, flush: () => '' }))

    expect(run(hooks, ['the answer'])).toBe('the answer')
    errors.mockRestore()
  })

  it('keeps the other filters working when one misbehaves', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks = createHooks()
    hooks.filter('answer', () => ({
      push: () => {
        throw new Error('bad')
      },
      flush: () => '',
    }), 5)
    hooks.filter('answer', marks('[good]'), 10)

    expect(run(hooks, ['x'])).toBe('x[good]')
    errors.mockRestore()
  })

  it('survives one that cannot even be built', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks = createHooks()
    hooks.filter('answer', () => {
      throw new Error('cannot build')
    })
    hooks.filter('answer', marks('[good]'))

    expect(run(hooks, ['x'])).toBe('x[good]')
    errors.mockRestore()
  })
})

describe('listeners', () => {
  it('tells them what happened, in order', () => {
    const seen: string[] = []
    const hooks = createHooks()
    hooks.on('turn.start', () => void seen.push('second'), 20)
    hooks.on('turn.start', () => void seen.push('first'), 5)
    hooks.emit('turn.start', {})

    expect(seen).toEqual(['first', 'second'])
  })

  it('carries on when one throws', () => {
    // The thing being watched still happened.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: string[] = []
    const hooks = createHooks()
    hooks.on('turn.start', () => {
      throw new Error('bad listener')
    })
    hooks.on('turn.start', () => void seen.push('ran'))

    expect(() => hooks.emit('turn.start', {})).not.toThrow()
    expect(seen).toEqual(['ran'])
    errors.mockRestore()
  })
})

describe('streaming through more than one', () => {
  it('lets text held by one still pass through the next', () => {
    // The trap: a filter that buffers would otherwise flush straight past the
    // filters after it, and its text would escape them entirely.
    const hooks = createHooks()
    hooks.filter('answer', createOpenerFilter, 5)
    hooks.filter('answer', marks('>'), 10)

    expect(run(hooks, ['Certainly! ', 'Ships today.'])).toBe('Ships today.>')
  })

  it('does nothing at all when nothing is registered', () => {
    expect(answerFilter(createHooks(), {})).toBeNull()
    expect(answerFilter(undefined, {})).toBeNull()
  })
})

describe('an agent using a registry', () => {
  it('sends the answer through the filters and nothing else', async () => {
    const { createAgent } = await import('../src/agent.js')
    const { buildIndex } = await import('../src/knowledge/build.js')
    const { textSource } = await import('../src/sources/text.js')
    const { MockLanguageModelV4 } = await import('ai/test')
    const { simulateReadableStream } = await import('ai')

    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 8, text: 8, reasoning: 0 },
    }

    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'Certainly! ' },
            { type: 'text-delta' as const, id: '0', delta: 'Delivery takes four days.' },
            { type: 'text-end' as const, id: '0' },
            { type: 'finish' as const, finishReason: { unified: 'stop', raw: 'stop' } as const, usage },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })

    const index = await buildIndex({
      sources: [textSource([{ id: 'd', title: 'Delivery', text: 'Delivery takes four days.' }])],
      embed: false,
    })

    const hooks = createHooks()
    hooks.filter('answer', createOpenerFilter)

    const agent = createAgent({ index, model, hooks, classifier: false, embedder: false })

    let text = ''
    for await (const frame of agent.stream([{ role: 'user', content: 'how long is delivery' }])) {
      if (frame.type === 'delta') text += frame.text
    }

    // The pleasantry the model wrote never reached the customer.
    expect(text).toBe('Delivery takes four days.')
    expect(text).not.toContain('Certainly')
  })
})
