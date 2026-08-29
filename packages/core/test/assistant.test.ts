import { describe, expect, it } from 'vitest'
import { knowledgeActions, ASSISTANT_PROMPT } from '../src/knowledge/assistant.js'
import { createKnowledgeBase } from '../src/knowledge/base.js'
import { memoryStore } from '../src/store/memory.js'
import type { Action, ActionContext } from '../src/actions/types.js'

function find(actions: Action[], name: string): Action {
  const action = actions.find((candidate) => candidate.name === name)
  if (!action) throw new Error(`no action called ${name}`)
  return action
}

const ctx = { emit: () => {} } as unknown as ActionContext

async function setup() {
  const store = memoryStore()
  const knowledge = createKnowledgeBase({ store })
  return { store, knowledge, actions: knowledgeActions({ knowledge, store }) }
}

describe('what the assistant can reach', () => {
  it('offers exactly the runtime-editable operations', async () => {
    const { actions } = await setup()

    expect(actions.map((action) => action.name).sort()).toEqual([
      'add_answer',
      'add_note',
      'list_gaps',
      'list_sources',
      'remove_source',
      'restore_source',
      'retrain',
    ])
  })

  it('says plainly in its prompt what it cannot change', () => {
    // The support lead will ask, and a model with no answer to that invents
    // one and then tries.
    expect(ASSISTANT_PROMPT).toContain('cannot change settings')
    expect(ASSISTANT_PROMPT).toContain('live in the code')
  })
})

describe('the loop this exists for', () => {
  it('reads the gaps, adds an answer, and retrains', async () => {
    const { store, knowledge, actions } = await setup()

    // A week of questions nobody could answer.
    for (let n = 0; n < 3; n++) {
      await store.appendMessage(`c${n}`, {
        id: `m${n}`,
        role: 'user',
        content: 'do you ship to Norway',
        createdAt: new Date().toISOString(),
        unanswered: true,
      }, { channel: 'web' })
    }

    const gaps = await find(actions, 'list_gaps').execute?.({}, ctx)
    expect((gaps as { ok: boolean }).ok).toBe(true)
    expect((gaps as { data: { unanswered: number } }).data.unanswered).toBe(3)

    const added = await find(actions, 'add_answer').execute?.(
      {
        question: 'Do you ship to Norway?',
        answer: 'Yes, Norway takes 5 to 7 working days and costs 12 euro.',
        alternatives: 'norway delivery; shipping to norway',
      },
      ctx,
    )

    expect((added as { data: { needsRetrain: boolean } }).data.needsRetrain).toBe(true)
    expect(knowledge.needsRetrain()).toBe(true)

    const trained = await find(actions, 'retrain').execute?.({}, ctx)
    expect((trained as { data: { retrained: boolean } }).data.retrained).toBe(true)
    expect(knowledge.needsRetrain()).toBe(false)

    // And the answer is now findable, which is the only thing that matters.
    const results = knowledge.index()?.chunks ?? []
    expect(results.some((chunk) => chunk.text.includes('Norway takes 5 to 7'))).toBe(true)
  })

  it('does not retrain when nothing changed', async () => {
    const { actions } = await setup()

    const result = await find(actions, 'retrain').execute?.({}, ctx)

    expect((result as { data: { retrained: boolean } }).data.retrained).toBe(false)
  })
})

describe('guarding what a model should not do alone', () => {
  it('makes a deletion something a person presses', async () => {
    const { actions } = await setup()

    // Not run on the model's own judgment: a model that reads "we do not sell
    // the blue one any more" as an instruction to delete the product page has
    // done something that is not obvious afterwards.
    expect(find(actions, 'remove_source').runs).toBe('client')
    expect(find(actions, 'remove_source').clientPayload).toEqual({ confirm: true })
  })

  it('can be told to skip the confirmation', async () => {
    const store = memoryStore()
    const knowledge = createKnowledgeBase({ store })
    const actions = knowledgeActions({ knowledge, store, confirmDeletes: false })

    expect(find(actions, 'remove_source').runs).toBeUndefined()
  })

  it('deletes softly, so a mistake is one call back', async () => {
    const { knowledge, actions } = await setup()
    const source = await knowledge.addSource({ type: 'text', name: 'Returns', content: 'Fourteen days.' })

    const removed = await find(actions, 'remove_source').execute?.({ id: source.id }, ctx)
    expect((removed as { data: { restorable: boolean } }).data.restorable).toBe(true)

    const restored = await find(actions, 'restore_source').execute?.({ id: source.id }, ctx)
    expect((restored as { ok: boolean }).ok).toBe(true)
  })

  it('refuses an id it was never given', async () => {
    const { actions } = await setup()

    const result = await find(actions, 'remove_source').execute?.({ id: 'src_invented' }, ctx)

    expect((result as { ok: boolean }).ok).toBe(false)
  })

  it('will not save half a question and answer pair', async () => {
    const { actions } = await setup()

    const result = await find(actions, 'add_answer').execute?.({ question: 'Do you ship to Norway?' }, ctx)

    expect((result as { ok: boolean }).ok).toBe(false)
  })

  it('says so rather than failing when there is nowhere to read gaps from', async () => {
    const knowledge = createKnowledgeBase({ store: memoryStore() })
    const actions = knowledgeActions({ knowledge })

    const result = await find(actions, 'list_gaps').execute?.({}, ctx)

    expect((result as { ok: boolean }).ok).toBe(false)
    expect((result as { error: string }).error).toContain('does not record')
  })
})
