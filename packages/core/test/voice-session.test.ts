import { describe, expect, it, vi } from 'vitest'
import { createCallSession, type CallMessage } from '../src/channels/voice-session.js'
import type { Transcriber } from '../src/channels/voice-stt.js'
import type { Voice } from '../src/channels/voice-tts.js'

const RATE = 16_000
/** 20ms of audio, which is what a capture worklet hands over. */
const SLICE = RATE / 50

const quiet = () => new Int16Array(SLICE)
const loud = () => Int16Array.from({ length: SLICE }, (_, at) => (at % 2 ? 8000 : -8000))

/** Waits for the turn to be answered, which happens off the push. */
const settle = async () => {
  for (let tick = 0; tick < 40; tick++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function harness(options: { answer?: string[]; heard?: string; slowSpeak?: boolean } = {}) {
  const sent: CallMessage[] = []
  const spoken: string[] = []
  let speakAborted = 0

  const transcriber: Transcriber = {
    name: 'test',
    transcribe: async () => ({ text: options.heard ?? 'where is my order' }),
  }

  const voice: Voice = {
    name: 'test',
    speak: async (text, signal) => {
      if (options.slowSpeak) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        if (signal?.aborted) {
          speakAborted++
          throw new Error('aborted')
        }
      }
      spoken.push(text)

      return { audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }
    },
  }

  const agent = {
    async *stream() {
      for (const text of options.answer ?? ['It shipped on Tuesday. ', 'You will have it Friday.']) {
        yield { type: 'delta', text }
      }
    },
  }

  const session = createCallSession({
    agent,
    transcriber,
    voice,
    sampleRate: RATE,
    send: (message) => void sent.push(message),
    speak: () => {},
  })

  /** Talks for `ms`, then goes quiet long enough to end the turn. */
  const say = (ms = 600) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) session.push(loud())
    for (let elapsed = 0; elapsed < 900; elapsed += 20) session.push(quiet())
  }

  return { session, sent, spoken, say, get speakAborted() { return speakAborted } }
}

describe('running a turn', () => {
  it('listens, transcribes, answers, and speaks it', async () => {
    const call = harness()
    call.say()
    await settle()

    const types = call.sent.map((message) => message.type)
    expect(types).toContain('listening')
    expect(types).toContain('thinking')
    expect(types).toContain('speaking')
    expect(call.spoken.length).toBeGreaterThan(0)
  })

  it('speaks a sentence at a time rather than after the whole answer', async () => {
    // Most of what makes a call feel quick: the caller hears the opening
    // clause while the rest is still being written.
    const call = harness({ answer: ['It shipped on Tuesday. ', 'You will have it Friday. '] })
    call.say()
    await settle()

    expect(call.spoken.length).toBeGreaterThan(1)
    expect(call.spoken[0]).toContain('Tuesday')
  })

  it('puts both sides in the transcript', async () => {
    const call = harness()
    call.say()
    await settle()

    const said = call.sent.filter((message) => message.type === 'transcript')
    expect(said).toContainEqual({ type: 'transcript', role: 'visitor', text: 'where is my order' })
    expect(said.some((message) => 'role' in message && message.role === 'agent')).toBe(true)
  })

  it('keeps the history so the next turn has context', async () => {
    const call = harness()
    call.say()
    await settle()

    expect(call.session.history.map((message) => message.role)).toEqual(['user', 'assistant'])
  })

  it('says nothing when the caller was not speaking', async () => {
    const call = harness()
    for (let elapsed = 0; elapsed < 2000; elapsed += 20) call.session.push(quiet())
    await settle()

    expect(call.sent).toEqual([])
    expect(call.spoken).toEqual([])
  })

  it('drops a turn the transcriber heard nothing in', async () => {
    const call = harness({ heard: '   ' })
    call.say()
    await settle()

    expect(call.spoken).toEqual([])
    expect(call.sent.some((message) => message.type === 'speaking')).toBe(false)
  })
})

describe('talking over the agent', () => {
  /**
   * A call held open at the first sentence, so the interruption lands at a
   * known point rather than whenever the event loop happens to be.
   */
  function held() {
    const sent: CallMessage[] = []
    const spoken: string[] = []
    let atFirst: (() => void) | undefined
    const reached = new Promise<void>((resolve) => {
      atFirst = resolve
    })
    let release: (() => void) | undefined
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })

    const session = createCallSession({
      agent: {
        async *stream() {
          for (const text of ['One. ', 'Two. ', 'Three. ', 'Four. ']) yield { type: 'delta', text }
        },
      },
      transcriber: { name: 't', transcribe: async () => ({ text: 'hello' }) },
      voice: {
        name: 'v',
        speak: async (text, signal) => {
          if (spoken.length === 0) {
            atFirst?.()
            await waiting
          }
          if (signal?.aborted) throw new Error('aborted')
          spoken.push(text)

          return { audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }
        },
      },
      sampleRate: RATE,
      send: (message) => void sent.push(message),
      speak: () => {},
    })

    return { session, sent, spoken, reached, release: () => release?.() }
  }

  it('abandons the rest of the answer rather than finishing it', async () => {
    // The bug this exists to stop: the agent carrying on through three more
    // sentences after the caller has started talking over it.
    const call = held()

    for (let elapsed = 0; elapsed < 600; elapsed += 20) call.session.push(loud())
    for (let elapsed = 0; elapsed < 900; elapsed += 20) call.session.push(quiet())
    await call.reached

    for (let elapsed = 0; elapsed < 400; elapsed += 20) call.session.push(loud())
    call.release()
    await settle()

    expect(call.sent.some((message) => message.type === 'interrupted')).toBe(true)
    // Nothing after the sentence that was already in the air.
    expect(call.spoken).toEqual([])
  })

  it('does not report a failure when the caller simply interrupted', async () => {
    // An abort is somebody talking, not something breaking, and telling them
    // an error occurred because they spoke would be worse than saying nothing.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const call = held()

    for (let elapsed = 0; elapsed < 600; elapsed += 20) call.session.push(loud())
    for (let elapsed = 0; elapsed < 900; elapsed += 20) call.session.push(quiet())
    await call.reached

    for (let elapsed = 0; elapsed < 400; elapsed += 20) call.session.push(loud())
    call.release()
    await settle()

    expect(call.sent.some((message) => message.type === 'error')).toBe(false)
    errors.mockRestore()
  })
})

describe('hanging up', () => {
  it('stops answering and ignores anything that arrives after', async () => {
    const call = harness()
    call.session.close()
    call.say()
    await settle()

    expect(call.sent).toEqual([])
    expect(call.spoken).toEqual([])
  })
})

describe('when something breaks', () => {
  it('tells the caller rather than going silent', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sent: CallMessage[] = []

    const session = createCallSession({
      agent: {
        // eslint-disable-next-line require-yield
        async *stream() {
          throw new Error('the model is down')
        },
      },
      transcriber: { name: 't', transcribe: async () => ({ text: 'hello' }) },
      voice: { name: 'v', speak: async () => ({ audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }) },
      sampleRate: RATE,
      send: (message) => void sent.push(message),
      speak: () => {},
    })

    for (let elapsed = 0; elapsed < 600; elapsed += 20) session.push(loud())
    for (let elapsed = 0; elapsed < 900; elapsed += 20) session.push(quiet())
    await settle()

    expect(sent.some((message) => message.type === 'error')).toBe(true)
    errors.mockRestore()
  })
})

describe('what a business gets to decide', () => {
  function opened(options: Record<string, unknown>) {
    const sent: CallMessage[] = []
    const spoken: string[] = []
    const turns: Array<{ question: string; answer: string }> = []
    const endings: string[] = []

    const session = createCallSession({
      agent: {
        async *stream() {
          yield { type: 'delta', text: 'It shipped on Tuesday. ' }
        },
      },
      transcriber: { name: 't', transcribe: async () => ({ text: 'where is my order' }) },
      voice: {
        name: 'v',
        speak: async (text) => {
          spoken.push(text)

          return { audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }
        },
      },
      sampleRate: RATE,
      send: (message) => void sent.push(message),
      speak: () => {},
      onTurn: (turn) => void turns.push({ question: turn.question, answer: turn.answer }),
      onEnded: (reason) => void endings.push(reason),
      ...options,
    })

    return { session, sent, spoken, turns, endings }
  }

  it('greets the caller, who otherwise hears silence and hangs up', async () => {
    const call = opened({ greeting: 'Hello, Lumen Coffee. How can I help?' })
    call.session.open()
    await settle()

    expect(call.spoken).toContain('Hello, Lumen Coffee. How can I help?')
    expect(call.sent.some((message) => message.type === 'speaking')).toBe(true)
  })

  it('puts the greeting in the transcript, like anything else it says', async () => {
    const call = opened({ greeting: 'Hello there.' })
    call.session.open()
    await settle()

    expect(call.sent).toContainEqual({ type: 'transcript', role: 'agent', text: 'Hello there.' })
    expect(call.session.history.map((message) => message.role)).toEqual(['assistant'])
  })

  it('lets somebody talk straight over the greeting', async () => {
    // A caller who already knows what they want should not have to wait
    // through a sentence they have heard before.
    const call = opened({ greeting: 'Hello, and welcome to a very long introduction.' })
    call.session.open()

    for (let elapsed = 0; elapsed < 600; elapsed += 20) call.session.push(loud())
    await settle()

    // `interrupted` specifically. `listening` fires whenever somebody starts
    // talking and would pass even if the greeting were not interruptible.
    expect(call.sent.some((message) => message.type === 'interrupted')).toBe(true)
  })

  it('says nothing at all when no greeting is set', async () => {
    const call = opened({})
    call.session.open()
    await settle()

    expect(call.spoken).toEqual([])
  })

  it('reports each finished turn, for logging or billing', async () => {
    const call = opened({})
    call.session.open()
    for (let elapsed = 0; elapsed < 600; elapsed += 20) call.session.push(loud())
    for (let elapsed = 0; elapsed < 900; elapsed += 20) call.session.push(quiet())
    await settle()

    expect(call.turns).toHaveLength(1)
    expect(call.turns[0]?.question).toBe('where is my order')
    expect(call.turns[0]?.answer).toContain('Tuesday')
  })

  it('ends a call that runs past its limit, because a bill has no cap otherwise', async () => {
    const call = opened({ maxCallMs: 30 })
    call.session.open()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(call.endings).toEqual(['too-long'])
    expect(call.sent.some((message) => message.type === 'error')).toBe(true)
  })

  it('runs without a limit when none is set', async () => {
    const call = opened({})
    call.session.open()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(call.endings).toEqual([])
  })

  it('reports a hang-up once, not once per way of hanging up', async () => {
    const call = opened({ maxCallMs: 10_000 })
    call.session.open()
    call.session.close()
    call.session.close()

    expect(call.endings).toEqual(['hangup'])
  })
})
