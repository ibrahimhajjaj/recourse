import type { VectorIndex } from '../types.js'

/**
 * Vectors are stored as int8, not float32. Embeddings are unit-normalised
 * first, so every component already lives in [-1, 1] and one byte holds it with
 * ~0.4% error, far below the gap between a relevant and irrelevant chunk. The
 * payoff is size: a 512-dimension float32 vector is 12KB of JSON, the same
 * vector as int8 base64 is 700 bytes. That is the difference between an index
 * you commit to git and one you need a database for.
 */

function toBase64(bytes: Int8Array): string {
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let binary = ''
  // Chunked because String.fromCharCode(...huge) blows the argument limit.
  const step = 0x8000
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step))
  }
  return btoa(binary)
}

function fromBase64(value: string): Int8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int8Array(bytes.buffer)
}

/** Scales to unit length so dot product is cosine similarity. */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  const magnitude = Math.sqrt(sum)
  if (magnitude === 0) return vector
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = (vector[i] as number) / magnitude
  return out
}

/** One embedding, unit-normalised and scaled into a byte per component. */
export function quantize(vector: Float32Array): Int8Array {
  const unit = normalize(vector)
  const row = new Int8Array(vector.length)

  for (let d = 0; d < vector.length; d++) {
    // Clamp guards against a provider returning a component marginally over 1.
    const scaled = Math.round((unit[d] as number) * 127)
    row[d] = scaled > 127 ? 127 : scaled < -127 ? -127 : scaled
  }

  return row
}

/**
 * Assembles rows that are already quantised.
 *
 * Kept separate from {@link buildVectorIndex} so an incremental build can mix
 * rows carried over from the previous index with rows it has just embedded.
 * A row that came out of an index is already at the right scale, and putting
 * it through the float path again would decode and requantise it for nothing.
 */
export function packVectors(rows: Int8Array[], dimensions: number, model: string): VectorIndex {
  const packed = new Int8Array(rows.length * dimensions)
  for (let i = 0; i < rows.length; i++) packed.set(rows[i] as Int8Array, i * dimensions)
  return { dimensions, data: toBase64(packed), model }
}

/** The rows back out again, in the order they were written. */
export function unpackVectors(index: VectorIndex): Int8Array[] {
  const { dimensions } = index
  if (dimensions === 0) return []

  const packed = fromBase64(index.data)
  const count = Math.floor(packed.length / dimensions)
  const rows: Int8Array[] = new Array(count)

  for (let i = 0; i < count; i++) rows[i] = packed.slice(i * dimensions, (i + 1) * dimensions)
  return rows
}

export function buildVectorIndex(vectors: Float32Array[], model: string): VectorIndex {
  const dimensions = vectors[0]?.length ?? 0
  return packVectors(vectors.map(quantize), dimensions, model)
}

export interface VectorHit {
  ord: number
  score: number
}

/**
 * Exhaustive scan. No approximate-nearest-neighbour structure, on purpose: at
 * 5,000 chunks this is a few million int multiplications, under a millisecond,
 * and it costs zero build time and zero recall. An HNSW graph only starts
 * paying for itself two orders of magnitude further up.
 */
export function searchVector(index: VectorIndex, query: Float32Array, limit: number): VectorHit[] {
  const { dimensions } = index
  if (dimensions === 0 || query.length !== dimensions) return []

  const packed = fromBase64(index.data)
  const count = Math.floor(packed.length / dimensions)
  const unit = normalize(query)
  const hits: VectorHit[] = new Array(count)

  for (let i = 0; i < count; i++) {
    const offset = i * dimensions
    let dot = 0
    for (let d = 0; d < dimensions; d++) {
      dot += (packed[offset + d] as number) * (unit[d] as number)
    }
    // Undo the int8 scale so scores read as a cosine in [-1, 1].
    hits[i] = { ord: i, score: dot / 127 }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
