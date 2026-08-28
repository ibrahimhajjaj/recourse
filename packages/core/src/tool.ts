import { jsonSchema, tool, type Tool } from 'ai'
import type { Embedder, KnowledgeIndex, Match } from './types.js'
import { parseIndex } from './knowledge/serialize.js'
import { createRetriever } from './retrieve/retriever.js'
import { createEmbedder } from './embed.js'

export interface KnowledgeToolOptions {
  index: KnowledgeIndex | string
  /** Passages returned per call. */
  topK?: number
  embedder?: Embedder | false
  /**
   * What the agent is told this tool searches. Naming the actual business here
   * is what stops a model calling it for questions it cannot possibly answer.
   */
  description?: string
}

export interface KnowledgePassage {
  /** Cite this number back to the customer. */
  ref: number
  title: string
  section?: string
  url?: string
  text: string
}

/**
 * Exposes the knowledge index as a callable tool rather than as an endpoint.
 *
 * `createChatHandler` owns the whole turn, which is what a support widget
 * wants. An agent already owns its own loop and just needs somewhere to look
 * things up, so this returns a plain AI SDK tool that fits into `generateText`
 * and `streamText`, into Vercel's eve (whose tools take the same
 * description/inputSchema/execute shape), or into any framework built on the
 * AI SDK. The retrieval, chunking and citation behaviour is identical.
 */
export function knowledgeTool(
  options: KnowledgeToolOptions,
  // Annotated rather than inferred: the inferred type reaches into the package
  // manager's internal paths, which does not survive being published.
): Tool<{ question: string }, { passages: KnowledgePassage[] }> {
  const index = parseIndex(options.index)

  const embedder =
    options.embedder === false || !index.vectors
      ? undefined
      : (options.embedder ?? createEmbedder({ model: index.vectors.model.replace(/^(gateway|endpoint|provider):/, '') }))

  const retriever = createRetriever({ index, embedder, topK: options.topK })

  return tool({
    description:
      options.description ??
      'Search the official help documentation for an answer. Use this before answering any factual question, and answer only from what it returns.',

    inputSchema: jsonSchema<{ question: string }>({
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: "The customer's question, in their own words.",
        },
      },
      required: ['question'],
      additionalProperties: false,
    }),

    async execute({ question }) {
      return { passages: toPassages(await retriever.retrieve(question)) }
    },
  })
}

/**
 * The same lookup without the AI SDK, for agents that are not built on it.
 * Returns numbered passages so the caller can render citations the same way.
 */
export function createKnowledgeSearch(options: KnowledgeToolOptions) {
  const index = parseIndex(options.index)
  const embedder =
    options.embedder === false || !index.vectors
      ? undefined
      : (options.embedder ?? createEmbedder({ model: index.vectors.model.replace(/^(gateway|endpoint|provider):/, '') }))
  const retriever = createRetriever({ index, embedder, topK: options.topK })

  return async function search(question: string): Promise<KnowledgePassage[]> {
    return toPassages(await retriever.retrieve(question))
  }
}

function toPassages(matches: Match[]): KnowledgePassage[] {
  return matches.map((match, position) => ({
    ref: position + 1,
    title: match.chunk.title,
    section: match.chunk.section,
    url: match.chunk.url,
    text: match.chunk.text,
  }))
}
