/**
 * MARKET_BASELINE: blind price-rule strategies over a recorded quote path.
 *
 * WHAT THIS IS. A way to ask "what does the market itself pay a rule that
 * buys at a price, with no Council, no model and no gate?" It is the
 * benchmark the Chair's selection has to beat on the same windows. Every
 * result carries `kind: "MARKET_BASELINE"` and the label is a type, not a
 * string, so a report cannot present one of these as a Chair backtest.
 *
 * WHAT THIS IS NOT. It is not evidence about the Chair. A blind 80¢ rule
 * losing out of sample does not make the selective 80¢ trial negative, and
 * a blind rule winning does not make the Chair's fills skill.
 *
 * Pure module: quote paths in, numbers out. Fees from the one fee engine.
 */
import { DEFAULT_FEE_ENGINE, feeCents, holdNetCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";

export const MARKET_BASELINE = "MARKET_BASELINE" as const;
export type BaselineKind = typeof MARKET_BASELINE;

/** One tick of a window's book: seconds to close, YES ask, YES bid. NO ask = 100 − YES bid. */
export type QuoteTick = { secs_left: number; yes_ask: number; yes_bid: number };

export type QuotePath = {
  ticker: string;
  close_ms: number;
  winner: "UP" | "DOWN";
  /** Chronological (secs_left descending). */
  ticks: readonly QuoteTick[];
  /** The path's price precision, so a report can say what it measured. */
  precision: "whole_cent" | "deci_cent" | "unknown";
};

export type BaselineFill = { ticker: string; close_ms: number; side: "UP" | "DOWN"; ask: number; secs_left: number; won: boolean; net: number };

export type BaselineSummary = {
  kind: BaselineKind;
  rule: string;
  windows: number;
  fills: number;
  avg_ask: number | null;
  avg_fee: number | null;
  wr_pct: number | null;
  needed_wr_pct: number | null;
  net_cents: number;
  net_per_fill: number | null;
  net_per_100_windows: number | null;
  max_drawdown: number;
  fee_engine: FeeEngineId;
};

export function noAskOf(t: QuoteTick): number {
  return 100 - t.yes_bid;
}

/**
 * First touch: the first tick inside [lo, hi] seconds-left at which either
 * side's ask is in [floor, cap). YES is checked first, then NO. Null when no
 * tick qualifies. One fill per window by construction.
 */
export function firstTouch(path: QuotePath, floor: number, lo: number, hi: number, cap = 99): { side: "UP" | "DOWN"; ask: number; secs_left: number } | null {
  for (const t of path.ticks) {
    if (t.secs_left < lo || t.secs_left > hi) continue;
    if (!Number.isFinite(t.yes_ask) || !Number.isFinite(t.yes_bid)) continue;
    if (t.yes_ask >= floor && t.yes_ask < cap) return { side: "UP", ask: t.yes_ask, secs_left: t.secs_left };
    const na = noAskOf(t);
    if (na >= floor && na < cap) return { side: "DOWN", ask: na, secs_left: t.secs_left };
  }
  return null;
}

/** The cheap-side first touch: either side's ask in [lo_cents, hi_cents) inside the time band. */
export function cheapFirstTouch(path: QuotePath, loCents: number, hiCents: number, loSecs: number, hiSecs: number): { side: "UP" | "DOWN"; ask: number; secs_left: number; index: number } | null {
  for (let i = 0; i < path.ticks.length; i += 1) {
    const t = path.ticks[i]!;
    if (t.secs_left < loSecs || t.secs_left > hiSecs) continue;
    if (t.yes_ask >= loCents && t.yes_ask < hiCents) return { side: "UP", ask: t.yes_ask, secs_left: t.secs_left, index: i };
    const na = noAskOf(t);
    if (na >= loCents && na < hiCents) return { side: "DOWN", ask: na, secs_left: t.secs_left, index: i };
  }
  return null;
}

export function summarize(rule: string, fills: readonly BaselineFill[], windows: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): BaselineSummary {
  const n = fills.length;
  const wins = fills.filter((f) => f.won).length;
  const net = fills.reduce((s, f) => s + f.net, 0);
  let cum = 0, peak = 0, dd = 0;
  for (const f of fills) { cum += f.net; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const asks = fills.map((f) => f.ask);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    kind: MARKET_BASELINE, rule, windows, fills: n,
    avg_ask: n ? r2(asks.reduce((s, a) => s + a, 0) / n) : null,
    avg_fee: n ? r2(asks.reduce((s, a) => s + feeCents(a, engine), 0) / n) : null,
    wr_pct: n ? Math.round((1000 * wins) / n) / 10 : null,
    needed_wr_pct: n ? r2(asks.reduce((s, a) => s + a + feeCents(a, engine), 0) / n) : null,
    net_cents: Math.round(net * 10) / 10,
    net_per_fill: n ? r2(net / n) : null,
    net_per_100_windows: windows ? Math.round((1000 * net) / windows) / 10 : null,
    max_drawdown: Math.round(dd * 10) / 10,
    fee_engine: engine,
  };
}

/** Blind floor rule over many windows. */
export function blindFloor(paths: readonly QuotePath[], floor: number, loSecs: number, hiSecs: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): BaselineSummary {
  const fills: BaselineFill[] = [];
  for (const p of paths) {
    const ft = firstTouch(p, floor, loSecs, hiSecs);
    if (!ft || !realAskCents(ft.ask)) continue;
    const won = ft.side === p.winner;
    fills.push({ ticker: p.ticker, close_ms: p.close_ms, side: ft.side, ask: ft.ask, secs_left: ft.secs_left, won, net: holdNetCents(ft.ask, won, engine) });
  }
  return summarize(`blind_first_touch_floor_${floor}_${loSecs}-${hiSecs}s`, fills, paths.length, engine);
}

/** The ≥ `jump` cents one-minute ask-jump chase: buy the side whose ask rose by ≥ jump over the last 60 s; first per window. */
export function jumpChase(paths: readonly QuotePath[], jump = 2, loSecs = 60, hiSecs = 840, engine: FeeEngineId = DEFAULT_FEE_ENGINE): BaselineSummary {
  const fills: BaselineFill[] = [];
  for (const p of paths) {
    let hit: { side: "UP" | "DOWN"; ask: number; secs_left: number } | null = null;
    for (let i = 0; i < p.ticks.length && !hit; i += 1) {
      const t = p.ticks[i]!;
      if (t.secs_left < loSecs || t.secs_left > hiSecs) continue;
      const past = p.ticks.slice(0, i).filter((x) => x.secs_left - t.secs_left > 0 && x.secs_left - t.secs_left <= 60);
      if (!past.length) continue;
      const a0 = past[0]!;
      if (t.yes_ask - a0.yes_ask >= jump && t.yes_ask < 99) hit = { side: "UP", ask: t.yes_ask, secs_left: t.secs_left };
      else if (noAskOf(t) - noAskOf(a0) >= jump && noAskOf(t) < 99) hit = { side: "DOWN", ask: noAskOf(t), secs_left: t.secs_left };
    }
    if (!hit) continue;
    const won = hit.side === p.winner;
    fills.push({ ticker: p.ticker, close_ms: p.close_ms, side: hit.side, ask: hit.ask, secs_left: hit.secs_left, won, net: holdNetCents(hit.ask, won, engine) });
  }
  return summarize(`jump_chase_${jump}c_60s`, fills, paths.length, engine);
}

export type HorizonStat = { secs: number; n: number; brier_market: number; chalk_pct: number; dir_acc_pct: number };

/** Market Brier (YES mid / 100 vs outcome) and chalk share at fixed seconds-to-close. */
export function brierByHorizon(paths: readonly QuotePath[], horizons: readonly number[] = [840, 600, 450, 300, 180, 60, 15], grace = 12): HorizonStat[] {
  return horizons.map((h) => {
    let n = 0, b = 0, chalk = 0, acc = 0;
    for (const p of paths) {
      const t = [...p.ticks].reverse().find((x) => x.secs_left <= h && x.secs_left > h - grace);
      if (!t) continue;
      const mid = (t.yes_ask + t.yes_bid) / 200;
      const y = p.winner === "UP" ? 1 : 0;
      n += 1; b += (mid - y) ** 2; if (Math.max(t.yes_ask, noAskOf(t)) >= 99) chalk += 1; if ((mid >= 0.5) === (y === 1)) acc += 1;
    }
    return { secs: h, n, brier_market: n ? Math.round((b / n) * 10_000) / 10_000 : NaN, chalk_pct: n ? Math.round((1000 * chalk) / n) / 10 : NaN, dir_acc_pct: n ? Math.round((1000 * acc) / n) / 10 : NaN };
  });
}

/** Raw WAIT rate vs WAIT rate excluding windows already ≥ 99¢ on a side at the checkpoint. Both are kept. */
export function chalkAdjustedWait(rows: readonly { chair_wait: boolean; max_ask: number }[]): { n: number; wait_raw_pct: number | null; non_chalk_n: number; wait_ex_chalk_pct: number | null; chalk_n: number } {
  const n = rows.length;
  const waits = rows.filter((r) => r.chair_wait).length;
  const nonChalk = rows.filter((r) => r.max_ask < 99);
  const waitsNonChalk = nonChalk.filter((r) => r.chair_wait).length;
  return {
    n, wait_raw_pct: n ? Math.round((1000 * waits) / n) / 10 : null,
    non_chalk_n: nonChalk.length, wait_ex_chalk_pct: nonChalk.length ? Math.round((1000 * waitsNonChalk) / nonChalk.length) / 10 : null,
    chalk_n: n - nonChalk.length,
  };
}

/** Compile-time guard: a MARKET_BASELINE summary can never be typed as a Chair result. */
export function assertBaseline(s: BaselineSummary): asserts s is BaselineSummary & { kind: BaselineKind } {
  if (s.kind !== MARKET_BASELINE) throw new Error("not a MARKET_BASELINE summary");
}
