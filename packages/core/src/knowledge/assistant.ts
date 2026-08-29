/**
 * An agent for the person who owns the content but not the repository.
 *
 * The position everywhere else in this project is that configuration is code
 * and your editor is the copilot. That is right for a developer and wrong for
 * the support lead who knows exactly which question the agent keeps failing
 * and has no way to fix it without asking somebody.
 *
 * So this is deliberately narrow. It can only do what the management API can
 * already do: read the gaps, add a Q&A pair or a note, and retrain. It cannot
 * change a setting, write a procedure, touch a threshold or generate code,
 * because those are code and a model editing them is a config change nobody
 * reviewed.
 *
 * The loop it exists for is one question long:
 *
 *   "What could you not answer this week?"
 *   "Add an answer for the top one."
 *   "Retrain."
 *
 * That is the whole of the value, and it needs no new infrastructure: the
 * knowledge base, the actions, the agent and the widget all already exist.
 */

import type { Action, ActionContext, ActionInput } from '../actions/types.js'
import type { KnowledgeBase } from './base.js'
import type { Store } from '../store/types.js'

export interface AssistantOptions {
  knowledge: KnowledgeBase
  /** Read for the unanswered-question list. Without it there are no gaps. */
  store?: Store
  /**
   * Deleting a source needs a person to press a button.
   *
   * A model that misreads "we do not sell the blue one any more" as an
   * instruction to delete the product page is a bad afternoon, and unlike a
   * wrong answer it is not obvious afterwards. On by default.
   */
  confirmDeletes?: boolean
}

/**
 * The actions that manage a knowledge base.
 *
 * Pass them to `createAgent` with a prompt saying who it is talking to. The
 * agent is otherwise the ordinary one, which is the point: nothing here is a
 * new kind of thing.
 */
export function knowledgeActions(options: AssistantOptions): Action[] {
  const { knowledge } = options
  const confirmDeletes = options.confirmDeletes ?? true

  const actions: Action[] = [
    {
      name: 'list_gaps',
      whenToUse:
        'Show which questions visitors asked that the agent could not answer. Use when somebody asks what is missing, what to add, or how the agent has been doing.',
      async execute(_input, _ctx) {
        if (!options.store) {
          return { ok: false, error: 'this deployment does not record unanswered questions' }
        }

        const stats = await options.store.stats()

        return {
          ok: true,
          data: {
            unanswered: stats.unanswered,
            // The list is the useful part; the count on its own tells a
            // support lead nothing they can act on.
            gaps: stats.topGaps.slice(0, 10),
          },
        }
      },
    },

    {
      name: 'add_answer',
      whenToUse:
        'Write a question and its answer into the knowledge base. Use when somebody tells you what the answer to a missing question should be. Always read the answer back to them before saying it is saved.',
      collect: [
        {
          name: 'question',
          type: 'string',
          description: 'The question as a customer would ask it.',
          required: true,
        },
        {
          name: 'answer',
          type: 'string',
          description: 'The answer, in the business\'s own words.',
          required: true,
        },
        {
          name: 'alternatives',
          type: 'string',
          description: 'Other ways customers ask the same thing, separated by a semicolon. Optional.',
        },
      ],
      async execute(input) {
        const question = text(input.question)
        const answer = text(input.answer)

        if (!question || !answer) {
          return { ok: false, error: 'both a question and an answer are needed' }
        }

        const alternatives = text(input.alternatives)
          .split(';')
          .map((phrase) => phrase.trim())
          .filter(Boolean)

        const source = await knowledge.addSource({
          type: 'qna',
          name: question.slice(0, 80),
          pairs: [{ question, answer, ...(alternatives.length > 0 ? { alternatives } : {}) }],
        })

        // Saying it needs retraining rather than retraining here. Rebuilding
        // an index per pair on a site adding ten of them is ten rebuilds, and
        // the person adding them knows when they have finished.
        return {
          ok: true,
          data: { id: source.id, saved: true, needsRetrain: true },
        }
      },
    },

    {
      name: 'add_note',
      whenToUse:
        'Save a paragraph of information that is not a question and answer, such as opening hours or a policy. Use when somebody tells you something the agent should know.',
      collect: [
        { name: 'title', type: 'string', description: 'A short name for it.', required: true },
        { name: 'content', type: 'string', description: 'The text itself.', required: true },
      ],
      async execute(input) {
        const title = text(input.title)
        const content = text(input.content)

        if (!title || !content) return { ok: false, error: 'both a title and some text are needed' }

        const source = await knowledge.addSource({ type: 'text', name: title, content })

        return { ok: true, data: { id: source.id, saved: true, needsRetrain: true } }
      },
    },

    {
      name: 'list_sources',
      whenToUse:
        'Show what the agent currently knows: pages, notes and answers. Use before adding something, to check whether it is already there.',
      async execute() {
        const page = await knowledge.listSources('active')

        return {
          ok: true,
          data: page.items.map((source) => ({
            id: source.id,
            name: source.name,
            type: source.type,
            updatedAt: source.updatedAt,
          })),
        }
      },
    },

    {
      name: 'retrain',
      whenToUse:
        'Rebuild the index so recent changes take effect. Use after adding or removing anything, and when somebody asks why a change has not shown up yet.',
      async execute() {
        if (!knowledge.needsRetrain()) {
          return { ok: true, data: { retrained: false, reason: 'nothing has changed since the last one' } }
        }

        const stats = await knowledge.train()

        return { ok: true, data: { retrained: true, ...stats } }
      },
    },
  ]

  actions.push({
    name: 'remove_source',
    whenToUse:
      'Remove a page, note or answer from the knowledge base. Ask which one, list the sources if you are not sure, and never guess at an id.',
    collect: [
      { name: 'id', type: 'string', description: 'The source id, from list_sources.', required: true },
    ],
    // Rendered as a button the person presses, rather than run on the model's
    // own judgment. A model that reads "we do not sell the blue one any more"
    // as an instruction to delete the product page has done something that is
    // not obvious afterwards, unlike a wrong answer.
    ...(confirmDeletes ? { runs: 'client' as const, clientPayload: { confirm: true } } : {}),
    async execute(input: ActionInput, _ctx: ActionContext) {
      const id = text(input.id)
      if (!id) return { ok: false, error: 'a source id is needed' }

      const removed = await knowledge.deleteSource(id)

      if (!removed) return { ok: false, error: 'there is no source with that id' }

      // Soft, so a wrong deletion is a `restore_source` away rather than a
      // re-crawl.
      return { ok: true, data: { removed: removed.name, restorable: true, needsRetrain: true } }
    },
  })

  actions.push({
    name: 'restore_source',
    whenToUse: 'Put back something that was removed. Use when somebody says a deletion was a mistake.',
    collect: [{ name: 'id', type: 'string', description: 'The source id.', required: true }],
    async execute(input) {
      const id = text(input.id)
      if (!id) return { ok: false, error: 'a source id is needed' }

      const restored = await knowledge.restoreSource(id)

      return restored
        ? { ok: true, data: { restored: restored.name, needsRetrain: true } }
        : { ok: false, error: 'there is no source with that id' }
    },
  })

  return actions
}

/**
 * The instructions for a management agent.
 *
 * A different job from answering customers, and the differences matter: this
 * one is talking to a colleague, it is allowed to act on its own, and the
 * thing it must never do is claim a change took effect before it did.
 */
export const ASSISTANT_PROMPT = [
  'You help the support team manage what this assistant knows.',
  'You are talking to a colleague who owns the content, not to a customer.',
  '',
  'How to work:',
  '- Read the gaps before suggesting what to add. The list of questions nobody could answer is the most useful thing you have.',
  '- Read an answer back before you save it, in full, and save it only once they agree.',
  '- Adding something does not make it live. Say that it needs a retrain, and offer to run one.',
  '- After a retrain, say what changed: how many sources and chunks the index now holds.',
  '- Never invent a source id. List the sources and use one from the list.',
  '- You can add answers, add notes, remove sources and retrain. You cannot change settings, thresholds, procedures or the prompt; those live in the code, and say so plainly if asked.',
  '- Be brief. This is a working tool, not a conversation.',
].join('\n')

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
