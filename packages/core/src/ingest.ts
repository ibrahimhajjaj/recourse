import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Chunker, Embedder, KnowledgeIndex, ProgressEvent, Source } from './types.js'
import { buildIndex } from './knowledge/build.js'
import { serializeIndex } from './knowledge/serialize.js'
import { websiteSource } from './sources/website.js'
import { filesSource } from './sources/files.js'
import { canReachGateway, createEmbedder } from './embed.js'
import type { VectorStore } from './retrieve/vector-store.js'

export interface IngestOptions {
  /** Shorthand for a single website source. */
  url?: string
  /** Shorthand for a single local directory source. */
  path?: string
  /** Full control. Overrides the shorthands when given. */
  sources?: Source[]
  chunker?: Chunker
  /**
   * `true` embeds and fails if it cannot, `false` never embeds, and the default
   * embeds when a Gateway credential is present and quietly skips when not.
   */
  embed?: boolean
  embedder?: Embedder
  /** Embeddings through any OpenAI-compatible endpoint, such as a local Ollama. */
  embedBaseURL?: string
  embedModel?: string
  embedApiKey?: string
  maxPages?: number
  include?: string[]
  exclude?: string[]
  apiKey?: string
  onProgress?: (event: ProgressEvent) => void
  signal?: AbortSignal
  /**
   * Writes the vectors to a database instead of leaving them in the file.
   *
   * The index file carries its vectors inline by default, which is right until
   * the file is the problem: it is parsed on every cold start, and the vectors
   * are most of its weight. Point this at a store and the returned index keeps
   * only the keyword half, which is the smaller half by a long way.
   *
   * The keyword index still travels in the file, so retrieval degrades to
   * keyword search rather than to nothing if the database is unreachable.
   */
  vectorStore?: VectorStore
}

/**
 * Build a knowledge index from a site, a folder, or anything you hand it.
 *
 * The default embedding behaviour is the important part: embeddings improve
 * answers but are not required, so a missing credential downgrades to keyword
 * search instead of failing the build. Ingest works with nothing configured.
 */
export async function ingest(options: IngestOptions): Promise<KnowledgeIndex> {
  const sources = options.sources ?? defaultSources(options)
  if (sources.length === 0) {
    throw new Error('nothing to ingest: pass a url, a path, or your own sources')
  }

  const wantsEmbeddings = options.embed ?? Boolean(options.embedBaseURL) ?? canReachGateway()
  if (options.embed === true && !options.embedder && !options.embedBaseURL && !canReachGateway()) {
    throw new Error(
      'embeddings were requested but no Gateway credential was found. Set AI_GATEWAY_API_KEY, or drop --embed to build a keyword-only index.',
    )
  }

  const index = await buildIndex({
    sources,
    chunker: options.chunker,
    ...(options.vectorStore ? { vectorStore: options.vectorStore } : {}),
    embedder: wantsEmbeddings
      ? (options.embedder ??
        createEmbedder({
          baseURL: options.embedBaseURL,
          model: options.embedModel,
          apiKey: options.embedApiKey,
        }))
      : undefined,
    onProgress: options.onProgress,
    signal: options.signal,
  })

  return index
}

/** Writes the index where the app can import it, creating the folder if needed. */
export async function writeIndex(path: string, index: KnowledgeIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeIndex(index), 'utf8')
}

function defaultSources(options: IngestOptions): Source[] {
  const sources: Source[] = []

  if (options.url) {
    sources.push(
      websiteSource({
        url: options.url,
        maxPages: options.maxPages,
        include: options.include,
        exclude: options.exclude,
        apiKey: options.apiKey ?? process.env.FIRECRAWL_API_KEY,
      }),
    )
  }

  if (options.path) sources.push(filesSource({ path: options.path }))

  return sources
}
