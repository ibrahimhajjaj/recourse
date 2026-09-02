import type { ListOptions, Page } from './types.js'

/**
 * Cursor pagination over an already-sorted list. The cursor is the last id
 * seen, so a page stays stable when new rows arrive at the front, which offset
 * pagination cannot promise.
 */
export function paginate<T>(items: T[], options: ListOptions, idOf: (item: T) => string): Page<T> {
  const limit = Math.min(options.limit ?? 50, 200)
  const start = options.cursor ? items.findIndex((item) => idOf(item) === options.cursor) + 1 : 0
  const slice = items.slice(start, start + limit)
  const last = slice[slice.length - 1]
  return {
    items: slice,
    cursor: start + slice.length < items.length && last ? idOf(last) : undefined,
  }
}
