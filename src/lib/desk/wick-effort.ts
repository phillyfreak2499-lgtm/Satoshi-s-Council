/**
 * FORMALIZED WICK: "no demand / no supply" and absorption, as one frozen
 * effort-versus-result predicate (pure). Research queue item F.
 *
 * The WICK seat reads candle SHAPES (pins, hammers, engulfs, AMD, sweeps).
 * This asks a different question, the classic volume-spread one: did the
 * EFFORT (volume) behind the last bar buy a matching RESULT (range and
 * progress, in ATR units), and did the next bar follow through?
 *
 *   NO_DEMAND          an up bar on low effort and a narrow range, after a
 *                      run up, and the next bar makes no new high  → DOWN
 *   NO_SUPPLY          the mirror after a run down                 → UP
 *   ABSORPTION_TOP     heavy effort, a wide range but a small body with a
 *                      long upper wick, after a run up, and the next close
 *                      is no higher                                → DOWN
 *   ABSORPTION_BOTTOM  the mirror                                  → UP
 *   NONE               anything else (silent)
 *
 * Every threshold is frozen in EFFORT_RESULT before any shadow row exists;
 * changing one means a new id. It runs in SHADOW beside the unchanged WICK:
 * it never feeds the seat, the Chair, a gate or booking. It is scored only
 * against settlement, WICK's own output and the same-time market price, and
 * retired if it adds no information.
 */
import { takerFeeCents } from "./clock.ts";
import { DEPTH_CLOCKS } from "./book-depth.ts";
import { fillStats, round, wilson, type Fill } from "./research-factory.ts";
import { marginalValue, type SignalObs } from "./research-factory-insight.ts";
import type { Candle } from "./types.ts";

export const WICK_SHADOW_CLOCKS = DEPTH_CLOCKS;
const MINUTE = 60_000;

/** The predicate, frozen. */
export const EFFORT_RESULT = Object.freeze({
  id: "WICK_EFFORT_RESULT_V1",
  version: 1,
  bars: "closed 1m spot candles whose close (t + 60 s) is at or before the frame's as_of; S = the second-to-last, F = the last",
  atr_bars: 14,
  volume_base_bars: 30,
  run_bars: 5,
  /** Oldest usable bar: the volume baseline needs 30 bars before S, plus S and F. */
  min_bars: 32,
  /** The last usable bar may end at most this long before as_of. */
  max_bar_age_ms: 90_000,
  low_effort: Object.freeze({ max_rel_vol: 0.7, max_spread_atr: 0.8, min_run_atr: 1.0 }),
  absorption: Object.freeze({ min_rel_vol: 1.8, min_spread_atr: 1.2, min_wick_frac: 0.5, max_body_frac: 0.35, min_run_atr: 1.0 }),
});

export type EffortLabel = "NONE" | "NO_DEMAND" | "NO_SUPPLY" | "ABSORPTION_TOP" | "ABSORPTION_BOTTOM";
export type EffortFeatures = {
  atr: number; vol_base: number; rel_vol: number; spread_atr: number; body_frac: number; upper_wick_frac: number; lower_wick_frac: number;
  close_pos: number; bar_dir: -1 | 0 | 1; run_atr: number; next_new_high: boolean; next_new_low: boolean; next_close_vs_signal: -1 | 0 | 1;
  signal_bar_t: number; next_bar_t: number; source: string;
};
export type EffortRead = { label: EffortLabel; stance: "UP" | "DOWN" | null; features: EffortFeatures | null; quality: { clean: boolean; flags: string[] } };

const sign = (x: number): -1 | 0 | 1 => (x > 0 ? 1 : x < 0 ? -1 : 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

/** Evaluate the frozen predicate on the candles a frame published. Never mutates its input. */
export function effortResult(candles: readonly Candle[], asOf: number): EffortRead {
  const flags: string[] = [];
  const bars = candles.filter((c) => c.closed && Number.isFinite(c.t) && c.t + MINUTE <= asOf).slice().sort((a, b) => a.t - b.t);
  const none = (f: string[]): EffortRead => ({ label: "NONE", stance: null, features: null, quality: { clean: false, flags: f } });
  if (bars.length < EFFORT_RESULT.min_bars) return none(["INSUFFICIENT_BARS"]);
  const span = bars.slice(-EFFORT_RESULT.min_bars);
  for (let i = 1; i < span.length; i += 1) if (span[i]!.t - span[i - 1]!.t !== MINUTE) { flags.push("GAPPED_BARS"); break; }
  if (new Set(span.map((c) => c.source)).size > 1) flags.push("MIXED_SOURCE");
  const F = span[span.length - 1]!, S = span[span.length - 2]!, before = span.slice(0, -2);
  if (asOf - (F.t + MINUTE) > EFFORT_RESULT.max_bar_age_ms) flags.push("BARS_STALE");
  const atrBars = before.slice(-EFFORT_RESULT.atr_bars);
  const trs = atrBars.map((c, i) => {
    const prevClose = i > 0 ? atrBars[i - 1]!.close : before[before.length - EFFORT_RESULT.atr_bars - 1]?.close ?? c.open;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  const volBase = median(before.slice(-EFFORT_RESULT.volume_base_bars).map((c) => c.volume));
  if (!(atr > 0)) flags.push("ZERO_ATR");
  if (!(volBase > 0)) flags.push("ZERO_VOLUME_BASE");
  if (flags.includes("ZERO_ATR") || flags.includes("ZERO_VOLUME_BASE")) return none(flags);
  const range = S.high - S.low;
  const runFrom = before[before.length - EFFORT_RESULT.run_bars]!, runTo = before[before.length - 1]!;
  const features: EffortFeatures = {
    atr: round(atr, 4)!, vol_base: round(volBase, 2)!, rel_vol: round(S.volume / volBase, 4)!, spread_atr: round(range / atr, 4)!,
    body_frac: range > 0 ? round(Math.abs(S.close - S.open) / range, 4)! : 0,
    upper_wick_frac: range > 0 ? round((S.high - Math.max(S.open, S.close)) / range, 4)! : 0,
    lower_wick_frac: range > 0 ? round((Math.min(S.open, S.close) - S.low) / range, 4)! : 0,
    close_pos: range > 0 ? round((S.close - S.low) / range, 4)! : 0.5,
    bar_dir: sign(S.close - S.open), run_atr: round((runTo.close - runFrom.open) / atr, 4)!,
    next_new_high: F.high > S.high, next_new_low: F.low < S.low, next_close_vs_signal: sign(F.close - S.close),
    signal_bar_t: S.t, next_bar_t: F.t, source: F.source,
  };
  const lo = EFFORT_RESULT.low_effort, ab = EFFORT_RESULT.absorption;
  let label: EffortLabel = "NONE";
  if (features.rel_vol >= ab.min_rel_vol && features.spread_atr >= ab.min_spread_atr && features.body_frac <= ab.max_body_frac) {
    if (features.upper_wick_frac >= ab.min_wick_frac && features.run_atr >= ab.min_run_atr && features.next_close_vs_signal <= 0) label = "ABSORPTION_TOP";
    else if (features.lower_wick_frac >= ab.min_wick_frac && features.run_atr <= -ab.min_run_atr && features.next_close_vs_signal >= 0) label = "ABSORPTION_BOTTOM";
  }
  if (label === "NONE" && features.rel_vol <= lo.max_rel_vol && features.spread_atr <= lo.max_spread_atr) {
    if (features.bar_dir === 1 && features.run_atr >= lo.min_run_atr && !features.next_new_high) label = "NO_DEMAND";
    else if (features.bar_dir === -1 && features.run_atr <= -lo.min_run_atr && !features.next_new_low) label = "NO_SUPPLY";
  }
  const stance = label === "NO_DEMAND" || label === "ABSORPTION_TOP" ? "DOWN" : label === "NO_SUPPLY" || label === "ABSORPTION_BOTTOM" ? "UP" : null;
  return { label, stance, features, quality: { clean: flags.length === 0, flags } };
}

// ---------------------------------------------------------------------------
// Reports: collection quality first, then the gated H0 and the WICK comparison.
// ---------------------------------------------------------------------------

export type WickSeatRead = { lean: string; status: string; conf: number | null; folded: boolean } | null;
export type ShadowMarket = { yes_bid: number | null; yes_ask: number | null; no_bid: number | null; no_ask: number | null; yes_mid: number | null; quote_age_ms: number | null };
export type ShadowRow = {
  ticker: string; close_ms: number; clock: number; clean: boolean; flags: string[]; label: EffortLabel; stance: "UP" | "DOWN" | null;
  wick: WickSeatRead; market: ShadowMarket; winner: "UP" | "DOWN" | null;
};

export const WICK_SHADOW_H0 = Object.freeze({
  id: "WICK_EFFORT_RESULT_H0_V1",
  hypothesis_kind: "PRESPECIFIED" as const,
  statement: "The frozen effort-versus-result predicate provides no incremental predictive value for the official KXBTC15M settlement beyond the same-time market price.",
  primary_clock: 180,
  /** Clean settled rows required at the primary clock, and fires among them, before the test runs. */
  min_clean_observations: 300,
  min_fires: 30,
  max_quote_age_ms: 10_000,
  entry: Object.freeze({ min_ask: 80, max_ask_exclusive: 99 }),
  retire_if: "walk-forward incremental log loss <= 0 at the minimum sample: the predicate restates price",
});

const wickSide = (w: WickSeatRead): "UP" | "DOWN" | null => (w && !w.folded && (w.lean === "UP" || w.lean === "DOWN") ? w.lean : null);

export function wickShadowQuality(rows: readonly ShadowRow[], settledWindows: number) {
  return {
    population: "shadow evaluations at fixed clocks of windows settled since the first row",
    def: EFFORT_RESULT.id,
    settled_windows_in_period: settledWindows,
    by_clock: WICK_SHADOW_CLOCKS.map((clock) => {
      const rs = rows.filter((r) => r.clock === clock);
      const clean = rs.filter((r) => r.clean);
      const flags = new Map<string, number>();
      for (const r of rs) for (const f of r.flags) flags.set(f, (flags.get(f) ?? 0) + 1);
      const labels = new Map<string, number>();
      for (const r of clean) labels.set(r.label, (labels.get(r.label) ?? 0) + 1);
      return {
        clock, rows: rs.length, coverage_pct: settledWindows > 0 ? round((rs.length / settledWindows) * 100) : null,
        clean: clean.length, clean_pct: rs.length ? round((clean.length / rs.length) * 100) : null,
        flags: [...flags.entries()].sort((a, b) => b[1] - a[1]).map(([flag, n]) => ({ flag, n })),
        fire_rate_pct: clean.length ? round((clean.filter((r) => r.stance).length / clean.length) * 100) : null,
        labels: [...labels.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })),
        wick_directional_pct: clean.length ? round((clean.filter((r) => wickSide(r.wick)).length / clean.length) * 100) : null,
      };
    }),
  };
}

/** Descriptive: how the predicate relates to WICK's own same-instant output, graded at settlement. */
function versusWick(rows: readonly ShadowRow[]) {
  const acc = (rs: readonly ShadowRow[], side: (r: ShadowRow) => "UP" | "DOWN" | null) => {
    const w = rs.filter((r) => side(r) === r.winner).length;
    return { n: rs.length, right: w, right_pct: rs.length ? round((w / rs.length) * 100) : null, ci95: wilson(w, rs.length) };
  };
  const both = rows.filter((r) => r.stance && wickSide(r.wick));
  const agree = both.filter((r) => r.stance === wickSide(r.wick));
  const disagree = both.filter((r) => r.stance !== wickSide(r.wick));
  return {
    hypothesis_kind: "EXPLORATORY" as const,
    note: "descriptive comparison with the live WICK seat; it never changes the H0 verdict",
    both_speak: both.length,
    agree: acc(agree, (r) => r.stance),
    disagree: { n: disagree.length, predicate: acc(disagree, (r) => r.stance), wick: acc(disagree, (r) => wickSide(r.wick)) },
    predicate_only: acc(rows.filter((r) => r.stance && !wickSide(r.wick)), (r) => r.stance),
    wick_only: acc(rows.filter((r) => !r.stance && wickSide(r.wick)), (r) => wickSide(r.wick)),
  };
}

export function wickShadowH0(rows: readonly ShadowRow[]) {
  const clean = rows.filter((r) => r.clock === WICK_SHADOW_H0.primary_clock && r.clean && r.winner && r.market.yes_mid != null
    && r.market.quote_age_ms != null && r.market.quote_age_ms <= WICK_SHADOW_H0.max_quote_age_ms);
  const fires = clean.filter((r) => r.stance).length;
  const base = { h0: WICK_SHADOW_H0, def: EFFORT_RESULT.id, clean_observations: clean.length, fires, versus_wick: versusWick(clean) };
  if (clean.length < WICK_SHADOW_H0.min_clean_observations || fires < WICK_SHADOW_H0.min_fires) {
    return { ...base, verdict: "INSUFFICIENT_SAMPLE" as const, note: `the test runs at ${WICK_SHADOW_H0.min_clean_observations} clean settled rows at T-${WICK_SHADOW_H0.primary_clock}s with at least ${WICK_SHADOW_H0.min_fires} fires; collection quality comes first` };
  }
  const obs: SignalObs[] = [];
  const control: Fill[] = [], rule: Fill[] = [];
  for (const r of clean) {
    const yes = r.market.yes_mid! / 100;
    const fav: "UP" | "DOWN" = yes >= 0.5 ? "UP" : "DOWN";
    obs.push({ window: `${r.ticker}|${r.close_ms}`, close_ms: r.close_ms, fav_prob: Math.max(yes, 1 - yes), stance: r.stance == null ? "SILENT" : r.stance === fav ? "AGREE" : "OPPOSE", fav_won: r.winner === fav ? 1 : 0 });
    const ask = fav === "UP" ? r.market.yes_ask : r.market.no_ask ?? (r.market.yes_bid != null ? round(100 - r.market.yes_bid, 1) : null);
    if (ask != null && ask >= WICK_SHADOW_H0.entry.min_ask && ask < WICK_SHADOW_H0.entry.max_ask_exclusive) {
      const f: Fill = { side: fav, ask_cents: ask, fee_cents: takerFeeCents(ask), winner: r.winner, close_ms: r.close_ms };
      control.push(f);
      if (r.stance === fav) rule.push(f);
    }
  }
  const mv = marginalValue(obs);
  const inc = mv.incremental_value.incremental_log_loss;
  return {
    ...base,
    verdict: inc == null ? "INSUFFICIENT_SAMPLE" as const : inc <= 0 ? "RETIRE_CANDIDATE" as const : "INFORMATIVE_CANDIDATE" as const,
    marginal_value: mv,
    economics: { rule: "hypothetical: buy the favourite at its ask (80-99c) at T-3:00 when the predicate leans its way; taker fee applied", predicate_rule: fillStats(rule), same_time_price_control: fillStats(control) },
    note: "INFORMATIVE_CANDIDATE only earns a frozen prospective shadow test; RETIRE_CANDIDATE means the predicate restates price. Neither changes WICK or production.",
  };
}
