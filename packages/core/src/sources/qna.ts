import type { Document, Source } from '../types.js'

export interface QnaPair {
  question: string
  answer: string
  /** Extra phrasings customers use for the same thing. */
  alternatives?: string[]
  /** Where a human can read more. Shown as the citation link. */
  url?: string
}

export interface QnaSourceOptions {
  pairs: QnaPair[]
  /** Groups these under one title in citations. */
  title?: string
}

/**
 * Curated question and answer pairs.
 *
 * The highest-precision source there is, because someone wrote the exact answer
 * to the exact question. It is also the fix for the questions your analytics
 * say the agent keeps missing: read the gap list, write the pair, re-ingest.
 *
 * Alternative phrasings are indexed alongside the question, which is what makes
 * this work under keyword search too: "cancel my plan" and "stop being charged"
 * share no words, so both need to be written down.
 */
export function qnaSource(options: QnaSourceOptions): Source {
  const title = options.title ?? 'Frequently asked questions'

  return {
    name: 'qna',
    async load() {
      return options.pairs
        .filter((pair) => pair.question.trim() && pair.answer.trim())
        .map((pair, position): Document => {
          const phrasings = [pair.question, ...(pair.alternatives ?? [])].filter(Boolean)
          return {
            id: `qna:${slug(pair.question)}:${position}`,
            title,
            url: pair.url,
            // The question is repeated as a heading and inside the body so it
            // carries weight in both the heading trail and the term statistics.
            text: `# ${pair.question}\n\n${phrasings.slice(1).map((alt) => `Also asked as: ${alt}`).join('\n')}\n\n${pair.answer}`.replace(
              /\n{3,}/g,
              '\n\n',
            ),
          }
        })
    },
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}
