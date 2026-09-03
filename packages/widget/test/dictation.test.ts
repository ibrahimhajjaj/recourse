import { beforeEach, describe, expect, it } from 'vitest'
import { createDictation, dictationSupported, speechRecognition } from '../src/dictation.js'
import { DEFAULT_STRINGS } from '../src/strings.js'

/**
 * A stand-in for the browser's recognition object, so the state machine can be
 * tested without a microphone or a browser that has one.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = []

  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  processLocally?: boolean
  started = false
  aborted = false
  stopped = false

  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null

  constructor() {
    FakeRecognition.instances.push(this)
  }

  start() {
    if (this.started) throw new Error('already started')
    this.started = true
    this.onstart?.()
  }

  stop() {
    this.stopped = true
    this.onend?.()
  }

  abort() {
    this.aborted = true
    this.onend?.()
  }

  /** Drives a result the way the browser would. */
  say(text: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: Object.assign([Object.assign([{ transcript: text }], { isFinal })], { length: 1 }),
    })
  }

  fail(error: string) {
    this.onerror?.({ error })
  }
}

function scopeWith(recognition: unknown, lang = ''): typeof globalThis {
  return {
    SpeechRecognition: recognition,
    document: { documentElement: { lang } },
  } as unknown as typeof globalThis
}

beforeEach(() => {
  FakeRecognition.instances = []
})

describe('feature detection', () => {
  it('finds the unprefixed constructor', () => {
    expect(dictationSupported(scopeWith(FakeRecognition))).toBe(true)
  })

  it('finds the webkit-prefixed one, which is what Chrome and Safari expose', () => {
    const scope = { webkitSpeechRecognition: FakeRecognition } as unknown as typeof globalThis
    expect(speechRecognition(scope)).toBe(FakeRecognition as never)
  })

  it('reports unsupported when neither exists', () => {
    // Firefox. The button is hidden rather than shown broken.
    expect(dictationSupported({} as typeof globalThis)).toBe(false)
    expect(createDictation({}, {} as typeof globalThis)).toBeNull()
  })
})

describe('recording', () => {
  it('starts, reports state, and stops', () => {
    const states: boolean[] = []
    const dictation = createDictation({ onStateChange: (r) => states.push(r) }, scopeWith(FakeRecognition))!

    expect(dictation.recording).toBe(false)
    dictation.start()
    expect(dictation.recording).toBe(true)

    dictation.stop()
    expect(dictation.recording).toBe(false)
    expect(states).toEqual([true, false])
  })

  it('ignores a second start while already recording', () => {
    // Otherwise the API throws, because the same object cannot run twice.
    const dictation = createDictation({}, scopeWith(FakeRecognition))!
    dictation.start()
    dictation.start()

    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('toggles', () => {
    const dictation = createDictation({}, scopeWith(FakeRecognition))!
    dictation.toggle()
    expect(dictation.recording).toBe(true)
    dictation.toggle()
    expect(dictation.recording).toBe(false)
  })

  it('cancel discards rather than keeping what was heard', () => {
    const dictation = createDictation({}, scopeWith(FakeRecognition))!
    dictation.start()
    dictation.cancel()

    const instance = FakeRecognition.instances[0] as FakeRecognition
    expect(instance.aborted).toBe(true)
    expect(instance.stopped).toBe(false)
  })

  it('asks for continuous recognition with interim results', () => {
    // Without continuous the browser stops at the first pause, turning one
    // sentence into three dictations; without interim results the visitor
    // watches nothing happen for several seconds.
    createDictation({}, scopeWith(FakeRecognition))!.start()

    const instance = FakeRecognition.instances[0] as FakeRecognition
    expect(instance.continuous).toBe(true)
    expect(instance.interimResults).toBe(true)
  })
})

describe('transcription', () => {
  it('reports interim text separately from finished phrases', () => {
    const interim: string[] = []
    const final: string[] = []
    const dictation = createDictation(
      { onInterim: (t) => interim.push(t), onFinal: (t) => final.push(t) },
      scopeWith(FakeRecognition),
    )!

    dictation.start()
    const instance = FakeRecognition.instances[0] as FakeRecognition

    instance.say('where is my', false)
    instance.say('where is my order', true)

    expect(interim).toEqual(['where is my'])
    expect(final).toEqual(['where is my order'])
  })
})

describe('language', () => {
  it('takes the page language when none is given', () => {
    createDictation({}, scopeWith(FakeRecognition, 'ar-EG'))!.start()
    expect((FakeRecognition.instances[0] as FakeRecognition).lang).toBe('ar-EG')
  })

  it('prefers an explicit one', () => {
    createDictation({ lang: 'fr-FR' }, scopeWith(FakeRecognition, 'en-GB'))!.start()
    expect((FakeRecognition.instances[0] as FakeRecognition).lang).toBe('fr-FR')
  })
})

describe('keeping the audio on the device', () => {
  it('requires local processing by default', () => {
    // A support widget records people saying their name, address and order
    // number. Sending that to a browser vendor should be a decision, not a
    // default.
    createDictation({}, scopeWith(FakeRecognition))!.start()
    expect((FakeRecognition.instances[0] as FakeRecognition).processLocally).toBe(true)
  })

  it('leaves the property alone when asked not to require it', () => {
    // Setting it to false would be opting out of on-device recognition, which
    // is not the same as having no opinion.
    createDictation({ processLocally: false }, scopeWith(FakeRecognition))!.start()
    expect((FakeRecognition.instances[0] as FakeRecognition).processLocally).toBeUndefined()
  })

  it('fails rather than quietly falling back to the cloud', () => {
    const errors: string[] = []
    const dictation = createDictation({ onError: (m) => errors.push(m) }, scopeWith(FakeRecognition))!

    dictation.start()
    ;(FakeRecognition.instances[0] as FakeRecognition).fail('language-not-supported')

    // One attempt only: falling back would be doing the exact thing
    // processLocally was set to prevent.
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(errors[0]).toContain('not available for this language')
  })

  it('retries without the requirement when the host allows it', () => {
    const dictation = createDictation({ allowCloudFallback: true }, scopeWith(FakeRecognition))!

    dictation.start()
    ;(FakeRecognition.instances[0] as FakeRecognition).fail('language-not-supported')

    expect(FakeRecognition.instances).toHaveLength(2)
    expect((FakeRecognition.instances[1] as FakeRecognition).processLocally).toBeUndefined()
  })

  it('retries only once, never in a loop', () => {
    const dictation = createDictation({ allowCloudFallback: true }, scopeWith(FakeRecognition))!

    dictation.start()
    ;(FakeRecognition.instances[0] as FakeRecognition).fail('language-not-supported')
    ;(FakeRecognition.instances[1] as FakeRecognition).fail('language-not-supported')

    expect(FakeRecognition.instances).toHaveLength(2)
  })
})

describe('errors', () => {
  it('explains a refused microphone in words a visitor can act on', () => {
    const errors: string[] = []
    const dictation = createDictation({ onError: (m) => errors.push(m) }, scopeWith(FakeRecognition))!

    dictation.start()
    ;(FakeRecognition.instances[0] as FakeRecognition).fail('not-allowed')

    expect(errors[0]).toContain('permission')
  })

  it('says nothing about an abort, which is what stopping looks like', () => {
    const errors: string[] = []
    const dictation = createDictation({ onError: (m) => errors.push(m) }, scopeWith(FakeRecognition))!

    dictation.start()
    ;(FakeRecognition.instances[0] as FakeRecognition).fail('aborted')

    expect(errors).toEqual([])
  })

  it('has something to say about an error it has never heard of', () => {
    const errors: string[] = []
    const dictation = createDictation({ onError: (m) => errors.push(m) }, scopeWith(FakeRecognition))!

    dictation.start()
    ;(FakeRecognition.instances[0] as FakeRecognition).fail('some-future-error')

    expect(errors[0]).toBeTruthy()
  })
})


describe('the mic in the widget', () => {
  /** Mounts a widget with a fake recognition installed on the window. */
  async function mount(dictation: unknown, withRecognition = true) {
    const { createWidget } = await import('../src/widget.js')
    const target = document.createElement('div')
    document.body.appendChild(target)

    const original = (globalThis as Record<string, unknown>).SpeechRecognition
    if (withRecognition) (globalThis as Record<string, unknown>).SpeechRecognition = FakeRecognition
    else delete (globalThis as Record<string, unknown>).SpeechRecognition

    createWidget({ endpoint: '/api/chat', target, open: true, persist: false, dictation } as never)
    const root = target.querySelector('div')?.shadowRoot as ShadowRoot

    return {
      root,
      restore: () => {
        if (original) (globalThis as Record<string, unknown>).SpeechRecognition = original
        else delete (globalThis as Record<string, unknown>).SpeechRecognition
        document.body.replaceChildren()
      },
    }
  }

  it('is absent unless dictation is turned on', async () => {
    const { root, restore } = await mount(undefined)
    expect(root.querySelector('button.mic')).toBeNull()
    restore()
  })

  it('appears when it is', async () => {
    const { root, restore } = await mount(true)
    expect(root.querySelector('button.mic')).not.toBeNull()
    restore()
  })

  it('stays hidden on a browser with no speech recognition', async () => {
    // Firefox. A button that cannot work is worse than no button.
    const { root, restore } = await mount(true, false)
    expect(root.querySelector('button.mic')).toBeNull()
    restore()
  })

  it('shows it is recording, and writes into the box', async () => {
    const { root, restore } = await mount(true)
    const mic = root.querySelector('button.mic') as HTMLButtonElement
    const input = root.querySelector('textarea') as HTMLTextAreaElement

    mic.click()
    expect(mic.dataset.recording).toBe('true')

    const instance = FakeRecognition.instances[FakeRecognition.instances.length - 1] as FakeRecognition
    instance.say('where is my order', true)
    expect(input.value).toContain('where is my order')

    restore()
  })

  it('swaps the microphone for a stop control while it runs', async () => {
    // A microphone drawn on a live button still reads as "start".
    const { root, restore } = await mount(true)
    const mic = root.querySelector('button.mic') as HTMLButtonElement

    expect(mic.querySelector('svg')).not.toBeNull()
    expect(mic.querySelector('.stop')).toBeNull()

    mic.click()

    expect(mic.querySelector('.stop')).not.toBeNull()
    expect(mic.querySelector('svg')).toBeNull()
    expect(mic.getAttribute('aria-pressed')).toBe('true')

    mic.click()

    expect(mic.querySelector('svg')).not.toBeNull()
    expect(mic.getAttribute('aria-pressed')).toBe('false')
    restore()
  })

  it('says in words that it is listening, not only in red', async () => {
    // Colour on its own reaches neither a screen reader nor everybody looking.
    const { root, restore } = await mount(true)
    const mic = root.querySelector('button.mic') as HTMLButtonElement
    const line = root.querySelector('.status') as HTMLElement

    expect(line.hidden).toBe(true)

    mic.click()

    expect(line.hidden).toBe(false)
    expect(line.textContent).toContain(DEFAULT_STRINGS.listening)
    expect(line.getAttribute('aria-live')).toBe('polite')

    mic.click()

    expect(line.hidden).toBe(true)
    restore()
  })

  it('keeps what was already typed and appends to it', async () => {
    const { root, restore } = await mount(true)
    const mic = root.querySelector('button.mic') as HTMLButtonElement
    const input = root.querySelector('textarea') as HTMLTextAreaElement

    input.value = 'hello,'
    mic.click()
    ;(FakeRecognition.instances[FakeRecognition.instances.length - 1] as FakeRecognition).say('where is my order', true)

    expect(input.value).toBe('hello, where is my order')
    restore()
  })

  it('escape discards the dictation and restores what was typed', async () => {
    const { root, restore } = await mount(true)
    const mic = root.querySelector('button.mic') as HTMLButtonElement
    const input = root.querySelector('textarea') as HTMLTextAreaElement

    input.value = 'typed'
    mic.click()
    ;(FakeRecognition.instances[FakeRecognition.instances.length - 1] as FakeRecognition).say('spoken', false)
    expect(input.value).toBe('typedspoken')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(input.value).toBe('typed')
    expect(mic.dataset.recording).toBe('false')
    restore()
  })
})
