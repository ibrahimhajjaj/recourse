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

/**
 * Cursor pagination where the row the cursor names may no longer match.
 *
 * The difference from `paginate` is the whole point of it: the anchor is
 * looked up among **every** row rather than only the matching ones. A listing
 * is read while the thing it lists is being written to, so a row you have
 * already been handed can stop matching between one page and the next. A
 * source finishes re-crawling and its status changes, a ticket somebody closes
 * while you page the open ones, a conversation that a new message pushes past
 * your `until`. Looked for among the matching rows it is simply not there, and
 * the walk ends silently with the rest of the list undelivered.
 *
 * A row that is genuinely gone still ends the listing, because starting again
 * looks like a first page to a caller looping until the cursor runs out, so it
 * never runs out.
 *
 * `order` has to be the same comparison the SQL stores use, tie-break
 * included: two rows with the same timestamp and no second thing to order by
 * can come back either way round, and paging one at a time then hands one of
 * them over twice and the other never.
 */
export function pageAfter<T>(
  all: T[],
  matching: T[],
  options: ListOptions,
  idOf: (item: T) => string,
  order: (a: T, b: T) => number,
): Page<T> {
  const sorted = [...matching].sort(order)
  const limit = pageSize(options.limit)
  let start = 0

  if (options.cursor) {
    const anchor = all.find((item) => idOf(item) === options.cursor)
    if (!anchor) return { items: [] }

    const found = sorted.findIndex((item) => order(anchor, item) < 0)
    start = found === -1 ? sorted.length : found
  }

  const slice = sorted.slice(start, start + limit)
  const last = slice[slice.length - 1]

  return {
    items: slice,
    ...(start + slice.length < sorted.length && last ? { cursor: idOf(last) } : {}),
  }
}

/** Newest first, with the id breaking a tie the same way round. */
export function byNewest<T extends { id: string }>(at: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => at(b).localeCompare(at(a)) || b.id.localeCompare(a.id)
}
