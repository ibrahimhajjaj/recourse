import type { ListOptions, Page } from './types.js'

/**
 * Cursor pagination over an already-sorted list. The cursor is the last id
 * seen, so a page stays stable when new rows arrive at the front, which offset
 * pagination cannot promise.
 *
 * Two edges are worth stating, because both used to answer confidently and
 * wrongly. A cursor whose row is gone, evicted or deleted since it was handed
 * out, ends the listing rather than starting it again: restarting looks like a
 * full first page to a caller looping until the cursor runs out, so it never
 * runs out. And a limit outside the range it accepts is brought inside it,
 * where `-1` previously meant "every row but the last".
 */
export function paginate<T>(items: T[], options: ListOptions, idOf: (item: T) => string): Page<T> {
  const limit = pageSize(options.limit)

  let start = 0

  if (options.cursor) {
    const at = items.findIndex((item) => idOf(item) === options.cursor)
    if (at === -1) return { items: [] }
    start = at + 1
  }

  const slice = items.slice(start, start + limit)
  const last = slice[slice.length - 1]

  return {
    items: slice,
    cursor: start + slice.length < items.length && last ? idOf(last) : undefined,
  }
}

/**
 * The number of rows a page may hold, whatever was asked for.
 *
 * Shared so the SQL stores agree with the in-memory ones. A negative number
 * reaching a `LIMIT` clause means "no limit" in SQLite and is an error in
 * Postgres, while in an array slice it quietly means "all but the last": three
 * different answers to the same mistake.
 */
export function pageSize(limit: number | undefined, fallback = 50, most = 200): number {
  const asked = Math.trunc(limit ?? fallback)
  return Math.min(Math.max(Number.isFinite(asked) ? asked : fallback, 1), most)
}
