import type { Match, Message, SourceRef } from '../types.js'

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
export function buildInstructions(persona: PersonaOptions, matches: Match[]): string {
  const name = persona.name ?? 'the support assistant'
  const business = persona.business ? ` for ${persona.business}` : ''
  const fallback = persona.fallback ?? DEFAULT_FALLBACK

  const context = matches
    .map((match, position) => {
      const heading = [match.chunk.title, match.chunk.section].filter(Boolean).join(' > ')
      return `[${position + 1}] ${heading}\n${match.chunk.text}`
    })
    .join('\n\n---\n\n')

  return [
    `You are ${name}, a customer support agent${business}.`,
    '',
    'Rules:',
    '- Answer only from the numbered sources below. They are the entire truth you have.',
    `- If the sources do not answer the question, say exactly this and stop: "${fallback}"`,
    '- Never invent prices, policies, dates, URLs or availability. A wrong answer costs more than no answer.',
    '- Cite the sources you used inline as [1], [2]. Cite only what you actually relied on.',
    '- Be brief. Two or three sentences unless the question genuinely needs steps.',
    '- Reply in the language the customer wrote in.',
    persona.instructions ? `\n${persona.instructions}` : '',
    '',
    matches.length > 0 ? `Sources:\n\n${context}` : 'Sources: none matched this question.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * The citation list the widget renders under an answer.
 *
 * The prompt gets the whole heading trail because the model needs the context,
 * but a reader does not: the trail starts at the page's own H1, so showing it
 * next to the title renders as "Shipping and delivery - Shipping and delivery >
 * Shipping cost". Only the deepest heading is new information.
 */
export function toSourceRefs(matches: Match[]): SourceRef[] {
  const seen = new Set<string>()
  const refs: SourceRef[] = []

  for (const match of matches) {
    const key = match.chunk.url ?? match.chunk.docId
    if (seen.has(key)) continue
    seen.add(key)

    const deepest = match.chunk.section?.split('>').pop()?.trim()
    refs.push({
      title: match.chunk.title,
      url: match.chunk.url,
      section: deepest && deepest !== match.chunk.title ? deepest : undefined,
    })
  }

  return refs
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
