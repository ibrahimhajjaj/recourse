import { describe, expect, it } from 'vitest'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { actionsToTools } from '../src/actions/define.js'
import { collectLeads, escalate, suggestedMessages, webSearch } from '../src/actions/index.js'

/**
 * Two of the same action, which is a real configuration rather than a mistake:
 * escalations on the website and on Instagram, with different rules and
 * different details to gather before the ticket is opened.
 */

async function index() {
  return buildIndex({ sources: [textSource([{ id: 'a', title: 'A', text: 'We refund within 30 days.' }])] })
}

const model = { modelId: 'x' } as never

describe('two actions of the same kind', () => {
  it('are both bound once they are named apart', async () => {
    const web = escalate({ name: 'escalate_web', channels: ['web'], createTicket: async () => ({ id: '1' }) })
    const social = escalate({
      name: 'escalate_instagram',
      channels: ['instagram'],
      createTicket: async () => ({ id: '2' }),
    })

    const tools = actionsToTools([web, social], { context: { emit: () => {} } })
    expect(Object.keys(tools).sort()).toEqual(['escalate_instagram', 'escalate_web'])
  })

  it('can be renamed on every built-in that only had one name', async () => {
    expect(collectLeads({ name: 'book_a_demo' }).name).toBe('book_a_demo')
    expect(webSearch({ name: 'search_the_manuals' }).name).toBe('search_the_manuals')
    expect(suggestedMessages({ name: 'offer_next_steps' }).name).toBe('offer_next_steps')
  })

  it('can each be held to their own channels', async () => {
    // Which is the reason to want two: the same kind of action, different
    // rules, different places.
    expect(collectLeads({ channels: ['web'] }).channels).toEqual(['web'])
    expect(webSearch({ channels: ['web', 'email'] }).channels).toEqual(['web', 'email'])
    expect(collectLeads({}).channels).toBeUndefined()
  })

  it('keep their old names when nobody renames them', () => {
    expect(collectLeads({}).name).toBe('collect_lead')
    expect(webSearch().name).toBe('search_the_web')
    expect(suggestedMessages().name).toBe('suggest_replies')
  })

  it('are refused when they share a name, rather than one quietly winning', async () => {
    // The tool set is keyed on the name, so the second would replace the first
    // and the agent would be handed a tool that behaves like the wrong one.
    await expect(
      (async () =>
        createAgent({
          index: await index(),
          model,
          actions: [collectLeads({}), collectLeads({})],
        }))(),
    ).rejects.toThrow(/both called "collect_lead"/)
  })

  it('build fine when only one of them is a duplicate name away', async () => {
    const agent = createAgent({
      index: await index(),
      model,
      actions: [collectLeads({}), collectLeads({ name: 'book_a_demo' })],
    })

    expect(agent).toBeDefined()
  })
})
