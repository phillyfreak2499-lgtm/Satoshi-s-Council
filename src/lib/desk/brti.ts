/**
 * CF Benchmarks BRTI — the index Kalshi's 15-minute BTC market settles on —
 * and a settlement model built on the rule itself rather than on a spot
 * price: the window resolves on the simple average of the 60 one-per-second
 * index prints in the final minute before the close ("at least the strike"
 * settles YES). Pure module; the server feeds it ticks.
 *
 * Model. Let x be the latest index value, σ₁ the per-second $ volatility,
 * k the prints already known inside the settle minute (sum S), m = 60 − k
 * the prints still to come, and `pre` the seconds until the settle minute
 * starts. The unknown prints are a random walk from x, so
 *   E[avg]  = (S + m·x) / 60
 *   Var[avg] = σ₁² · (m(m+1)(2m+1)/6 + m²·pre) / 60²
 * plus a hair of sampling noise so a "locked" average is never exactly 100%.
 * The last 15 seconds of a window therefore carry far less uncertainty than
 * a diffusion of the whole minute — that is the arithmetic the book can miss.
 */
import { clamp } from "./math";
import { normCdf } from "./clock";

export const SETTLE_WINDOW_S = 60;
/** Our 1-Hz sampling vs Kalshi's own: bps of the index, added in quadrature. */
export const SETTLE_SAMPLING_BPS = 0.2;
/** Keep ~12 minutes of 1-Hz prints: the settle minute plus grading lag. */
const PRINTS_MAX = 720;

export type BrtiPrint = { s: number; v: number; t: number };

export type BrtiState = {
  last: number;
  last_t: number;
  last_src_t: number;
  n: number;
  prints: BrtiPrint[];
  var1: number;
  var_n: number;
  avg60_feed: number | null;
  settle_feed: number | null;
};

export function freshBrti(): BrtiState {
  return { last: 0, last_t: 0, last_src_t: 0, n: 0, prints: [], var1: 0, var_n: 0, avg60_feed: null, settle_feed: null };
}

/** Feed a tick. `src_t` is the vendor's timestamp (ms) when the feed carries one. */
export function pushBrti(st: BrtiState, v: number, t: number, src_t = 0): void {
  if (!(v > 0) || !Number.isFinite(v)) return;
  st.n += 1;
  st.last = v;
  st.last_t = t;
  st.last_src_t = src_t;
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
    st.var1 = st.var_n === 0 ? perSec : (1 - a) * st.var1 + a * perSec;
    st.var_n += 1;
  }
  arr.push({ s, v, t });
  if (arr.length > PRINTS_MAX) arr.splice(0, arr.length - PRINTS_MAX);
}

/** Per-second $ volatility from the stream; `fallback` until it has warmed. */
export function sigma1(st: BrtiState, fallback: number): number {
  if (st.var_n >= 30 && st.var1 > 0) return Math.sqrt(st.var1);
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

/** The 1-Hz prints inside the settle minute [close − 60s, close) seen so far. */
export function settlePrints(st: BrtiState, closeMs: number): { sum: number; k: number; last: number; first_s: number } {
  const c = Math.floor(closeMs / 1000);
  const from = c - SETTLE_WINDOW_S;
  let sum = 0;
  let k = 0;
  let last = 0;
  for (const p of st.prints) {
    if (p.s >= from && p.s < c) {
      sum += p.v;
      k += 1;
      last = p.v;
    }
  }
  return { sum, k, last, first_s: from };
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
};

export function settleFair(st: BrtiState, strike: number, closeMs: number, nowMs: number, sig1: number): SettleFair {
  const c = Math.floor(closeMs / 1000);
  const from = c - SETTLE_WINDOW_S;
  const x = st.last;
  const { sum, k } = settlePrints(st, closeMs);
  const m = Math.max(0, SETTLE_WINDOW_S - k);
  if (!(x > 0) || !(strike > 0)) {
    return { p_up: 0.5, mean: x, sd: 0, k, m, pre_s: 0, sig1, locked: false };
  }
  const pre = Math.max(0, from - nowMs / 1000);
  const walk = (m * (m + 1) * (2 * m + 1)) / 6;
  const varSum = sig1 * sig1 * (walk + m * m * pre);
  const mean = (sum + m * x) / SETTLE_WINDOW_S;
  const samp = (SETTLE_SAMPLING_BPS / 1e4) * x;
  const sd = Math.sqrt(varSum / (SETTLE_WINDOW_S * SETTLE_WINDOW_S) + samp * samp);
  const z = sd > 0 ? (mean - strike) / sd : mean >= strike ? 50 : -50;
  const p = clamp(normCdf(z), 0.0005, 0.9995);
  return { p_up: p, mean, sd, k, m, pre_s: pre, sig1, locked: m === 0 };
}
