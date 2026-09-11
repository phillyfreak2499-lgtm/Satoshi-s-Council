/**
 * The replay buffer's identity: one buffered series per WINDOW.
 *
 * WHY THIS IS ITS OWN MODULE. A ticker is not a window. `desk_ledger` is unique on
 * (ticker, close_time), and on 2026-09-10 nine consecutive closes carried one
 * ticker because the feed stopped advancing it. The buffer was keyed by ticker
 * alone, so during that episode a later window's samples were appended to the
 * FIRST window's series — stored under the first window's `close_time`, with `t`
 * offsets measured from the first window's `t0`. The resulting row would be partly
 * a different window, and the `partial` flag could not see it: that flag tests
 * where a series STARTS, and the start was legitimate.
 *
 * A dropped window is detectable as absence. A blended one is not. So identity is
 * both halves, here, in one place, with tests — rather than spelled out at each of
 * the four call sites that touch the map.
 *
 * EXACT LOOKUP ONLY. Nothing here scans for the likeliest series, picks the newest
 * close for a ticker, infers a close, or falls back to a ticker match. A wrong
 * window is worse than no window. `close_time` is fixed when a series is opened and
 * is never rewritten, so a series cannot drift onto another window afterwards.
 *
 * Pure module: no clock of its own (every "now" is passed in), no database, no
 * imports, and it decides nothing about the desk.
 */

/** Samples are at least this far apart; the brain ticks every 2.5–4 s. */
export const REPLAY_STEP_MS = 4_000;
/** Hard cap on samples held for one window. */
export const MAX_SAMPLES = 320;
/** A series whose close is this far past is forgotten when a new window opens. */
export const STALE_MS = 3_600_000;

/**
 * The key a series is stored under.
 *
 * `close_time` is always digits, so the only way to collide would be a ticker
 * ending in `|` followed by digits. Kalshi's are `KXBTC15M-…`; a test pins that
 * two different windows never produce one key.
 */
export function seriesKey(ticker: string, closeMs: number): string {
  return `${ticker}|${closeMs}`;
}

/** A buffered series. `C` is whatever column shape the caller keeps. */
export type WindowSeries<C> = {
  ticker: string;
  close_time: number;
  strike: number;
  cols: C;
};

/** Where a sample lands: its series, and its offset in seconds from that series' own t0. */
export type Slot<C> = { series: WindowSeries<C>; offset: number };

/**
 * A store of buffered series, addressed by window.
 *
 * Every method takes BOTH halves of the identity. There is deliberately no method
 * that takes a ticker alone.
 */
export class WindowStore<C> {
  private map = new Map<string, WindowSeries<C>>();

  /** The series for exactly this window, or null. A wrong close is null, never a neighbour. */
  get(ticker: string, closeMs: number): WindowSeries<C> | null {
    return this.map.get(seriesKey(ticker, closeMs)) ?? null;
  }

  set(ticker: string, closeMs: number, s: WindowSeries<C>): void {
    this.map.set(seriesKey(ticker, closeMs), s);
  }

  /**
   * Remove and return exactly this window's series, or null.
   *
   * One operation rather than get-then-delete, so a caller cannot read one window
   * and delete another. Another close sharing the ticker is untouched.
   */
  take(ticker: string, closeMs: number): WindowSeries<C> | null {
    const k = seriesKey(ticker, closeMs);
    const s = this.map.get(k);
    if (!s) return null;
    this.map.delete(k);
    return s;
  }

  /** Forget series whose close is more than `maxAgeMs` before `nowMs`. Returns how many. */
  pruneStale(nowMs: number, maxAgeMs: number = STALE_MS): number {
    let n = 0;
    for (const [k, v] of this.map) {
      if (nowMs - v.close_time > maxAgeMs) {
        this.map.delete(k);
        n += 1;
      }
    }
    return n;
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Where the next sample for a window goes, opening the series if this is its first.
 *
 * Returns null when the sample should be skipped: too soon after the last one, or
 * the window is already at its cap. A cap reached by ONE window cannot stop another
 * window collecting its own samples, because they are different series.
 *
 * `makeCols(t0)` builds the empty column set, so this module needs to know nothing
 * about what is being recorded.
 */
export function openSlot<C extends { t0: number; t: number[] }>(
  store: WindowStore<C>,
  ticker: string,
  closeMs: number,
  asOfMs: number,
  strike: number,
  makeCols: (t0: number) => C,
  opts: { stepMs?: number; maxSamples?: number; staleMs?: number } = {},
): Slot<C> | null {
  const stepMs = opts.stepMs ?? REPLAY_STEP_MS;
  const maxSamples = opts.maxSamples ?? MAX_SAMPLES;
  let s = store.get(ticker, closeMs);
  if (!s) {
    // A new window is the moment to forget old ones. Under ticker-only keying a
    // frozen ticker never reached this branch, so nothing was ever pruned during
    // the one episode where the map could grow wrong.
    store.pruneStale(asOfMs, opts.staleMs ?? STALE_MS);
    s = { ticker, close_time: closeMs, strike: strike > 0 ? strike : 0, cols: makeCols(asOfMs) };
    store.set(ticker, closeMs, s);
  }
  const c = s.cols;
  // Measured from THIS series' own t0 — never from another window's clock.
  const offset = (asOfMs - c.t0) / 1000;
  const lastT = c.t.length ? c.t[c.t.length - 1]! : null;
  if (lastT != null && offset - lastT < stepMs / 1000 - 0.25) return null;
  if (c.t.length >= maxSamples) return null;
  if (!(s.strike > 0) && strike > 0) s.strike = strike;
  return { series: s, offset: Math.round(offset * 10) / 10 };
}
