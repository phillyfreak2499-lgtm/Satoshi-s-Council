/**
 * Resolving a ticker-only replay URL to ONE window — or refusing.
 *
 * WHY THIS IS ITS OWN MODULE. The public replay page is addressed by ticker alone, but
 * a ticker is not a window: `desk_replay`'s identity is (ticker, close_time), and a
 * feed that stops advancing its ticker — as on 2026-09-10 — can leave two closes
 * sharing one. The URL cannot say which the visitor meant, so the only honest answers
 * are "that one" when there is exactly one, and "none" otherwise.
 *
 * The rule lives here, pure and injected, because the sequence is the whole point and
 * it has to be testable: a cached payload must never be able to answer a ticker that
 * has SINCE become ambiguous. That ordering is invisible to a source-matching rail and
 * cannot be checked by a query in isolation.
 *
 * Pure module: no database, no clock, no imports. The two reads are passed in.
 */

/** What the identity probe returns: one row per window this ticker has a replay for. */
export type WindowRef = { close_time: string };

/**
 * Which single window a ticker names, or null when the answer is not exactly one.
 *
 * Zero means no replay. Two or more means ambiguous, and ambiguous FAILS CLOSED — no
 * newest, no oldest, no first. Showing one window's series under a ticker that names
 * two would rebuild the identity defect at the API layer, and the wrong window is
 * worse than no window.
 */
export function resolveOneWindow(found: readonly WindowRef[]): string | null {
  return found.length === 1 ? found[0]!.close_time : null;
}

/**
 * The cache key: both halves, so (T,c1) and (T,c2) cannot share an entry.
 *
 * It is a join on "|" and therefore not injective over arbitrary strings — a ticker
 * ending in the separator plus digits could in principle meet another ticker's key.
 * That is unreachable rather than impossible: `replay.server.ts` admits only
 * `[A-Z0-9-]` in a ticker, and a close is always a fixed-shape ISO string. Stated
 * plainly because a key that looks injective and is not is worse than one whose limit
 * is written down; a test pins both halves of that guard.
 */
export function payloadKey(ticker: string, closeIso: string): string {
  return `${ticker}|${closeIso}`;
}

/**
 * The ticker-only lookup, in the one order that cannot lie.
 *
 *   1. PROBE the current persisted identity. Always. Never cached.
 *   2. Exactly one window, or null.
 *   3. Only then consult the cache, under the resolved window's key.
 *   4. On a miss, fetch that exact window and cache it.
 *
 * Step 1 before step 3 is the invariant. Reverse them and the first visitor to a
 * ticker with one replay caches it, and once a second close for that ticker exists the
 * stale entry keeps answering a question that has become ambiguous.
 *
 * A row is immutable once written, so caching the PAYLOAD is safe. Caching the
 * ticker-to-window MAPPING is not, and this never does.
 */
export async function lookupOneWindow<T>(
  ticker: string,
  cache: Map<string, T>,
  probe: (ticker: string) => Promise<readonly WindowRef[]>,
  fetchWindow: (ticker: string, closeIso: string) => Promise<T | null>,
  cap = 24,
): Promise<T | null> {
  const closeIso = resolveOneWindow(await probe(ticker));
  if (closeIso == null) return null;
  const key = payloadKey(ticker, closeIso);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const out = await fetchWindow(ticker, closeIso);
  if (out == null) return null;
  cache.set(key, out);
  if (cache.size > cap) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return out;
}
