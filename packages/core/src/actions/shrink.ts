/**
 * Cutting an action's result down to what is worth showing the model.
 *
 * Whatever an action returns is fed straight back into the conversation, and
 * then again on every later step of the same turn. An order lookup that hands
 * back two hundred rows is therefore billed several times over, crowds out the
 * retrieved passages that were the point, and puts two hundred customers'
 * addresses into a transcript to answer a question about one of them.
 *
 * The model almost never needs the whole thing. It needs the first few rows
 * and an honest count, which is also what a person reading the transcript
 * later needs.
 */

export interface ShrinkOptions {
  /** Roughly 1000 tokens of JSON, which is a generous single tool result. */
  maxChars?: number
  /** Rows before a list is summarised rather than listed. */
  maxItems?: number
  /** Longest single string kept whole. Past this it is cut with a marker. */
  maxStringChars?: number
}

const DEFAULTS = { maxChars: 4000, maxItems: 10, maxStringChars: 2000 }

/**
 * Credentials that reach a result by accident.
 *
 * An action that hands back its own request for debugging, or an error built
 * from a URL with a key in the query string, puts a live credential into the
 * model's context and the stored transcript. Neither is a place a secret
 * survives being read. The patterns are deliberately narrow: these shapes are
 * unmistakable, and a broad one would redact order numbers.
 */
const SECRETS: Array<[RegExp, string]> = [
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'Bearer [redacted]'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})/g, '[redacted]'],
  [/([?&](?:api[_-]?key|access[_-]?token|token|secret|signature)=)[^&\s"']+/gi, '$1[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted]'],
]

/** Removes anything shaped like a live credential. */
export function redact(text: string): string {
  let clean = text
  for (const [pattern, replacement] of SECRETS) clean = clean.replace(pattern, replacement)
  return clean
}

/**
 * Shrinks a value until its JSON fits, preferring to lose rows over detail.
 *
 * Lists lose their tail and gain a count, because the tail is the cheap part
 * and the count is the part the model would otherwise invent. Long strings are
 * cut at the end. Anything still too large after both is replaced by a
 * description of itself, which is the only remaining honest answer.
 */
export function shrink(value: unknown, options: ShrinkOptions = {}): unknown {
  const limits = { ...DEFAULTS, ...options }
  const trimmed = walk(value, limits, 0)

  const encoded = safeStringify(trimmed)
  if (encoded !== undefined && encoded.length <= limits.maxChars) return trimmed

  // Everything survived its own limit and the total is still too big, which
  // means breadth rather than depth: many small fields, or a deep object.
  // Saying so beats sending half a JSON document the model has to guess at.
  return {
    omitted: 'result too large to include',
    bytes: encoded?.length ?? 0,
    ...(isRecord(trimmed) ? { fields: Object.keys(trimmed).slice(0, 40) } : {}),
  }
}

function walk(value: unknown, limits: Required<ShrinkOptions>, depth: number): unknown {
  // Deeper than this and the model is not reading it anyway, and a cyclic
  // structure would otherwise recurse until the stack gives out.
  if (depth > 6) return '[nested]'

  if (typeof value === 'string') {
    const clean = redact(value)
    return clean.length > limits.maxStringChars
      ? `${clean.slice(0, limits.maxStringChars)}... [${clean.length} characters, cut]`
      : clean
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, limits.maxItems).map((entry) => walk(entry, limits, depth + 1))
    if (value.length <= limits.maxItems) return kept
    return { total: value.length, showing: kept.length, items: kept }
  }

  if (value instanceof Date) return value.toISOString()

  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) out[key] = walk(entry, limits, depth + 1)
    return out
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A result holding a cycle or a BigInt should shrink, not throw. */
function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry))
  } catch {
    return undefined
  }
}
