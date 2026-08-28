import type { Match, Message, SourceRef } from '../types.js'
import type { Action } from '../actions/types.js'

export interface PersonaOptions {
  /** What the agent calls itself. */
  name?: string
  /** Whose business it works for. Grounds the answers in a real company. */
  business?: string
  /** Extra rules appended verbatim: tone, escalation policy, languages. */
  instructions?: string
  /** Said when the retrieved context does not contain the answer. */
  fallback?: string
}

const DEFAULT_FALLBACK =
  "I don't have that in my documentation. Could you rephrase, or would you like me to pass this to a human?"

/**
 * The system prompt does three jobs and nothing else: fence the model to the
 * retrieved context, force a citation, and give it an honest way out. Most bad
 * support-bot behaviour is a missing third job: a model with no sanctioned way
 * to say "I don't know" will invent something instead.
 */
export interface ActionOutcome {
  name: string
  input?: unknown
  output: unknown
}

export function buildInstructions(
  persona: PersonaOptions,
  matches: Match[],
  actions: Action[] = [],
  /** Results of actions the browser ran on the agent's behalf. */
  clientResults: ActionOutcome[] = [],
): string {
  const name = persona.name ?? 'the support assistant'
  const business = persona.business ? ` for ${persona.business}` : ''
  const fallback = persona.fallback ?? DEFAULT_FALLBACK

  const context = matches
    .map((match, position) => {
      const heading = [match.chunk.title, match.chunk.section].filter(Boolean).join(' > ')
      return `[${position + 1}] ${heading}\n${match.chunk.text}`
    })
    .join('\n\n---\n\n')

  const lines = [
    `You are ${name}, a customer support agent${business}.`,
    '',
    'Answering:',
    '- Answer from the numbered sources below and from what actions return. Nothing else.',
    `- If neither answers the question, say exactly this and stop: "${fallback}"`,
    '- Never invent prices, policies, dates, URLs, order details or availability. A wrong answer costs more than no answer.',
    '- Cite the sources you used inline as [1], [2]. Cite only what you actually relied on.',
    '- Be brief. Two or three sentences unless the question genuinely needs steps.',
    '- Reply in the language the customer wrote in.',
  ]

  if (actions.length > 0) {
    lines.push(
      '',
      'Using your actions:',
      // Models narrate tool use by default, which reads like a machine talking
      // to itself rather than a support agent helping someone.
      '- Do not announce that you are about to use one, and do not mention their names. Use it, then reply as if you simply knew.',
      '- Ask the customer for anything an action needs that you do not have. Never guess an email address, an order number or an amount.',
      '- One action at a time. Read what it returns before deciding on the next.',
      '- If an action fails, say plainly what did not work and offer the next best step. Do not retry it more than once.',
      '',
      'Your actions:',
      ...actions.map((action) => `- ${action.name}: ${action.whenToUse}`),
    )
  }

  if (clientResults.length > 0) {
    // Fed back as plain context rather than reconstructed tool messages: every
    // model understands this, including small local ones with patchy support
    // for multi-turn tool protocols.
    lines.push(
      '',
      'You asked the page to run these, and it returned:',
      ...clientResults.map(
        (result) => `- ${result.name} -> ${safeJson(result.output)}`,
      ),
      'Use these results to answer now. Do not call them again.',
    )
  }

  if (persona.instructions) lines.push('', persona.instructions)

  lines.push(
    '',
    matches.length > 0 ? `Sources:\n\n${context}` : 'Sources: nothing in the documentation matched this question.',
  )

  return lines.join('\n')
}

/**
 * The citation list, numbered exactly as the prompt numbers its sources.
 *
 * These two numberings have to be the same list. An earlier version deduplicated
 * by page here while the prompt numbered every chunk, so a model that cited [4]
 * pointed at an entry the client did not have, and the citation silently
 * vanished. One chunk, one number, same order, both sides.
 *
 * Display-level deduplication belongs in the client, after it knows which
 * numbers the answer actually used.
 */
export function toSourceRefs(matches: Match[]): SourceRef[] {
  return matches.map((match) => {
    const deepest = match.chunk.section?.split('>').pop()?.trim()
    return {
      title: match.chunk.title,
      url: match.chunk.url,
      section: deepest && deepest !== match.chunk.title ? deepest : undefined,
    }
  })
}

/** Bounded, because a browser can return anything and it all costs context. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2000)
  } catch {
    return String(value).slice(0, 2000)
  }
}

/** The question on its own, which is what most turns should retrieve on. */
export function retrievalQuery(messages: Message[]): string {
  const users = messages.filter((message) => message.role === 'user')
  return users[users.length - 1]?.content ?? ''
}

/**
 * The question with the previous one prepended, for follow-ups like "and the
 * refund?" that carry no subject of their own.
 *
 * This is a fallback rather than the default. Folding the previous turn in
 * every time means a customer who changes the subject, asking "do you sell
 * tea?" straight after a delivery question, retrieves the old topic and gets
 * answered about the wrong thing. Trying the bare question first and only
 * reaching for context when it finds nothing gets both cases right.
 */
export function contextualQuery(messages: Message[]): string | null {
  const users = messages.filter((message) => message.role === 'user')
  const latest = users[users.length - 1]?.content
  const previous = users[users.length - 2]?.content
  if (!latest || !previous) return null
  return `${previous}\n${latest}`
}
