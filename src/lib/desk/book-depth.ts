/**
 * KXBTC15M ORDER-BOOK DEPTH — instrument first, no decision use (pure).
 *
 * Kalshi books are resting BIDS on both sides. A NO bid at q is an offer to
 * sell YES at 100 − q, so everything here is measured on one YES price axis
 * (lab-book.ts `yesView`):
 *   YES bid depth  = the YES bids;          NO ask depth = the same orders.
 *   YES ask depth  = the NO bids, mirrored; NO bid depth = the same orders.
 *
 * Displayed size is NOT executable truth: it can be cancelled before any
 * order reaches it. These are research observations of resting interest, and
 * every snapshot carries quality flags so an untrusted book is never read as
 * evidence. Nothing here feeds the Chair, a seat, a gate or booking.
 *
 * The first deliverable is COLLECTION QUALITY. The H0 test runs only after
 * enough clean snapshots exist, and a depth signal that merely restates the
 * price is a retirement candidate, not a finding.
 */
import { takerFeeCents } from "./clock.ts";
import type { Level, YesView } from "./lab-book.ts";
import { fillStats, round, type Fill } from "./research-factory.ts";
import { marginalValue, type SignalObs } from "./research-factory-insight.ts";

/** Fixed snapshot clocks, seconds before the close (T-10, T-5, T-3, T-1 minutes). */
export const DEPTH_CLOCKS = [600, 300, 180, 60] as const;
export const DEPTH_CLOCK_GRACE_S = 12;
/** Levels kept per side in the stored snapshot. */
export const DEPTH_LEVELS = 10;
/** Near-touch window, cents from each side's own best price. */
export const NEAR_TOUCH_CENTS = 5;
/** The book's best prices may differ from the engine's quote by this much before the snapshot is flagged. */
export const QUOTE_TOLERANCE_CENTS = 1;
/** A book not updated for this long at snapshot time is flagged stale-by-age. */
export const MAX_BOOK_AGE_MS = 30_000;

export function depthClockAt(secsLeft: number): number | null {
  for (const c of DEPTH_CLOCKS) if (secsLeft <= c && secsLeft > c - DEPTH_CLOCK_GRACE_S) return c;
  return null;
}

/** What the collector reads: the Lab's rebuilt book (copied) and the engine's same-instant quote. */
export type BookRead = { ticker: string; view: YesView; ok: boolean; stale: boolean; gaps: number; flips: number; snap_t: number; upd_t: number; level_count: number; trusted: boolean };
export type EngineQuote = { ticker: string; as_of: number; close_time: number; yes_bid: number | null; yes_ask: number | null; no_bid: number | null; no_ask: number | null; yes_mid: number | null; quote_seq: number | null };

export type DepthQuality = {
  clean: boolean;
  flags: string[];
  book_age_ms: number | null;
  gaps_total: number | null;
  gaps_since_prev: number | null;
};

export type DepthFeatures = {
  best_yes_bid: number | null;
  best_yes_ask: number | null;
  spread_cents: number | null;
  mid: number | null;
  /** Sizes, YES space. NO-side names are the same orders seen from the other leg. */
  yes_bid_depth: number; yes_ask_depth: number; no_bid_depth: number; no_ask_depth: number;
  yes_bid_levels: number; yes_ask_levels: number;
  total_visible: number;
  near_touch_bid: number; near_touch_ask: number;
  /** (near-touch bid − ask) / (bid + ask), weight 1/(1 + cents from touch): +1 all resting YES buying, −1 all selling. */
  imbalance: number | null;
  /** Cumulative depth per cent away from the touch (least squares through the origin), within 10¢. */
  bid_slope: number | null; ask_slope: number | null;
  /** Versus the previous snapshot of the same window: size added and removed per side. Null without one. */
  bid_added: number | null; bid_removed: number | null; ask_added: number | null; ask_removed: number | null;
  /** The imbalance kept its sign since the previous snapshot. Null without one. */
  imbalance_persisted: boolean | null;
};

const sumSize = (ls: readonly Level[]) => ls.reduce((a, l) => a + l.size, 0);

function nearTouch(levels: readonly Level[], best: number | null): number {
  if (best == null) return 0;
  return levels.reduce((a, l) => { const d = Math.abs(l.price - best); return d <= NEAR_TOUCH_CENTS ? a + l.size / (1 + d) : a; }, 0);
}

function slope(levels: readonly Level[], best: number | null): number | null {
  if (best == null || !levels.length) return null;
  let cum = 0, sxy = 0, sxx = 0;
  for (const l of levels) {
    const d = Math.abs(l.price - best);
    if (d > 10) break;
    cum += l.size;
    // Distance 0 is the touch; shift by one cent so the touch level contributes.
    const x = d + 1;
    sxy += x * cum; sxx += x * x;
  }
  return sxx > 0 ? round(sxy / sxx, 3) : null;
}

function flow(now: readonly Level[], prev: readonly Level[] | null): { added: number | null; removed: number | null } {
  if (!prev) return { added: null, removed: null };
  const a = new Map(prev.map((l) => [l.price, l.size]));
  const b = new Map(now.map((l) => [l.price, l.size]));
  let added = 0, removed = 0;
  for (const p of new Set([...a.keys(), ...b.keys()])) {
    const d = (b.get(p) ?? 0) - (a.get(p) ?? 0);
    if (d > 0) added += d; else removed -= d;
  }
  return { added: round(added, 2), removed: round(removed, 2) };
}

export type DepthSnapshot = {
  ticker: string;
  close_ms: number;
  clock: number;
  as_of: number;
  secs_left: number;
  quality: DepthQuality;
  features: DepthFeatures | null;
  /** The stored top levels, YES space (bids descending, asks ascending). */
  levels: { bids: Level[]; asks: Level[] } | null;
  market: EngineQuote;
};

/**
 * One snapshot from a copied book and the engine's same-instant quote.
 * `prev` is the previous snapshot of the same window (for adds/removals and
 * persistence). Deterministic; mutates nothing.
 */
export function depthSnapshot(clock: number, quote: EngineQuote, book: BookRead | null, prev: DepthSnapshot | null): DepthSnapshot {
  const flags: string[] = [];
  const base = { ticker: quote.ticker, close_ms: quote.close_time, clock, as_of: quote.as_of, secs_left: (quote.close_time - quote.as_of) / 1000, market: { ...quote } };
  if (!book) {
    return { ...base, quality: { clean: false, flags: ["BOOK_MISSING"], book_age_ms: null, gaps_total: null, gaps_since_prev: null }, features: null, levels: null };
  }
  if (book.ticker !== quote.ticker) flags.push("TICKER_MISMATCH");
  if (!book.ok) flags.push("NO_SNAPSHOT_LOADED");
  if (book.stale) flags.push("SEQUENCE_GAP_STALE");
  const age = Number.isFinite(book.upd_t) && book.upd_t > 0 ? quote.as_of - book.upd_t : null;
  if (age == null || age > MAX_BOOK_AGE_MS) flags.push("BOOK_OLD");
  if (age != null && age < -5_000) flags.push("BOOK_FROM_FUTURE");
  const bids = book.view.bids, asks = book.view.asks;
  if (!bids.length) flags.push("EMPTY_BIDS");
  if (!asks.length) flags.push("EMPTY_ASKS");
  const bb = bids[0]?.price ?? null, ba = asks[0]?.price ?? null;
  if (bb != null && ba != null && bb >= ba) flags.push("CROSSED");
  if (bb != null && quote.yes_bid != null && Math.abs(bb - quote.yes_bid) > QUOTE_TOLERANCE_CENTS) flags.push("QUOTE_MISMATCH_BID");
  if (ba != null && quote.yes_ask != null && Math.abs(ba - quote.yes_ask) > QUOTE_TOLERANCE_CENTS) flags.push("QUOTE_MISMATCH_ASK");
  const gapsSince = prev?.quality.gaps_total != null ? book.gaps - prev.quality.gaps_total : null;
  if (gapsSince != null && gapsSince > 0) flags.push("GAPS_SINCE_PREV");

  const nb = nearTouch(bids, bb), na = nearTouch(asks, ba);
  const imbalance = nb + na > 0 ? round((nb - na) / (nb + na), 4) : null;
  const top = { bids: bids.slice(0, DEPTH_LEVELS).map((l) => ({ ...l })), asks: asks.slice(0, DEPTH_LEVELS).map((l) => ({ ...l })) };
  const fb = flow(top.bids, prev?.levels?.bids ?? null), fa = flow(top.asks, prev?.levels?.asks ?? null);
  const prevImb = prev?.features?.imbalance ?? null;
  const features: DepthFeatures = {
    best_yes_bid: bb, best_yes_ask: ba, spread_cents: bb != null && ba != null ? round(ba - bb, 1) : null, mid: bb != null && ba != null ? round((bb + ba) / 2, 2) : null,
    yes_bid_depth: round(sumSize(bids), 2)!, yes_ask_depth: round(sumSize(asks), 2)!, no_bid_depth: round(sumSize(asks), 2)!, no_ask_depth: round(sumSize(bids), 2)!,
    yes_bid_levels: bids.length, yes_ask_levels: asks.length, total_visible: round(sumSize(bids) + sumSize(asks), 2)!,
    near_touch_bid: round(nb, 2)!, near_touch_ask: round(na, 2)!, imbalance,
    bid_slope: slope(bids, bb), ask_slope: slope(asks, ba),
    bid_added: fb.added, bid_removed: fb.removed, ask_added: fa.added, ask_removed: fa.removed,
    imbalance_persisted: imbalance != null && prevImb != null && imbalance !== 0 && prevImb !== 0 ? Math.sign(imbalance) === Math.sign(prevImb) : null,
  };
  return { ...base, quality: { clean: flags.length === 0, flags, book_age_ms: age, gaps_total: book.gaps, gaps_since_prev: gapsSince }, features, levels: top };
}

// ---------------------------------------------------------------------------
// Reports: collection quality first, then the gated H0 test.
// ---------------------------------------------------------------------------

export type SettledDepth = DepthSnapshot & { winner: "UP" | "DOWN" | null };

export function collectionQuality(rows: readonly SettledDepth[], settledWindowsInPeriod: number) {
  return {
    population: "depth snapshots at fixed clocks of windows settled since the first snapshot",
    settled_windows_in_period: settledWindowsInPeriod,
    by_clock: DEPTH_CLOCKS.map((clock) => {
      const rs = rows.filter((r) => r.clock === clock);
      const flags = new Map<string, number>();
      for (const r of rs) for (const f of r.quality.flags) flags.set(f, (flags.get(f) ?? 0) + 1);
      const ages = rs.map((r) => r.quality.book_age_ms).filter((x): x is number => x != null).sort((a, b) => a - b);
      return {
        clock, snapshots: rs.length,
        coverage_pct: settledWindowsInPeriod > 0 ? round((rs.length / settledWindowsInPeriod) * 100) : null,
        clean: rs.filter((r) => r.quality.clean).length,
        clean_pct: rs.length ? round((rs.filter((r) => r.quality.clean).length / rs.length) * 100) : null,
        flags: [...flags.entries()].sort((a, b) => b[1] - a[1]).map(([flag, n]) => ({ flag, n })),
        median_book_age_ms: ages.length ? ages[Math.floor(ages.length / 2)]! : null,
        median_levels_per_side: (() => { const l = rs.filter((r) => r.features).map((r) => Math.min(r.features!.yes_bid_levels, r.features!.yes_ask_levels)).sort((a, b) => a - b); return l.length ? l[Math.floor(l.length / 2)]! : null; })(),
      };
    }),
  };
}

/** Pre-registered H0 parameters, frozen here before any clean observation exists. */
export const DEPTH_H0 = Object.freeze({
  id: "BOOK_DEPTH_H0_V1",
  hypothesis_kind: "PRESPECIFIED" as const,
  statement: "Resting depth imbalance provides no incremental predictive value for the official KXBTC15M settlement beyond the same-time market price.",
  primary_clock: 180,
  /** |imbalance| at or above this counts as the depth leaning to a side. */
  stance_threshold: 0.2,
  /** Clean settled snapshots required at the primary clock before the test runs. */
  min_clean_observations: 300,
  /** The hypothetical entry rule, for economics only: buy the favourite at the book's best ask when depth leans its way. */
  entry: { min_ask: 80, max_ask_exclusive: 99 },
  retire_if: "walk-forward incremental log loss <= 0 at the minimum sample: depth restates price",
});

export function depthH0(rows: readonly SettledDepth[]) {
  const clean = rows.filter((r) => r.clock === DEPTH_H0.primary_clock && r.quality.clean && r.features?.imbalance != null && r.market.yes_mid != null && r.winner);
  const base = { h0: DEPTH_H0, clean_observations: clean.length };
  if (clean.length < DEPTH_H0.min_clean_observations) {
    return { ...base, verdict: "INSUFFICIENT_SAMPLE" as const, note: `the test runs at ${DEPTH_H0.min_clean_observations} clean settled snapshots at T-${DEPTH_H0.primary_clock}s; collection quality comes first` };
  }
  const obs: SignalObs[] = [];
  const favFills: Fill[] = [], ruleFills: Fill[] = [];
  for (const r of clean) {
    const yes = r.market.yes_mid! / 100;
    const fav: "UP" | "DOWN" = yes >= 0.5 ? "UP" : "DOWN";
    const lean = r.features!.imbalance! >= DEPTH_H0.stance_threshold ? "UP" : r.features!.imbalance! <= -DEPTH_H0.stance_threshold ? "DOWN" : null;
    obs.push({ window: `${r.ticker}|${r.close_ms}`, close_ms: r.close_ms, fav_prob: Math.max(yes, 1 - yes), stance: lean == null ? "SILENT" : lean === fav ? "AGREE" : "OPPOSE", fav_won: r.winner === fav ? 1 : 0 });
    const ask = fav === "UP" ? r.features!.best_yes_ask : r.features!.best_yes_bid != null ? round(100 - r.features!.best_yes_bid, 1) : null;
    if (ask != null && ask >= DEPTH_H0.entry.min_ask && ask < DEPTH_H0.entry.max_ask_exclusive) {
      const f: Fill = { side: fav, ask_cents: ask, fee_cents: takerFeeCents(ask), winner: r.winner, close_ms: r.close_ms };
      favFills.push(f);
      if (lean === fav) ruleFills.push(f);
    }
  }
  const mv = marginalValue(obs);
  const inc = mv.incremental_value.incremental_log_loss;
  return {
    ...base, verdict: inc == null ? "INSUFFICIENT_SAMPLE" as const : inc <= 0 ? "RETIRE_CANDIDATE" as const : "INFORMATIVE_CANDIDATE" as const,
    marginal_value: mv,
    economics: {
      rule: "hypothetical: buy the favourite at the book's best ask (80-99c) at T-3:00 when depth leans its way; taker fee applied",
      depth_rule: fillStats(ruleFills),
      same_time_price_control: fillStats(favFills),
    },
    note: "INFORMATIVE_CANDIDATE only earns a frozen prospective shadow test; RETIRE_CANDIDATE means depth restates price. Neither changes production.",
  };
}
