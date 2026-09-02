// Shared by discover.ts and reconcile.ts: runs `worker` over `items` with at most `limit`
// in flight at once, preserving input order in the returned outcomes array.
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const outcomes: R[] = new Array(items.length);
  let index = 0;
  async function next(): Promise<void> {
    const i = index++;
    if (i >= items.length) return;
    outcomes[i] = await worker(items[i]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return outcomes;
}
