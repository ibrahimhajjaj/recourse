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

export function buildVectorIndex(vectors: Float32Array[], model: string): VectorIndex {
  const dimensions = vectors[0]?.length ?? 0
  const packed = new Int8Array(vectors.length * dimensions)

  for (let i = 0; i < vectors.length; i++) {
    const unit = normalize(vectors[i] as Float32Array)
    const offset = i * dimensions
    for (let d = 0; d < dimensions; d++) {
      // Clamp guards against a provider returning a component marginally over 1.
      const scaled = Math.round((unit[d] as number) * 127)
      packed[offset + d] = scaled > 127 ? 127 : scaled < -127 ? -127 : scaled
    }
  }

  return { dimensions, data: toBase64(packed), model }
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
