/**
 * A title, a summary and a mood for a conversation, so a stored one can be
 * read without opening it.
 *
 * A support inbox is only useful if you can skim it. Without this, finding the
 * conversation that went badly last Tuesday means opening thirty of them.
 *
 * The cost is the thing to get right, because a naive version runs a model on
 * every message and a busy shop pays for it all day. So: a conversation is
 * marked as changed when a turn ends, which is free, and the model runs later
 * over whatever is still marked, at whatever interval the deployment chooses.
 * Ten messages produce one summary, not ten.
 *
 * The mood is carried forward rather than recomputed from scratch. Judging the
 * last two messages on their own makes it flip on every turn; giving the model
 * what it decided last time makes it a state that changes when something
 * actually changes.
 */

import type { LanguageModel } from 'ai'
import { patchConversationMeta } from './store/meta.js'
import { getLogger } from './diagnostics.js'
import type { Conversation, Store, StoredMessage } from './store/types.js'

/** Where the answers live on the conversation, so a store needs no migration. */
export const INSIGHT_KEYS = {
  title: 'insightTitle',
  summary: 'insightSummary',
  mood: 'insightMood',
  /** Set when something has been said since the last summary. */
  stale: 'insightStale',
  at: 'insightAt',
} as const

/** How the customer seems to be finding it. */
export type Mood = 'angry' | 'unhappy' | 'neutral' | 'happy' | 'delighted'

const MOODS: Mood[] = ['angry', 'unhappy', 'neutral', 'happy', 'delighted']

export interface Insight {
  title: string
  summary: string
  mood: Mood
}

export interface InsightOptions {
  store: Store
  /**
   * Something small. This reads a transcript and writes three short strings,
   * which is the cheapest thing a model is ever asked to do here.
   */
  model: LanguageModel
  /** Messages read from the end of the conversation. */
  maxMessages?: number
  signal?: AbortSignal
}

/**
 * Marks a conversation as having something new to say about it.
 *
 * Free: one field on the conversation. Call it when a turn ends and let
 * {@link summariseStale} do the expensive half later.
 */
export async function markChanged(store: Store, conversationId: string): Promise<void> {
  await patchConversationMeta(store, conversationId, { [INSIGHT_KEYS.stale]: true })
}

/**
 * Reads one conversation and writes back what it is about.
 *
 * Returns null when there is nothing worth summarising or the model could not
 * be reached. A failure here must never cost a turn: this runs behind the
 * conversation, not in front of it.
 */
export async function summarise(
  conversationId: string,
  options: InsightOptions,
): Promise<Insight | null> {
  const thread = await options.store.getConversation(conversationId)
  if (!thread) return null

  const messages = thread.messages.slice(-(options.maxMessages ?? 40))
  // One message is a greeting. There is nothing to say about it yet, and
  // saying something anyway means paying to summarise every abandoned tab.
  if (messages.length < 2) return null

  const previous = thread.conversation.meta?.[INSIGHT_KEYS.mood]
  const insight = await ask(messages, typeof previous === 'string' ? previous : undefined, options)
  if (!insight) return null

  await patchConversationMeta(options.store, conversationId, {
    [INSIGHT_KEYS.title]: insight.title,
    [INSIGHT_KEYS.summary]: insight.summary,
    [INSIGHT_KEYS.mood]: insight.mood,
    [INSIGHT_KEYS.at]: new Date().toISOString(),
    [INSIGHT_KEYS.stale]: false,
  })

  return insight
}

/**
 * Summarises everything marked as changed, oldest first.
 *
 * Run it on whatever schedule suits: a cron, a queue, the end of a request. The
 * `limit` is what stops a backlog turning into one enormous bill the first time
 * somebody turns this on.
 */
export async function summariseStale(
  options: InsightOptions & { limit?: number },
): Promise<{ done: number; failed: number }> {
  const limit = options.limit ?? 20
  let done = 0
  let failed = 0

  for (const conversation of await staleConversations(options.store, limit)) {
    let ok = false

    try {
      ok = (await summarise(conversation.id, options)) !== null
    } catch (error) {
      getLogger().error(`could not summarise ${conversation.id}:`, error)
    }

    if (ok) {
      done++
      continue
    }

    failed++
    // Cleared however it failed, including a reply the parser refused. Leaving
    // the mark on means paying to be refused again on every sweep, for ever.
    await patchConversationMeta(options.store, conversation.id, { [INSIGHT_KEYS.stale]: false }).catch(() => {})
  }

  return { done, failed }
}

/** What is already known about a conversation, without asking the model. */
export function insightOf(conversation: Conversation): Partial<Insight> {
  const meta = conversation.meta ?? {}
  const mood = meta[INSIGHT_KEYS.mood]

  return {
    ...(typeof meta[INSIGHT_KEYS.title] === 'string' ? { title: meta[INSIGHT_KEYS.title] as string } : {}),
    ...(typeof meta[INSIGHT_KEYS.summary] === 'string' ? { summary: meta[INSIGHT_KEYS.summary] as string } : {}),
    ...(typeof mood === 'string' && MOODS.includes(mood as Mood) ? { mood: mood as Mood } : {}),
  }
}

async function staleConversations(store: Store, limit: number): Promise<Conversation[]> {
  // Read wider than the limit, because the marked ones are a minority of any
  // page and asking for exactly `limit` would usually return fewer.
  const page = await store.listConversations({ limit: limit * 5 })

  return page.items.filter((conversation) => conversation.meta?.[INSIGHT_KEYS.stale] === true).slice(0, limit)
}

async function ask(
  messages: StoredMessage[],
  previousMood: string | undefined,
  options: InsightOptions,
): Promise<Insight | null> {
  const transcript = messages
    .map((message) => `${message.role === 'user' ? 'Customer' : 'Agent'}: ${message.content}`)
    .join('\n')

  try {
    const { generateText } = await import('ai')
    const { text } = await generateText({
      model: options.model,
      // Pinned. A summary that changes wording every time it runs is a summary
      // nobody can diff, and this is read by people comparing conversations.
      temperature: 0,
      maxOutputTokens: 300,
      instructions:
        'You are labelling a customer support conversation for a support lead who will skim it.\n' +
        'Reply with exactly three lines and nothing else:\n' +
        'TITLE: at most eight words, what the customer wanted\n' +
        'SUMMARY: one sentence, what happened and how it was left\n' +
        'MOOD: one of angry, unhappy, neutral, happy, delighted\n' +
        'Judge the mood on how the customer seems, not on how the agent wrote.' +
        (previousMood
          ? `\nIt was last judged ${previousMood}. Keep that unless something in these messages actually changed it.`
          : ''),
      prompt: transcript,
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })

    return parse(text)
  } catch (error) {
    getLogger().error('could not summarise a conversation:', error)

    return null
  }
}

/**
 * Reads the three lines back, and refuses anything that is not all three.
 *
 * A half-parsed insight is worse than none: a title with no summary looks like
 * a conversation nobody has looked at, which is exactly what it is not.
 */
function parse(text: string): Insight | null {
  const line = (label: string): string | undefined => {
    const row = text.split('\n').find((candidate) => candidate.trim().toUpperCase().startsWith(`${label}:`))

    return row?.slice(row.indexOf(':') + 1).trim()
  }

  const title = line('TITLE')
  const summary = line('SUMMARY')
  const mood = line('MOOD')?.toLowerCase()

  // All three or nothing. A title with no summary looks like a conversation
  // nobody has looked at, which is exactly what it is not.
  if (!title || !summary || !mood || !MOODS.includes(mood as Mood)) return null

  return { title: title.slice(0, 120), summary: summary.slice(0, 400), mood: mood as Mood }
}
