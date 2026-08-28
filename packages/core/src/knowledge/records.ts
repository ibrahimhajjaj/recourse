/**
 * Sources as records you can manage at runtime.
 *
 * The index that ships with a deployment is a build artefact, which is right
 * for content that lives in your repository. It is wrong for a support team
 * that reads the answer-gap list on Monday and wants to write three new
 * question-and-answer pairs on Tuesday without a deploy.
 */

export type SourceType = 'text' | 'qna' | 'link' | 'file'

export type SourceStatus = 'active' | 'pending_deletion'

export interface SourceRecord {
  id: string
  type: SourceType
  /** Shown in the source list, and used as the citation title. */
  name: string
  status: SourceStatus
  createdAt: string
  updatedAt: string

  /** For text and file sources. */
  content?: string
  /** For link sources. Immutable: change it by deleting and recreating. */
  url?: string
  /** For qna sources. */
  pairs?: Array<{ question: string; answer: string; alternatives?: string[] }>

  /** Filled in after the source has been indexed. */
  chunks?: number
  characters?: number
  /** When it was last fetched, for link sources on a retrain schedule. */
  fetchedAt?: string
}

export interface SourcesSummary {
  byType: Record<SourceType, { count: number; characters: number }>
  total: { count: number; characters: number; chunks: number }
  /** True when a source changed since the last successful index build. */
  needsRetrain: boolean
  lastTrainedAt?: string
}

export function newSourceId(type: SourceType): string {
  return `src_${type}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Rejects a record that could never produce anything to retrieve. */
export function validateSource(record: Partial<SourceRecord>): void {
  if (!record.type) throw new Error('a source needs a type')
  if (!record.name?.trim()) throw new Error('a source needs a name')

  if (record.type === 'link' && !record.url?.trim()) throw new Error('a link source needs a url')
  if ((record.type === 'text' || record.type === 'file') && !record.content?.trim()) {
    throw new Error(`a ${record.type} source needs content`)
  }
  if (record.type === 'qna' && !record.pairs?.length) throw new Error('a qna source needs at least one pair')

  if (record.url) {
    let parsed: URL
    try {
      parsed = new URL(record.url)
    } catch {
      throw new Error(`"${record.url}" is not a valid url`)
    }
    // Anything else is a way to make the server fetch a file off its own disk.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('a link source must be http or https')
    }
  }
}
