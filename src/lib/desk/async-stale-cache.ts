/**
 * Small process-local cache for read models that are safe to serve briefly
 * stale. Concurrent misses for the same key share one loader, so a polling
 * burst cannot fan out identical database work.
 */
export class AsyncStaleCache<K, V> {
  private readonly values = new Map<K, { at: number; value: V }>();
  private readonly pending = new Map<K, Promise<V>>();
  private readonly freshMs: number;
  private readonly staleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    freshMs: number,
    staleMs: number,
    maxEntries: number,
    now: () => number = Date.now,
  ) {
    this.freshMs = freshMs;
    this.staleMs = staleMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  async get(key: K, load: () => Promise<V>): Promise<V> {
    const cached = this.values.get(key);
    if (cached && this.now() - cached.at <= this.freshMs) {
      // Touch the key so bounded eviction approximates LRU.
      this.values.delete(key);
      this.values.set(key, cached);
      return cached.value;
    }

    const existing = this.pending.get(key);
    if (existing) return existing;

    const request = (async () => {
      try {
        const value = await load();
        this.values.delete(key);
        this.values.set(key, { at: this.now(), value });
        while (this.values.size > this.maxEntries) {
          const oldest = this.values.keys().next().value as K | undefined;
          if (oldest === undefined) break;
          this.values.delete(oldest);
        }
        return value;
      } catch (err) {
        // Read-only UI summaries may degrade to the last successful snapshot;
        // write paths and decision state never use this cache.
        const fallback = this.values.get(key);
        if (fallback && this.now() - fallback.at <= this.staleMs) return fallback.value;
        throw err;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, request);
    return request;
  }

  invalidate(key: K): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}
