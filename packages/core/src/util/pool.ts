/**
 * Runs tasks with a fixed number in flight. Keeping this here rather than
 * pulling in p-limit keeps the package dependency-free, which is the whole
 * point of the install story.
 */
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index] as T, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}
