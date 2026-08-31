import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { d1Store, migrate, type D1Like, type D1Statement } from '../src/index.js'
import { message, storeConformance } from '../../core/src/store/conformance.js'

/**
 * `node:sqlite` arrived in Node 22. On anything older these skip rather than
 * fail, so a contributor on an older runtime is not blocked by a package they
 * never touched.
 */
const require_ = createRequire(import.meta.url)
let DatabaseSync: (new (path: string) => SqliteDatabase) | null = null
try {
  DatabaseSync = (require_('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }).DatabaseSync
} catch {
  DatabaseSync = null
}

interface SqliteDatabase {
  prepare(sql: string): {
    get(...values: never[]): unknown
    all(...values: never[]): unknown[]
    run(...values: never[]): { lastInsertRowid: number | bigint; changes: number | bigint }
  }
}

/**
 * D1 over `node:sqlite`.
 *
 * D1 *is* SQLite, so a shim over Node's built-in one exercises the same SQL
 * the Worker will run. What it does not exercise is the binding, the network,
 * or the per-invocation query limit, see the README for what that leaves
 * unproven.
 *
 * Node 22 ships `node:sqlite`, so this needs no dependency at all.
 */
function fakeD1(): D1Like {
  if (!DatabaseSync) throw new Error('node:sqlite is unavailable')
  const db = new DatabaseSync(':memory:')

  function statement(sql: string, bound: unknown[] = []): D1Statement {
    return {
      bind(...values: unknown[]) {
        return statement(sql, values)
      },
      async first<T>() {
        const prepared = db.prepare(sql)
        return (prepared.get(...(bound as never[])) as T) ?? null
      },
      async all<T>() {
        const prepared = db.prepare(sql)
        return { results: prepared.all(...(bound as never[])) as T[] }
      },
      async run() {
        const prepared = db.prepare(sql)
        const result = prepared.run(...(bound as never[]))
        return { meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } }
      },
    }
  }

  return { prepare: (sql: string) => statement(sql) }
}

async function make() {
  const db = fakeD1()
  await migrate(db)
  return d1Store({ db, migrate: false })
}

// The same assertions the memory, file and Postgres stores pass. A fourth
// implementation that only passes its own tests is not interchangeable.
if (DatabaseSync) storeConformance({ name: 'd1', make, hooks: { describe, it } })

describe.skipIf(!DatabaseSync)('d1 specifics', () => {
  it('hands out a unique ticket number per insert', async () => {
    // AUTOINCREMENT rather than read-the-highest-and-add-one, which is the
    // race the file store has.
    const store = await make()
    const now = new Date().toISOString()

    const tickets = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.createTicket({
          subject: `ticket ${index}`,
          description: 'one of twenty',
          statusId: 'new',
          statusCategory: 'new',
          customer: { email: `c${index}@example.com` },
          channel: 'web',
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }),
      ),
    )

    expect(new Set(tickets.map((t) => t.ticketNumber)).size).toBe(20)
  })

  it('keeps message order from the sequence, not the timestamp', async () => {
    const store = await make()
    const sameInstant = new Date().toISOString()

    await store.appendMessage('c1', message({ content: 'question', createdAt: sameInstant }), { channel: 'web' })
    await store.appendMessage('c1', message({ role: 'assistant', content: 'answer', createdAt: sameInstant }))

    const found = await store.getConversation('c1')
    expect(found?.messages.map((m) => m.content)).toEqual(['question', 'answer'])
  })

  it('does not let a later message change the channel', async () => {
    // The bug the Postgres store had: a second message with no conversation
    // argument turned a WhatsApp thread into a web one.
    const store = await make()

    await store.appendMessage('c1', message({ content: 'first' }), { channel: 'whatsapp' })
    await store.appendMessage('c1', message({ role: 'assistant', content: 'second' }))

    expect((await store.getConversation('c1'))?.conversation.channel).toBe('whatsapp')
  })

  it('finds a ticket by its subject, description, or a reply', async () => {
    const store = await make()
    const now = new Date().toISOString()

    const ticket = await store.createTicket({
      subject: 'Grinder arrived broken',
      description: 'The burr grinder was cracked',
      statusId: 'new',
      statusCategory: 'new',
      customer: { email: 'sam@example.com' },
      channel: 'web',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })

    await store.addTicketMessage({
      ticketNumber: ticket.ticketNumber,
      type: 'reply',
      sender: { type: 'customer' },
      content: 'I attached a photograph of the packaging',
      createdAt: now,
    })

    expect((await store.searchTickets('grinder')).map((t) => t.ticketNumber)).toContain(ticket.ticketNumber)
    expect((await store.searchTickets('cracked')).map((t) => t.ticketNumber)).toContain(ticket.ticketNumber)
    expect((await store.searchTickets('photograph')).map((t) => t.ticketNumber)).toContain(ticket.ticketNumber)
    expect(await store.searchTickets('bicycle')).toEqual([])
  })

  it('survives a search full of punctuation', async () => {
    // FTS5 treats punctuation as query operators, so an apostrophe in a search
    // box is a syntax error rather than a search.
    const store = await make()
    await expect(store.searchTickets("it's broken & i'm cross !!")).resolves.toEqual([])
    await expect(store.searchTickets('"')).resolves.toEqual([])
  })

  it('pages with a cursor that survives a write between pages', async () => {
    const store = await make()
    for (let index = 0; index < 5; index++) {
      await store.appendMessage(`c${index}`, message({ content: `m${index}` }), { channel: 'web' })
    }

    const first = await store.listConversations({ limit: 2 })
    await store.appendMessage('c_new', message({ content: 'mid-page' }), { channel: 'web' })
    const second = await store.listConversations({ limit: 2, cursor: first.cursor })

    expect(second.items.filter((item) => first.items.some((seen) => seen.id === item.id))).toEqual([])
  })

  it('is safe to migrate twice', async () => {
    const db = fakeD1()
    await migrate(db)
    await expect(migrate(db)).resolves.toBeUndefined()
  })
})
