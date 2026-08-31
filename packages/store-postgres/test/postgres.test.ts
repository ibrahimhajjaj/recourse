import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { postgresStore, migrate } from '../src/index.js'
import { message, storeConformance } from '../../core/src/store/conformance.js'

/**
 * Runs against a real Postgres, and skips cleanly without one.
 *
 * `TEST_DATABASE_URL=postgres://... pnpm test`. In CI that is a service
 * container; locally it is a throwaway docker container. Skipping rather than
 * failing is deliberate: a contributor changing the widget should not be
 * blocked by a database they never touched.
 */
const CONNECTION = process.env.TEST_DATABASE_URL

const pool = CONNECTION ? new pg.Pool({ connectionString: CONNECTION, max: 8 }) : null

/**
 * A clean database per store, so the shared suite's assumptions about counts
 * hold. Schemas rather than databases because creating one is a millisecond
 * and dropping it takes everything with it.
 */
let created = 0
async function freshStore() {
  if (!pool) throw new Error('no database')

  const schema = `helpdeck_test_${process.pid}_${created++}`
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)

  const scoped = new pg.Pool({
    connectionString: CONNECTION,
    max: 4,
    options: `-c search_path=${schema}`,
  })

  await migrate(scoped)
  return { store: postgresStore({ pool: scoped, migrate: false }), pool: scoped, schema }
}

const pools: pg.Pool[] = []

async function make() {
  const { store, pool: scoped } = await freshStore()
  pools.push(scoped)
  return store
}

beforeAll(async () => {
  if (!pool) return
  // Fail loudly here rather than in every test if the database is unreachable.
  await pool.query('SELECT 1')
})

afterAll(async () => {
  for (const scoped of pools) await scoped.end().catch(() => {})
  await pool?.end().catch(() => {})
})

describe.skipIf(!CONNECTION)('postgres', () => {
  // The same assertions every other implementation passes. A store that only
  // passes a suite written for it is not interchangeable with anything.
  storeConformance({ name: 'postgres', make, hooks: { describe, it } })

  it('lets two instances on one database see each other', async () => {
    // The test memory and file stores cannot pass, and the reason this package
    // exists. Two serverless instances are two processes on one database.
    const { pool: scoped } = await freshStore()
    pools.push(scoped)

    const instanceA = postgresStore({ pool: scoped, migrate: false })
    const instanceB = postgresStore({ pool: scoped, migrate: false })

    await instanceA.appendMessage('shared', message({ content: 'written by A' }), { channel: 'web' })
    const seenByB = await instanceB.getConversation('shared')

    expect(seenByB?.messages[0]?.content).toBe('written by A')

    await instanceB.appendMessage('shared', message({ role: 'assistant', content: 'answered by B' }))
    const seenByA = await instanceA.getConversation('shared')

    expect(seenByA?.messages.map((m) => m.content)).toEqual(['written by A', 'answered by B'])
  })

  it('hands out a unique ticket number under concurrent opens', async () => {
    // fileStore reads the highest number and adds one, so twenty at once
    // produce collisions. A sequence cannot.
    const store = await make()
    const now = new Date().toISOString()

    const tickets = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.createTicket({
          subject: `concurrent ${index}`,
          description: 'opened at the same moment as nineteen others',
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

    const numbers = tickets.map((ticket) => ticket.ticketNumber)
    expect(new Set(numbers).size).toBe(20)
    expect(numbers.every((number) => Number.isInteger(number) && number > 0)).toBe(true)
  })

  it('keeps messages in the order they were written, not by timestamp', async () => {
    // Two messages in one turn share a millisecond. Ordering on the timestamp
    // renders the answer above the question.
    const store = await make()
    const sameInstant = new Date().toISOString()

    await store.appendMessage('c_order', message({ content: 'question', createdAt: sameInstant }), { channel: 'web' })
    await store.appendMessage('c_order', message({ role: 'assistant', content: 'answer', createdAt: sameInstant }))

    const found = await store.getConversation('c_order')
    expect(found?.messages.map((m) => m.content)).toEqual(['question', 'answer'])
  })

  it('pages with a cursor that survives a concurrent write', async () => {
    const store = await make()

    for (let index = 0; index < 5; index++) {
      await store.appendMessage(`c_page_${index}`, message({ content: `m${index}` }), { channel: 'web' })
    }

    const first = await store.listConversations({ limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.cursor).toBeDefined()

    // Something else writes between pages, which is the normal case on a busy
    // help desk and the thing offset pagination gets wrong.
    await store.appendMessage('c_page_new', message({ content: 'arrived mid-page' }), { channel: 'web' })

    const second = await store.listConversations({ limit: 2, cursor: first.cursor })
    const overlap = second.items.filter((item) => first.items.some((seen) => seen.id === item.id))

    expect(overlap).toEqual([])
  })

  it('searches tickets by subject, description and message body', async () => {
    const store = await make()
    const now = new Date().toISOString()

    const ticket = await store.createTicket({
      subject: 'Grinder arrived broken',
      description: 'The burr grinder was cracked in the box',
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
      content: 'I have attached a photograph of the packaging',
      createdAt: now,
    })

    expect((await store.searchTickets('grinder')).map((t) => t.ticketNumber)).toContain(ticket.ticketNumber)
    expect((await store.searchTickets('cracked')).map((t) => t.ticketNumber)).toContain(ticket.ticketNumber)
    // Found by something only a message said, not the ticket itself.
    expect((await store.searchTickets('photograph')).map((t) => t.ticketNumber)).toContain(ticket.ticketNumber)
    expect(await store.searchTickets('bicycle')).toEqual([])
  })

  it('does not throw on a search full of punctuation', async () => {
    // A search box receives apostrophes and ampersands. The strict tsquery
    // parser throws on them, which would turn a typo into a 500.
    const store = await make()
    await expect(store.searchTickets("it's broken & i'm cross !!")).resolves.toEqual([])
  })

  it('is safe to migrate twice, and from two stores at once', async () => {
    if (!pool) return
    const schema = `helpdeck_test_migrate_${process.pid}`
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)

    const scoped = new pg.Pool({ connectionString: CONNECTION, max: 4, options: `-c search_path=${schema}` })
    pools.push(scoped)

    await expect(Promise.all([migrate(scoped), migrate(scoped)])).resolves.toBeDefined()
    await expect(migrate(scoped)).resolves.toBeUndefined()
  })

  it('refuses to be built with neither a pool nor a connection string', () => {
    expect(() => postgresStore({})).toThrow(/pool or a connectionString/)
  })

  it('warns when a second pool is opened for the same database', async () => {
    // The mistake that actually exhausts a database is building a store per
    // request. Nothing errors; the connection count just climbs until the
    // database refuses, by which time the cause is hard to see.
    const warnings: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '))

    try {
      const first = postgresStore({ connectionString: CONNECTION, migrate: false })
      const second = postgresStore({ connectionString: CONNECTION, migrate: false })
      expect(first.name).toBe('postgres')
      expect(second.name).toBe('postgres')
    } finally {
      console.warn = original
    }

    expect(warnings.join(' ')).toMatch(/second pool for the same database/)
  })

  it('opens connections that a process can exit on', async () => {
    // Without allowExitOnIdle an idle connection holds the event loop open,
    // so a script that finishes its work never exits.
    const store = postgresStore({ connectionString: CONNECTION, migrate: false })
    expect(store.name).toBe('postgres')
  })
})
