/**
 * The behaviour every Store implementation has to have, as a suite you can run
 * against your own.
 *
 * Four stores ship here and yours is the fifth. A store that passes a suite
 * written for it is not interchangeable with anything, so this is the same
 * suite all of them run, published rather than kept in the monorepo: writing a
 * DynamoDB or Mongo or Turso store should mean proving it conforms, not
 * hand-copying an approximation of these assertions and hoping.
 *
 * ```ts
 * import { storeConformance } from '@recourse-ai/core/store/conformance'
 *
 * storeConformance({ name: 'dynamodb', make: () => myStore() })
 * ```
 *
 * It brings no test runner with it. `describe` and `it` are taken from the
 * global scope, which every runner provides, or passed in explicitly; the
 * assertions are its own, so nothing here depends on vitest, jest or node:test
 * being the one you chose.
 */

import { patchConversationMeta } from './meta.js'
import type { Store, StoredMessage } from './types.js'

/**
 * What a store does. Everything is expected by default.
 *
 * A store that legitimately cannot do something says so, rather than the suite
 * being watered down to whatever the weakest implementation manages. An
 * append-only audit store with no deletes is a real thing; a store that
 * silently drops `deleteConversation` on the floor is a data protection
 * problem, and the difference between the two is that one of them declared it.
 */
export interface StoreCapabilities {
  /** `deleteConversation` really removes the conversation and its messages. */
  deletes?: boolean
  /** `saveLead` and `listLeads`. */
  leads?: boolean
  /** `stats()` returns real aggregates rather than zeroes. */
  stats?: boolean
  /** `listConversations` honours `limit` and hands back a usable cursor. */
  pagination?: boolean
  /** `listConversations` honours `channel` and `unansweredOnly`. */
  filters?: boolean
  /** `setFeedback` records a thumb against a message. */
  feedback?: boolean
  /** `updateConversation` persists `meta`, which the handover flag rides on. */
  conversationMeta?: boolean
  /** The help desk half: `createTicket`, `updateTicket` and `listTickets`. */
  tickets?: boolean
}

/** The two functions every test runner has, however it spells the rest. */
export interface SuiteHooks {
  describe(name: string, body: () => void): void
  it(name: string, body: () => unknown): void
}

export interface ConformanceOptions {
  /** Appears in the test names, so a failure says which store failed. */
  name: string
  /** A fresh, empty store per call. Sharing one between tests will fail. */
  make: () => Store | Promise<Store>
  supports?: StoreCapabilities
  /** Defaults to `describe` and `it` from the global scope. */
  hooks?: SuiteHooks
}

/** A message with the required fields filled in, for building fixtures. */
export function message(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: `m_${Math.random().toString(36).slice(2, 10)}`,
    role: 'user',
    content: 'hello',
    createdAt: new Date().toISOString(),
    ...over,
  }
}

export function storeConformance(options: ConformanceOptions): void {
  const { describe, it } = options.hooks ?? globalHooks()
  const make = options.make
  const can: Required<StoreCapabilities> = {
    deletes: true,
    leads: true,
    stats: true,
    pagination: true,
    filters: true,
    feedback: true,
    conversationMeta: true,
    tickets: true,
    ...options.supports,
  }

  const declined = Object.entries(can)
    .filter(([, supported]) => !supported)
    .map(([capability]) => capability)

  describe(`${options.name} store`, () => {
    // Said out loud rather than silently skipped. A store that has quietly
    // opted out of half the suite still shows a green tick, and the person
    // reading that tick should know what it covers.
    if (declined.length > 0) {
      it(`declares it does not support: ${declined.join(', ')}`, () => {})
    }

    // ---- the conversation, which everything else hangs off ----

    it('creates the conversation on the first message', async () => {
      const store = await make()
      await store.appendMessage('c1', message({ content: 'where is my order' }), { channel: 'web' })

      const found = await store.getConversation('c1')
      expect(found?.conversation.channel).toBe('web')
      expect(found?.messages).toHaveLength(1)
    })

    it('returns null for a conversation that never existed', async () => {
      expect(await (await make()).getConversation('nope')).toBeNull()
    })

    it('orders conversations by most recently updated', async () => {
      const store = await make()
      await store.appendMessage('old', message({ createdAt: '2026-01-01T00:00:00.000Z' }))
      await store.appendMessage('new', message({ createdAt: '2026-06-01T00:00:00.000Z' }))

      const page = await store.listConversations()
      expect(page.items[0]?.id).toBe('new')
    })

    it('reads several transcripts in one call, where it offers one', async () => {
      const store = await make()
      if (!store.getConversations) return

      await store.appendMessage('c1', message({ content: 'one' }))
      await store.appendMessage('c2', message({ content: 'two' }))
      await store.appendMessage('c2', message({ content: 'and again' }))

      const threads = await store.getConversations(['c1', 'c2', 'never-existed'])
      const byId = new Map(threads.map((thread) => [thread.conversation.id, thread]))

      // The id with nothing behind it is left out rather than returned empty,
      // so a caller can trust the length of what came back.
      expect(threads).toHaveLength(2)
      expect(byId.get('c1')?.messages).toHaveLength(1)
      expect(byId.get('c2')?.messages).toHaveLength(2)
    })

    if (can.conversationMeta) {
      it('stores metadata put on a conversation after it started', async () => {
        const store = await make()
        await store.appendMessage('c_meta', message(), { channel: 'web' })

        // What the handover flag rides on. A store that quietly drops `meta`
        // here has an agent talking over whoever took the conversation.
        await store.updateConversation('c_meta', { meta: { aiPaused: true, aiPausedAt: '2026-08-31T00:00:00.000Z' } })

        const thread = await store.getConversation('c_meta')
        expect(thread?.conversation.meta?.aiPaused).toBe(true)
        expect(thread?.conversation.meta?.aiPausedAt).toBe('2026-08-31T00:00:00.000Z')
        // And the rest of the conversation is still there.
        expect(thread?.conversation.channel).toBe('web')
        expect(thread?.messages).toHaveLength(1)
      })

      it('replaces metadata rather than merging it, so a flag can be cleared', async () => {
        const store = await make()
        await store.appendMessage('c_clear', message(), { channel: 'web' })

        await store.updateConversation('c_clear', { meta: { aiPaused: true, country: 'IE' } })
        await store.updateConversation('c_clear', { meta: { country: 'IE' } })

        const thread = await store.getConversation('c_clear')
        expect(thread?.conversation.meta?.aiPaused).toBeUndefined()
        expect(thread?.conversation.meta?.country).toBe('IE')
      })

      it('merges metadata an appended message carries, rather than replacing it', async () => {
        const store = await make()
        await store.appendMessage('c_merge', message(), { channel: 'web', meta: { country: 'IE' } })

        // Whatever a feature wrote between two turns: a handover flag, an
        // insight, a coalescing hold. The next message must not take it with it.
        await store.updateConversation('c_merge', { meta: { country: 'IE', aiPaused: true } })
        await store.appendMessage('c_merge', message({ role: 'assistant' }), { channel: 'web', meta: { country: 'IE' } })

        const thread = await store.getConversation('c_merge')
        expect(thread?.conversation.meta?.aiPaused).toBe(true)
        expect(thread?.conversation.meta?.country).toBe('IE')
      })

      it('patches named metadata keys without disturbing the others', async () => {
        const store = await make()
        await store.appendMessage('c_patch', message(), { channel: 'web' })

        // Two features that own different keys. Neither may erase the other.
        await patchConversationMeta(store, 'c_patch', { aiPaused: true, aiPausedAt: '2026-08-31T00:00:00.000Z' })
        await patchConversationMeta(store, 'c_patch', { insightMood: 'unhappy' })

        let thread = await store.getConversation('c_patch')
        expect(thread?.conversation.meta?.aiPaused).toBe(true)
        expect(thread?.conversation.meta?.insightMood).toBe('unhappy')

        // Null clears one key and leaves the rest.
        await patchConversationMeta(store, 'c_patch', { aiPaused: null, aiPausedAt: null })

        thread = await store.getConversation('c_patch')
        expect(thread?.conversation.meta?.aiPaused).toBeUndefined()
        expect(thread?.conversation.meta?.aiPausedAt).toBeUndefined()
        expect(thread?.conversation.meta?.insightMood).toBe('unhappy')
      })
    }

    // ---- forgetting somebody, which is a legal obligation and not a feature ----

    if (can.deletes) {
      it('forgets a conversation when asked, and says whether there was one', async () => {
        const store = await make()
        await store.appendMessage('c1', message({ content: 'my email is a@example.com' }), { channel: 'web' })
        await store.appendMessage('c2', message({ content: 'a different visitor' }), { channel: 'web' })

        expect(await store.deleteConversation('c1')).toBe(true)
        expect(await store.getConversation('c1')).toBeNull()

        // Only the one asked for.
        expect(await store.getConversation('c2')).not.toBeNull()
      })

      it('says false for a conversation that was never there', async () => {
        expect(await (await make()).deleteConversation('never-existed')).toBe(false)
      })

      it('leaves no trace of a deleted conversation in a listing', async () => {
        const store = await make()
        await store.appendMessage('c1', message(), { channel: 'web' })
        await store.deleteConversation('c1')

        const listed = await store.listConversations()
        expect(listed.items.some((conversation) => conversation.id === 'c1')).toBe(false)
      })

      if (can.leads) {
        it('takes a lead captured in that conversation with it', async () => {
          const store = await make()
          await store.appendMessage('c1', message(), { channel: 'web' })
          await store.saveLead({
            id: 'l1',
            conversationId: 'c1',
            createdAt: new Date().toISOString(),
            values: { email: 'amina@example.com' },
          })

          await store.deleteConversation('c1')

          // The customer asked to be forgotten. Keeping their email address
          // under a conversation id that no longer exists is the worst of both.
          const leads = await store.listLeads()
          expect(leads.items.some((lead) => lead.conversationId === 'c1')).toBe(false)
        })
      }
    }

    // ---- reading it back ----

    if (can.pagination) {
      it('ends the listing when the cursor points at a row that is gone', async () => {
        const store = await make()
        for (const id of ['p1', 'p2', 'p3']) await store.appendMessage(id, message(), { channel: 'web' })

        // A caller loops until the cursor runs out. If a cursor whose row has
        // been evicted or deleted starts the listing again, it never runs out
        // and the loop reads the first page for ever.
        const page = await store.listConversations({ limit: 2, cursor: 'gone_for_good' })

        expect(page.items).toHaveLength(0)
        expect(page.cursor).toBeUndefined()
      })

      it('brings a limit outside its range back inside it', async () => {
        const store = await make()
        for (const id of ['q1', 'q2', 'q3']) await store.appendMessage(id, message(), { channel: 'web' })

        // -1 used to reach `slice(0, -1)`, which is every row but the last.
        const page = await store.listConversations({ limit: -1 })

        expect(page.items).toHaveLength(1)
      })

      it('paginates with a stable cursor', async () => {
        const store = await make()
        for (let i = 0; i < 5; i++) {
          await store.appendMessage(`c${i}`, message({ createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }))
        }

        const first = await store.listConversations({ limit: 2 })
        expect(first.items).toHaveLength(2)
        expect(first.cursor).toBeTruthy()

        const second = await store.listConversations({ limit: 2, cursor: first.cursor })
        expect(second.items.map((c) => c.id)).not.toContain(first.items[0]?.id)
      })

      it('has no cursor on the last page', async () => {
        const store = await make()
        await store.appendMessage('only', message())
        expect((await store.listConversations({ limit: 10 })).cursor).toBeUndefined()
      })
    }

    if (can.filters) {
      it('filters by channel', async () => {
        const store = await make()
        await store.appendMessage('w', message(), { channel: 'web' })
        await store.appendMessage('e', message(), { channel: 'email' })

        const page = await store.listConversations({ channel: 'email' })
        expect(page.items.map((c) => c.id)).toEqual(['e'])
      })

      it('finds the conversations where the agent could not answer', async () => {
        const store = await make()
        await store.appendMessage('good', message({ role: 'assistant', unanswered: false }))
        await store.appendMessage('gap', message({ role: 'assistant', unanswered: true }))

        const page = await store.listConversations({ unansweredOnly: true })
        expect(page.items.map((c) => c.id)).toEqual(['gap'])
      })
    }

    if (can.feedback) {
      it('records thumbs up and down against a message', async () => {
        const store = await make()
        const reply = message({ role: 'assistant', content: 'thirty days' })
        await store.appendMessage('c1', reply)
        await store.setFeedback('c1', reply.id, 'negative')

        const found = await store.getConversation('c1')
        expect(found?.messages[0]?.feedback).toBe('negative')
      })
    }

    if (can.leads) {
      it('stores and lists leads newest first', async () => {
        const store = await make()
        await store.saveLead({ id: 'l1', createdAt: '2026-01-01T00:00:00.000Z', values: { email: 'a@b.co' } })
        await store.saveLead({ id: 'l2', createdAt: '2026-02-01T00:00:00.000Z', values: { email: 'c@d.co' } })

        const page = await store.listLeads()
        expect(page.items.map((lead) => lead.id)).toEqual(['l2', 'l1'])
      })
    }

    // ---- the numbers a support lead actually looks at ----

    if (can.stats) {
      it('reports the numbers a support lead actually looks at', async () => {
        const store = await make()
        await store.appendMessage('c1', message({ content: 'do you sell tea' }), { channel: 'web' })
        await store.appendMessage('c1', message({ role: 'assistant', unanswered: true }))
        await store.appendMessage('c2', message({ content: 'do you sell tea' }), { channel: 'whatsapp' })
        await store.appendMessage('c2', message({ role: 'assistant', unanswered: true }))
        if (can.leads) await store.saveLead({ id: 'l1', createdAt: new Date().toISOString(), values: {} })

        const stats = await store.stats()
        expect(stats.conversations).toBe(2)
        expect(stats.unanswered).toBe(2)
        if (can.leads) expect(stats.leads).toBe(1)
        expect(stats.byChannel).toEqual({ web: 1, whatsapp: 1 })
        // The same missing answer asked twice is the top gap to go and write.
        expect(stats.topGaps[0]).toEqual({ question: 'do you sell tea', count: 2 })
      })

      it('counts how often each action ran', async () => {
        const store = await make()
        const ran = (name: string) => ({ name, input: {}, output: {} })

        await store.appendMessage('c1', message({ role: 'assistant', actions: [ran('escalate'), ran('lead')] }))
        await store.appendMessage('c2', message({ role: 'assistant', actions: [ran('escalate')] }))

        const stats = await store.stats()
        expect(stats.byAction).toEqual({ escalate: 2, lead: 1 })
        // Most used first, because the question is always which ones earn their
        // place and which are never called.
        expect(Object.keys(stats.byAction)[0]).toBe('escalate')
      })

      it('reports a day at a time, oldest first, skipping days with nothing', async () => {
        const store = await make()
        const at = (day: string) => `2026-03-${day}T10:00:00.000Z`

        await store.appendMessage('c1', message({ createdAt: at('01') }), { createdAt: at('01') })
        await store.appendMessage('c1', message({ createdAt: at('01'), role: 'assistant' }), {})
        await store.appendMessage('c2', message({ createdAt: at('03') }), { createdAt: at('03') })

        const stats = await store.stats()
        expect(stats.daily.map((one) => one.date)).toEqual(['2026-03-01', '2026-03-03'])
        expect(stats.daily[0]).toEqual({ date: '2026-03-01', conversations: 1, messages: 2 })
      })

      it('counts conversations by country only where one was recorded', async () => {
        const store = await make()
        await store.appendMessage('c1', message(), { meta: { country: 'IE' } })
        await store.appendMessage('c2', message(), { meta: { country: 'IE' } })
        await store.appendMessage('c3', message(), { meta: { country: 'GB' } })
        // No country at all, which is what a visitor who did not consent looks
        // like, and what every visitor looks like behind an origin that resolves
        // none. It must not become a bucket of its own.
        await store.appendMessage('c4', message())

        const stats = await store.stats()
        expect(stats.byCountry).toEqual({ IE: 2, GB: 1 })
      })

      it('counts the people behind the conversations, not the conversations', async () => {
        const store = await make()
        const now = Date.now()
        const at = (agoDays: number) => new Date(now - agoDays * 86_400_000).toISOString()
        const sam = { id: 'u_sam', email: 'sam@example.com' }

        // The same person, twice today, plus somebody else four days ago.
        await store.appendMessage('c1', message({ createdAt: at(0) }), { contact: sam })
        await store.appendMessage('c2', message({ createdAt: at(0) }), { contact: sam })
        await store.appendMessage('c3', message({ createdAt: at(4) }), { contact: { id: 'u_ada' } })

        const stats = await store.stats()
        expect(stats.activeUsers.daily).toBe(1)
        expect(stats.activeUsers.weekly).toBe(2)
        expect(stats.activeUsers.stickiness).toBe(0.5)
      })
    }

    if (can.filters) {
      it('lists everything one person ever asked', async () => {
        // The first thing anybody wants when a customer writes in for the
        // fourth time about the same order, and what a request to be forgotten
        // needs before it can be honoured.
        const store = await make()
        const sam = { id: 'u_sam', email: 'sam@example.com' }

        await store.appendMessage('c1', message({ content: 'first' }), { channel: 'web', contact: sam })
        await store.appendMessage('c2', message({ content: 'second' }), { channel: 'web', contact: sam })
        await store.appendMessage('c3', message({ content: 'someone else' }), {
          channel: 'web',
          contact: { id: 'u_ada' },
        })

        const page = await store.listConversations({ contactId: 'u_sam' })
        expect(page.items.map((one) => one.id).sort()).toEqual(['c1', 'c2'])

        expect((await store.listConversations({ contactId: 'nobody' })).items).toEqual([])
      })
    }

    // ---- the queue, and the order it comes back in ----

    if (can.tickets) {
      /** Three tickets, opened, touched and replied to in three orders. */
      async function queue(): Promise<Store> {
        const store = await make()

        for (const [subject, createdAt, updatedAt, lastMessageAt] of [
          ['first', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
          ['second', '2026-01-02T00:00:00.000Z', '2026-01-05T00:00:00.000Z', undefined],
          ['third', '2026-01-03T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
        ] as const) {
          const ticket = await store.createTicket({
            subject,
            description: subject,
            statusId: 'new',
            statusCategory: 'new',
            customer: { email: 'sam@example.com' },
            channel: 'web',
            metadata: {},
            createdAt,
            updatedAt,
            ...(lastMessageAt ? { lastMessageAt } : {}),
          })

          // Stores stamp their own times on create, so put the fixture's back.
          await store.updateTicket(ticket.ticketNumber, {
            createdAt,
            updatedAt,
            ...(lastMessageAt ? { lastMessageAt } : {}),
          })
        }

        return store
      }

      const subjects = (page: { items: Array<{ subject: string }> }) => page.items.map((one) => one.subject)

      it('lists the most recently touched ticket first', async () => {
        expect(subjects(await (await queue()).listTickets())).toEqual(['first', 'third', 'second'])
      })

      it('lists oldest first when asked, which is the order a queue is worked in', async () => {
        const page = await (await queue()).listTickets({ sortBy: 'created', order: 'asc' })
        expect(subjects(page)).toEqual(['first', 'second', 'third'])
      })

      it('sorts by the last reply, putting one nobody answered at the old end', async () => {
        // "second" has no last message, so it falls back to when it was opened
        // rather than sorting as though it had no date at all.
        expect(subjects(await (await queue()).listTickets({ sortBy: 'lastMessage' }))).toEqual([
          'third',
          'first',
          'second',
        ])
      })

      it('honours a timestamp the caller supplied rather than stamping now', async () => {
        // Every store, or the same queue comes back in a different order
        // depending on where it is kept.
        const store = await queue()
        const [oldest] = (await store.listTickets({ sortBy: 'created', order: 'asc' })).items

        expect(oldest?.createdAt).toBe('2026-01-01T00:00:00.000Z')
        expect(oldest?.updatedAt).toBe('2026-03-01T00:00:00.000Z')
      })

      it('counts what matched, not what came back, and only when asked', async () => {
        const store = await queue()
        const page = await store.listTickets({ limit: 1, includeTotal: true })

        expect(page.items).toHaveLength(1)
        expect(page.total).toBe(3)
        expect((await store.listTickets({ limit: 1 })).total).toBeUndefined()
      })

      it('walks the whole queue a page at a time, handing over each ticket once', async () => {
        const store = await queue()
        const seen: string[] = []
        let cursor: string | undefined

        do {
          const page = await store.listTickets({
            limit: 2,
            sortBy: 'created',
            order: 'asc',
            ...(cursor ? { cursor } : {}),
          })
          seen.push(...page.items.map((one) => one.subject))
          cursor = page.cursor
        } while (cursor)

        expect(seen).toEqual(['first', 'second', 'third'])
      })

      it('refuses a cursor from a different ordering rather than paging into nonsense', async () => {
        // The cursor is a position in one ordering. Used against another it
        // points at a row that has moved, and the page is quietly wrong.
        const store = await queue()
        const first = await store.listTickets({ limit: 1, sortBy: 'created', order: 'asc' })

        let refused = false
        try {
          await store.listTickets({ limit: 1, cursor: first.cursor as string })
        } catch {
          refused = true
        }

        expect(refused).toBe(true)
      })
    }
  })
}

/**
 * `describe` and `it` as the runner put them in scope.
 *
 * Every runner in common use defines both globally, so this is the path that
 * needs no configuration. A runner that does not, or one where they are
 * imported rather than injected, passes them as `hooks`.
 */
function globalHooks(): SuiteHooks {
  const scope = globalThis as Partial<SuiteHooks>
  if (typeof scope.describe !== 'function' || typeof scope.it !== 'function') {
    throw new Error(
      'storeConformance found no describe/it in the global scope. Pass them as `hooks`, ' +
        'or enable your runner\'s globals (in vitest: test.globals in the config).',
    )
  }
  return { describe: scope.describe, it: scope.it }
}

/**
 * Just enough of the matchers the suite uses.
 *
 * Its own rather than the runner's, so the package does not have to pick one
 * and make everybody else's choice wrong. The messages name what was compared,
 * because a conformance failure is read by somebody who did not write the
 * assertion.
 */
function expect(actual: unknown) {
  const matchers = {
    toBe(wanted: unknown) {
      if (!Object.is(actual, wanted)) fail(`expected ${show(wanted)}, got ${show(actual)}`)
    },
    toEqual(wanted: unknown) {
      if (!same(actual, wanted)) fail(`expected ${show(wanted)}, got ${show(actual)}`)
    },
    toBeNull() {
      if (actual !== null) fail(`expected null, got ${show(actual)}`)
    },
    toBeUndefined() {
      if (actual !== undefined) fail(`expected undefined, got ${show(actual)}`)
    },
    toBeTruthy() {
      if (!actual) fail(`expected something truthy, got ${show(actual)}`)
    },
    toHaveLength(wanted: number) {
      const length = (actual as { length?: number } | null)?.length
      if (length !== wanted) fail(`expected length ${wanted}, got ${show(length)}`)
    },
    toContain(wanted: unknown) {
      if (!contains(actual, wanted)) fail(`expected ${show(actual)} to contain ${show(wanted)}`)
    },
  }

  return {
    ...matchers,
    not: {
      toBe(wanted: unknown) {
        if (Object.is(actual, wanted)) fail(`expected anything but ${show(wanted)}`)
      },
      toEqual(wanted: unknown) {
        if (same(actual, wanted)) fail(`expected anything but ${show(wanted)}`)
      },
      toBeNull() {
        if (actual === null) fail('expected not null')
      },
      toBeUndefined() {
        if (actual === undefined) fail('expected not undefined')
      },
      toContain(wanted: unknown) {
        if (contains(actual, wanted)) fail(`expected ${show(actual)} not to contain ${show(wanted)}`)
      },
    },
  }
}

function contains(actual: unknown, wanted: unknown): boolean {
  if (typeof actual === 'string') return actual.includes(String(wanted))
  return Array.isArray(actual) && actual.some((entry) => same(entry, wanted))
}

function fail(why: string): never {
  throw new Error(`store conformance: ${why}`)
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Structural equality, which is all the suite compares. */
function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false

  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, at) => same(entry, right[at]))
  }

  const leftKeys = Object.keys(left as object)
  const rightKeys = Object.keys(right as object)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every(
    (key) =>
      Object.hasOwn(right as object, key) &&
      same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  )
}
