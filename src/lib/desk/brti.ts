/**
 * CF Benchmarks BRTI — the index Kalshi's 15-minute BTC market settles on —
 * and a settlement model built on the rule itself, confirmed from Kalshi's
 * market rules: the window resolves YES when the simple average of the 60
 * one-per-second BRTI prints in the final minute before the close (the
 * ticks at :01 … :00, close tick included) is at least the same average
 * from the previous window (Kalshi's floor_strike), rounded to 2 decimals.
 *
 * Two feeds arrive: the per-second channel (the official prints, plus
 * Kalshi's own trailing-60s and final-minute accumulating averages) and the
 * 5 Hz channel (raw 200 ms ticks, no averages). Prints and volatility come
 * from the per-second channel; the 5 Hz ticks only refresh the latest value.
 *
 * Model. Let x be the latest value, σ₁ the per-second $ volatility, k the
 * final-minute prints already known (sum S — taken from Kalshi's own
 * accumulating average when it is streaming), m = 60 − k the prints still
 * to come, and `pre` the seconds until the final minute starts:
 *   E[avg]   = (S + m·x) / 60
 *   Var[avg] = σ₁² · (m(m+1)(2m+1)/6 + m²·pre) / 60²
 * The unknown prints are a random walk from x. Late in the minute the
 * locked prints dominate and the uncertainty collapses — arithmetic a book
 * still pricing "the last tick decides" can miss. Pure module.
 */
import { clamp } from "./math";
import { normCdf } from "./clock";

export const SETTLE_WINDOW_S = 60;
export const QUARTER_MS = 15 * 60_000;
/** Residual noise (bps of the index) once every print is known: rounding, our
 *  sampling vs Kalshi's. Tiny on purpose; the receipts measure the truth. */
export const SETTLE_SAMPLING_BPS = 0.02;
const PRINTS_MAX = 720;
const SETTLE_KEEP_MS = 40 * 60_000;

export type BrtiPrint = { s: number; v: number; t: number };
export type SettleFeed = { value: number; n: number; t: number; src_t: number };

export type BrtiState = {
  last: number;
  last_t: number;
  last_src_t: number;
  n: number;
  n_prints: number;
  prints: BrtiPrint[];
  var1: number;
  var_n: number;
  /** Slow (≈15 min) EWMA of the same per-second variance: a lull must not
   *  convince the model the tape is dead. */
  var_slow: number;
  avg60_feed: number | null;
  /** Kalshi's accumulating final-minute average, by quarter-close ms. */
  settle: Map<number, SettleFeed>;
  settle_live: (SettleFeed & { close: number }) | null;
  /** EWMA lags in ms: vendor publish → us, vendor publish → Kalshi. */
  lag_us: number | null;
  lag_kalshi: number | null;
};

export function freshBrti(): BrtiState {
  return {
    last: 0,
    last_t: 0,
    last_src_t: 0,
    n: 0,
    n_prints: 0,
    prints: [],
    var1: 0,
    var_n: 0,
    var_slow: 0,
    avg60_feed: null,
    settle: new Map(),
    settle_live: null,
    lag_us: null,
    lag_kalshi: null,
  };
}

function ewma(prev: number | null, x: number, a = 0.05): number {
  return prev == null ? x : (1 - a) * prev + a * x;
}

/** Feed a tick. `isPrint` marks the per-second channel (the official prints). */
export function pushBrti(
  st: BrtiState,
  v: number,
  t: number,
  src_t = 0,
  isPrint = true,
  kalshi_t = 0,
): void {
  if (!(v > 0) || !Number.isFinite(v)) return;
  st.n += 1;
  st.last = v;
  st.last_t = t;
  st.last_src_t = src_t;
  if (src_t > 0) {
    st.lag_us = ewma(st.lag_us, t - src_t);
    if (kalshi_t > 0) st.lag_kalshi = ewma(st.lag_kalshi, kalshi_t - src_t);
  }
  if (!isPrint) return;
  st.n_prints += 1;
  const s = Math.floor((src_t > 0 ? src_t : t) / 1000);
  const arr = st.prints;
  const tail = arr[arr.length - 1];
  if (tail && tail.s === s) {
    tail.v = v;
    tail.t = t;
    return;
  }
  if (tail && s < tail.s) return;
  if (tail) {
    const dt = Math.max(1, s - tail.s);
    const d = v - tail.v;
    const perSec = (d * d) / dt;
    const a = 1 / 60;
    const b = 1 / 900;
    st.var1 = st.var_n === 0 ? perSec : (1 - a) * st.var1 + a * perSec;
    st.var_slow = st.var_n === 0 ? perSec : (1 - b) * st.var_slow + b * perSec;
    st.var_n += 1;
  }
  arr.push({ s, v, t });
  if (arr.length > PRINTS_MAX) arr.splice(0, arr.length - PRINTS_MAX);
}

/** The quarter-hour close a tick belongs to: the boundary at or after it. */
export function quarterClose(ms: number): number {
  return Math.ceil(ms / QUARTER_MS) * QUARTER_MS;
}

/** Kalshi's own accumulating final-minute average arrived with a tick. */
export function noteSettleFeed(st: BrtiState, value: number, n: number, tickMs: number, t: number): void {
  if (!(value > 0) || !(n > 0) || !(tickMs > 0)) return;
  const close = quarterClose(tickMs);
  const rec = { value, n, t, src_t: tickMs };
  const prev = st.settle.get(close);
  if (!prev || n >= prev.n) st.settle.set(close, rec);
  st.settle_live = { ...rec, close };
  for (const k of st.settle) if (k[0] < t - SETTLE_KEEP_MS) st.settle.delete(k[0]);
}

/** Per-second $ volatility: the larger of the fast and slow estimates from
 *  the prints, never below half the ATR-based `fallback`; the fallback alone
 *  until the prints have warmed. */
export function sigma1(st: BrtiState, fallback: number): number {
  const floor = Math.max(fallback, 0) * 0.5;
  if (st.var_n >= 30 && st.var1 > 0) return Math.max(Math.sqrt(Math.max(st.var1, st.var_slow)), floor);
  return Math.max(fallback, 0);
}

export function trailingAvg(st: BrtiState, nowMs: number, secs = SETTLE_WINDOW_S): { avg: number; n: number } {
  const nowS = Math.floor(nowMs / 1000);
  let sum = 0;
  let n = 0;
  for (const p of st.prints) {
    if (p.s > nowS - secs && p.s <= nowS) {
      sum += p.v;
      n += 1;
    }
  }
  return { avg: n ? sum / n : 0, n };
}

export type SettleKnown = { sum: number; k: number; last: number; source: "feed" | "prints" | "none" };

/** What is known of the settlement average for a close: Kalshi's own
 *  accumulating average when it streamed, else our 1-Hz prints in the
 *  window (close − 60s, close]. */
export function settlePrints(st: BrtiState, closeMs: number): SettleKnown {
  const c = Math.floor(closeMs / 1000);
  let sum = 0;
  let k = 0;
  let last = 0;
  for (const p of st.prints) {
    if (p.s > c - SETTLE_WINDOW_S && p.s <= c) {
      sum += p.v;
      k += 1;
      last = p.v;
    }
  }
  const feed = st.settle.get(quarterClose(closeMs));
  if (feed && feed.n >= k) return { sum: feed.value * feed.n, k: feed.n, last: last || feed.value, source: "feed" };
  return { sum, k, last, source: k ? "prints" : "none" };
}

export type SettleFair = {
  p_up: number;
  mean: number;
  sd: number;
  k: number;
  m: number;
  pre_s: number;
  sig1: number;
  locked: boolean;
  source: SettleKnown["source"];
};

export function settleFair(st: BrtiState, strike: number, closeMs: number, nowMs: number, sig1: number): SettleFair {
  const from = Math.floor(closeMs / 1000) - SETTLE_WINDOW_S;
  const x = st.last;
  const known = settlePrints(st, closeMs);
  const k = Math.min(SETTLE_WINDOW_S, known.k);
  const m = SETTLE_WINDOW_S - k;
  if (!(x > 0) || !(strike > 0)) {
    return { p_up: 0.5, mean: x, sd: 0, k, m, pre_s: 0, sig1, locked: false, source: known.source };
  }
  const pre = Math.max(0, from - nowMs / 1000);
  const walk = (m * (m + 1) * (2 * m + 1)) / 6;
  const varSum = sig1 * sig1 * (walk + m * m * pre);
  const mean = (known.sum + m * x) / SETTLE_WINDOW_S;
  const samp = (SETTLE_SAMPLING_BPS / 1e4) * x;
  const sd = Math.sqrt(varSum / (SETTLE_WINDOW_S * SETTLE_WINDOW_S) + samp * samp);
  const z = sd > 0 ? (mean - strike) / sd : mean >= strike ? 50 : -50;
  const p = clamp(normCdf(z), 0.0005, 0.9995);
  return { p_up: p, mean, sd, k, m, pre_s: pre, sig1, locked: m === 0, source: known.source };
}
