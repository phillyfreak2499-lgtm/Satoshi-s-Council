/**
 * The stale-quote study. Every time the settlement model's fair value jumps
 * by ≥ SHOCK_CENTS while the book has not moved, one "shock" is opened: the
 * ask a taker would have hit, its size, the mispricing after the exact taker
 * fee, and then what the level did — taken by someone else, pulled by the
 * maker, moved, or still there — with the time it survived, so a simulated
 * IOC at each latency can be marked filled or not. Markouts (fair value 100…
 * 1000 ms later minus the price paid) say whether the fill captured
 * information or chased noise. Pure module; the server drives it.
 */
import { takerFeeCentsExact } from "./clock";
import { tenths, type Bests } from "./lab-book";

export const SHOCK_CENTS = 2;
export const SHOCK_CAP_MS = 10_000;
export const FILL_LATENCIES = [50, 100, 150, 200, 300, 500] as const;
export const MARKOUT_MS = [100, 250, 500, 1000] as const;
const TAKEN_WINDOW_MS = 400;

export type ShockMeta = {
  ticker: string;
  secs_left: number;
  final_minute: boolean;
  session: string;
};

export type Shock = ShockMeta & {
  id: number;
  t0: number;
  side: "UP" | "DOWN";
  fair_before: number;
  fair_after: number;
  ask_before: number;
  ask_size: number;
  level_side: "yes" | "no";
  level_px: number;
  misprice: number;
  fee: number;
  net_edge: number;
  gone_ms: number | null;
  gone_how: "taken" | "pulled" | "moved" | "open" | null;
  markouts: Partial<Record<(typeof MARKOUT_MS)[number], number>>;
  taken_hint: boolean;
  /** How long the fair-value move that opened this took: ≤1s is a jump the
   *  book had no time to answer (a stale-quote candidate); longer is drift,
   *  i.e. the model simply disagreeing with a book that has had time. */
  jump_ms: number;
  /** Age of the book's best quotes when the shock opened. */
  book_age_ms: number;
};

export const FAST_JUMP_MS = 1_000;

type TradeMark = { t: number; yes_price: number; no_price: number; taker_side: string };

export type StudyState = {
  open: Shock[];
  fairRef: number;
  fairRefT: number;
  bestsT: number;
  nextId: number;
  n_shocks: number;
  n_edge: number;
  n_nobook: number;
  trades: TradeMark[];
};

export function freshStudy(): StudyState {
  return { open: [], fairRef: 0, fairRefT: 0, bestsT: 0, nextId: 1, n_shocks: 0, n_edge: 0, n_nobook: 0, trades: [] };
}

/** The book's best changed: the market repriced, so the reference resets and
 *  open shocks whose stale ask is no longer offered resolve as "moved". */
export function onBookBests(st: StudyState, b: Bests, fairYes: number, t: number): void {
  st.fairRef = fairYes;
  st.fairRefT = t;
  st.bestsT = t;
  for (const s of st.open) {
    if (s.gone_ms != null) continue;
    const ask = s.side === "UP" ? b.yes_ask : b.no_ask;
    if (ask === 0 || ask > s.ask_before) {
      s.gone_ms = t - s.t0;
      s.gone_how = "moved";
    }
  }
}

export function onFair(st: StudyState, fairYes: number, t: number, b: Bests, meta: ShockMeta): Shock | null {
  if (!st.fairRefT) {
    st.fairRef = fairYes;
    st.fairRefT = t;
    return null;
  }
  const d = fairYes - st.fairRef;
  if (Math.abs(d) < SHOCK_CENTS) return null;
  const before = st.fairRef;
  const jump_ms = Math.max(0, t - st.fairRefT);
  st.fairRef = fairYes;
  st.fairRefT = t;
  const side: "UP" | "DOWN" = d > 0 ? "UP" : "DOWN";
  const ask = side === "UP" ? b.yes_ask : b.no_ask;
  const askSz = side === "UP" ? b.yes_ask_sz : b.no_ask_sz;
  if (!(ask > 0) || !(askSz > 0)) {
    st.n_nobook += 1;
    return null;
  }
  // The same resting ask is one opportunity, however many ticks fair value
  // keeps drifting while it sits there: refresh the open shock, don't stack.
  const dup = st.open.find((o) => o.gone_ms == null && o.side === side && o.ask_before === ask);
  if (dup) {
    dup.fair_after = fairYes;
    return null;
  }
  const fairSide = side === "UP" ? fairYes : 100 - fairYes;
  const fee = takerFeeCentsExact(ask);
  const misprice = Math.round((fairSide - ask) * 1000) / 1000;
  const shock: Shock = {
    ...meta,
    id: st.nextId++,
    t0: t,
    side,
    fair_before: before,
    fair_after: fairYes,
    ask_before: ask,
    ask_size: askSz,
    level_side: side === "UP" ? "no" : "yes",
    level_px: tenths(100 - ask),
    misprice,
    fee,
    net_edge: Math.round((misprice - fee) * 1000) / 1000,
    gone_ms: null,
    gone_how: null,
    markouts: {},
    taken_hint: false,
    jump_ms,
    book_age_ms: st.bestsT ? Math.max(0, t - st.bestsT) : 0,
  };
  st.open.push(shock);
  st.n_shocks += 1;
  if (shock.net_edge > 0) st.n_edge += 1;
  return shock;
}

function tradeAtLevel(st: StudyState, s: Shock, t: number): boolean {
  for (let i = st.trades.length - 1; i >= 0; i -= 1) {
    const tr = st.trades[i]!;
    if (t - tr.t > TAKEN_WINDOW_MS) break;
    const px = s.side === "UP" ? tr.yes_price : tr.no_price;
    if (px === s.ask_before) return true;
  }
  return false;
}

/** A resting level changed size. Size 0 at a shock's level resolves it. */
export function onDelta(st: StudyState, side: "yes" | "no", price: number, size: number, t: number): void {
  for (const s of st.open) {
    if (s.gone_ms != null || s.level_side !== side || s.level_px !== price) continue;
    if (size <= 0) {
      s.gone_ms = t - s.t0;
      s.gone_how = s.taken_hint || tradeAtLevel(st, s, t) ? "taken" : "pulled";
    }
  }
}

export function onTrade(st: StudyState, tr: TradeMark): void {
  st.trades.push(tr);
  if (st.trades.length > 60) st.trades.shift();
  for (const s of st.open) {
    const px = s.side === "UP" ? tr.yes_price : tr.no_price;
    if (px !== s.ask_before) continue;
    if (s.gone_ms == null) s.taken_hint = true;
    else if (s.gone_how === "pulled" && tr.t - (s.t0 + s.gone_ms) <= TAKEN_WINDOW_MS) s.gone_how = "taken";
  }
}

/** Time passes: fill markouts, cap survivors, and hand back finished shocks. */
export function onTick(st: StudyState, fairYes: number, t: number): Shock[] {
  const done: Shock[] = [];
  const keep: Shock[] = [];
  for (const s of st.open) {
    const fairSide = s.side === "UP" ? fairYes : 100 - fairYes;
    for (const dt of MARKOUT_MS) {
      if (s.markouts[dt] === undefined && t >= s.t0 + dt) s.markouts[dt] = fairSide - s.ask_before;
    }
    if (s.gone_ms == null && t - s.t0 >= SHOCK_CAP_MS) {
      s.gone_ms = SHOCK_CAP_MS;
      s.gone_how = "open";
    }
    const settled = s.gone_ms != null && s.markouts[1000] !== undefined && t - s.t0 >= TAKEN_WINDOW_MS + 1000;
    if (settled) done.push(s);
    else keep.push(s);
  }
  st.open = keep;
  return done;
}

/** Would an IOC sent after `latency` ms have found the level? */
export function fills(s: Shock): Record<(typeof FILL_LATENCIES)[number], boolean> {
  const out = {} as Record<(typeof FILL_LATENCIES)[number], boolean>;
  for (const L of FILL_LATENCIES) out[L] = s.gone_how === "open" || (s.gone_ms ?? 0) > L;
  return out;
}
