import type { KnowledgeIndex } from '../types.js'

/** Compact on disk: this file gets committed, so newlines are wasted bytes. */
export function serializeIndex(index: KnowledgeIndex): string {
  return JSON.stringify(index)
}

export function parseIndex(json: string | KnowledgeIndex): KnowledgeIndex {
  const index = typeof json === 'string' ? (JSON.parse(json) as KnowledgeIndex) : json

  if (index?.version !== 1) {
    throw new Error(
      `unsupported knowledge index version ${String(index?.version)}; rebuild it with the current helpdeck`,
    )
  }
  if (!Array.isArray(index.chunks) || !index.keyword) {
    throw new Error('knowledge index is malformed; rebuild it with `helpdeck ingest`')
  }

  return index
}
