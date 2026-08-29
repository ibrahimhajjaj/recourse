/**
 * The behaviour every Store implementation has to have.
 *
 * Lives in its own file so a new implementation proves itself against the same
 * assertions rather than a hand-copied approximation of them. A store that
 * passes a suite written for it is not interchangeable with anything.
 *
 * Not exported from the package: this is monorepo test scaffolding, and
 * shipping test code to consumers helps nobody.
 */
import { describe, expect, it } from 'vitest'
import type { Store, StoredMessage } from '../src/store/types.js'

export function message(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: `m_${Math.random().toString(36).slice(2, 10)}`,
    role: 'user',
    content: 'hello',
    createdAt: new Date().toISOString(),
    ...over,
  }
}

export function storeBehaviour(name: string, make: () => Promise<Store> | Store): void {
  describe(`${name} store`, () => {
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

    it('takes a lead captured in that conversation with it', async () => {
      const store = await make()
      await store.appendMessage('c1', message(), { channel: 'web' })
      await store.saveLead({
        id: 'l1',
        conversationId: 'c1',
        name: 'Amina',
        email: 'amina@example.com',
        createdAt: new Date().toISOString(),
      })

      await store.deleteConversation('c1')

      // The customer asked to be forgotten. Keeping their email address under
      // a conversation id that no longer exists is the worst of both.
      const leads = await store.listLeads()
      expect(leads.items.some((lead) => lead.conversationId === 'c1')).toBe(false)
    })

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

    it('records thumbs up and down against a message', async () => {
      const store = await make()
      const reply = message({ role: 'assistant', content: 'thirty days' })
      await store.appendMessage('c1', reply)
      await store.setFeedback('c1', reply.id, 'negative')

      const found = await store.getConversation('c1')
      expect(found?.messages[0]?.feedback).toBe('negative')
    })

    it('stores and lists leads newest first', async () => {
      const store = await make()
      await store.saveLead({ id: 'l1', createdAt: '2026-01-01T00:00:00.000Z', values: { email: 'a@b.co' } })
      await store.saveLead({ id: 'l2', createdAt: '2026-02-01T00:00:00.000Z', values: { email: 'c@d.co' } })

      const page = await store.listLeads()
      expect(page.items.map((lead) => lead.id)).toEqual(['l2', 'l1'])
    })

    it('reports the numbers a support lead actually looks at', async () => {
      const store = await make()
      await store.appendMessage('c1', message({ content: 'do you sell tea' }), { channel: 'web' })
      await store.appendMessage('c1', message({ role: 'assistant', unanswered: true }))
      await store.appendMessage('c2', message({ content: 'do you sell tea' }), { channel: 'whatsapp' })
      await store.appendMessage('c2', message({ role: 'assistant', unanswered: true }))
      await store.saveLead({ id: 'l1', createdAt: new Date().toISOString(), values: {} })

      const stats = await store.stats()
      expect(stats.conversations).toBe(2)
      expect(stats.unanswered).toBe(2)
      expect(stats.leads).toBe(1)
      expect(stats.byChannel).toEqual({ web: 1, whatsapp: 1 })
      // The same missing answer asked twice is the top gap to go and write.
      expect(stats.topGaps[0]).toEqual({ question: 'do you sell tea', count: 2 })
    })
  })
}
