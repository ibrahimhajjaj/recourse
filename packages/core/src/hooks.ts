/**
 * Named points where a deployment can change what happens.
 *
 * Modelled on WordPress hooks, with one difference: the registry is a value
 * you hold rather than a global. WordPress can use a global because a request
 * serves one site. Here one process can answer for several businesses, so a
 * global would let the shop that registered a filter have it run on another
 * shop's answers.
 *
 * `fork` copies a registry so shared rules live in one place and each tenant
 * adds to its own copy.
 *
 * ```ts
 * const house = createHooks()
 * house.filter('answer', cutThroatClearing)
 *
 * const forShop = house.fork()
 * forShop.filter('answer', shopVoice)
 * createAgent({ index, hooks: forShop })
 * ```
 *
 * Everything registered is wrapped. A filter that throws or returns a
 * non-string is dropped and the text passes through unchanged, because a
 * broken extension should not be able to break the answer.
 */

import { getLogger } from './diagnostics.js'

/** Runs once per turn and sees the answer as it streams. */
export interface AnswerFilter {
  /** A fragment on its way out. Return what to send, or '' to hold it. */
  push(text: string): string
  /** Whatever is still held, once the answer is finished. */
  flush(): string
}

export interface FilterContext {
  conversationId?: string
  /** What the visitor asked, when the point has it. */
  question?: string
}

/**
 * The filters this package applies, by name.
 *
 * Declaration merging is deliberate: another package adds its own names to
 * this interface and they typecheck like the built-in ones.
 *
 * - `answer` shapes what the customer reads. Registered as a factory because
 *   an answer arrives in pieces and a filter usually needs to remember what it
 *   has seen. One instance per turn, so nothing leaks between conversations.
 * - `question` shapes what is searched for, before retrieval runs.
 */
export interface Filters {
  answer: (context: FilterContext) => AnswerFilter
  question: (question: string, context: FilterContext) => string
}

/** Things that happened. Listeners cannot change them. */
export interface Events {
  'turn.start': (context: FilterContext) => void
  'turn.end': (context: FilterContext & { answer: string; ms: number }) => void
}

interface Registered<T> {
  fn: T
  priority: number
  /** Insertion order, so equal priorities keep the order they were added. */
  seq: number
}

export interface Hooks {
  /**
   * Registers a filter. Lower priority runs first, ties in the order added.
   *
   * Returns a function that removes it again, because a filter you cannot take
   * off is a leak in anything long-lived.
   */
  filter<K extends keyof Filters>(name: K, fn: Filters[K], priority?: number): () => void
  /** Registers a listener. Same ordering, same removal. */
  on<K extends keyof Events>(name: K, fn: Events[K], priority?: number): () => void
  /** Every filter registered for a name, in the order they should run. */
  filters<K extends keyof Filters>(name: K): Array<Filters[K]>
  /** Runs the listeners. Never throws: one bad listener is not a failed turn. */
  emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void
  /** A copy that inherits what is registered now and diverges afterwards. */
  fork(): Hooks
}

export function createHooks(inherited?: {
  filters: Map<string, Array<Registered<unknown>>>
  events: Map<string, Array<Registered<unknown>>>
}): Hooks {
  // Copied rather than shared, so a fork adding a filter cannot reach back
  // into the registry it came from or across to a sibling.
  const filters = new Map<string, Array<Registered<unknown>>>()
  const events = new Map<string, Array<Registered<unknown>>>()
  for (const [name, list] of inherited?.filters ?? []) filters.set(name, [...list])
  for (const [name, list] of inherited?.events ?? []) events.set(name, [...list])

  let seq = 0

  const add = (
    into: Map<string, Array<Registered<unknown>>>,
    name: string,
    fn: unknown,
    priority: number,
  ): (() => void) => {
    const entry: Registered<unknown> = { fn, priority, seq: seq++ }
    const list = into.get(name) ?? []
    list.push(entry)
    // Sorted on insert rather than on every read, because reads happen per
    // turn and inserts happen once at startup.
    list.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
    into.set(name, list)

    return () => {
      const current = into.get(name)
      if (!current) return
      const at = current.indexOf(entry)
      if (at >= 0) current.splice(at, 1)
    }
  }

  return {
    filter(name, fn, priority = 10) {
      return add(filters, name as string, fn, priority)
    },

    on(name, fn, priority = 10) {
      return add(events, name as string, fn, priority)
    },

    filters(name) {
      return (filters.get(name as string) ?? []).map((entry) => entry.fn) as Array<Filters[typeof name]>
    },

    emit(name, ...args) {
      for (const entry of events.get(name as string) ?? []) {
        try {
          ;(entry.fn as (...a: unknown[]) => void)(...(args as unknown[]))
        } catch (error) {
          // The thing being watched still happened, so the turn carries on.
          getLogger().error(`a listener for ${String(name)} threw:`, error)
        }
      }
    },

    fork() {
      return createHooks({ filters, events })
    },
  }
}

/**
 * The registered answer filters as one, safe to stream through.
 *
 * Each is built once for the turn and they run in order, each seeing what the
 * one before it produced. A filter that throws is dropped for the rest of the
 * turn rather than retried, because something that failed once on this answer
 * will fail again on the next fragment of it, and logging it forty times is
 * how a real error gets buried.
 */
export function answerFilter(hooks: Hooks | undefined, context: FilterContext): AnswerFilter | null {
  if (!hooks) return null

  const built: AnswerFilter[] = []
  for (const make of hooks.filters('answer')) {
    try {
      const filter = make(context)
      // Duck-typed rather than instanceof: this crosses a package boundary,
      // where two copies of an interface are still two different things.
      if (typeof filter?.push === 'function' && typeof filter?.flush === 'function') built.push(filter)
    } catch (error) {
      getLogger().error('an answer filter could not be built:', error)
    }
  }

  if (built.length === 0) return null

  const failed = new Set<AnswerFilter>()

  /** Runs one stage, and takes the filter out of service if it misbehaves. */
  const through = (filter: AnswerFilter, text: string, stage: 'push' | 'flush'): string => {
    if (failed.has(filter)) return text

    try {
      const out = stage === 'push' ? filter.push(text) : filter.flush()

      // A filter that returns something other than text has misunderstood the
      // contract, and passing an object into the stream would render as
      // "[object Object]" on somebody's screen.
      if (typeof out !== 'string') {
        failed.add(filter)
        getLogger().error('an answer filter returned something that is not text; ignoring it')

        return text
      }

      return out
    } catch (error) {
      failed.add(filter)
      getLogger().error('an answer filter threw; ignoring it for the rest of this answer:', error)

      return text
    }
  }

  return {
    push(text: string): string {
      let carried = text
      for (const filter of built) {
        carried = through(filter, carried, 'push')
        // Held back by this stage, so there is nothing for the next one to see
        // yet. It will arrive with whatever comes next.
        if (carried === '') return ''
      }

      return carried
    },

    flush(): string {
      // Each stage flushes into the next, so text one filter was holding still
      // passes through the filters after it rather than escaping them.
      let carried = ''
      for (const filter of built) {
        const held = through(filter, '', 'flush')
        carried = carried ? through(filter, carried, 'push') + held : held
      }

      return carried
    },
  }
}
