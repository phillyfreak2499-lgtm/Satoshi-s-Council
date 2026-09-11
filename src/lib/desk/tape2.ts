/**
 * TAPE 2.0 — microstructure research features from the reconstructed Kalshi book.
 *
 * WHAT THIS IS FOR. The production TAPE seat reads top-of-book size imbalance
 * and a short persistence window. That is one thin slice of what the book says.
 * The lab already rebuilds the full depth from Kalshi's snapshot and delta
 * stream, so the rest is measurable: how imbalance looks several levels deep,
 * where the size-weighted price sits, whether resting size is being added or
 * pulled, whether a drained level comes back, and how long any of it lasts.
 *
 * WHAT THIS IS NOT. None of it votes. These are measurements recorded for
 * research; no seat reads them, no skill is created from them here, and nothing
 * in this file can reach the chair's score. They exist so that a future skill
 * built on one of them can be judged against a prospective record instead of a
 * hunch.
 *
 * THE ONE RULE THAT MATTERS MOST. A cancel is not a trade. Resting size
 * disappearing from the book because someone pulled it tells you something
 * quite different from size disappearing because someone bought it, and the
 * delta stream alone cannot distinguish them. So book events here are only ever
 * classified as ADD or CANCEL, the two things a book delta actually proves, and
 * order-flow imbalance is computed from those. Execution flow lives on the
 * trade channel and is accounted separately; it is never inferred from a
 * vanishing quote.
 *
 * FRAME. Everything is YES space (see yesView in lab-book.ts): bids are offers
 * to buy YES, asks are offers to sell it, one price axis, so a positive
 * imbalance always means pressure toward UP.
 *
 * NO LOOKAHEAD. Every value is computed from events already received at the
 * moment it is asked for. The state holds a bounded backward window and has no
 * way to see a later tick.
 *
 * Pure module: no clock of its own, no I/O. The caller supplies `now`.
 */
import type { Level, YesView } from "./lab-book";

/** Persistence windows, milliseconds. */
export const PERSIST_MS = [5_000, 15_000, 30_000, 60_000] as const;
/** How long a book event stays in the rolling window. The longest thing we ask of it. */
const EVENT_WINDOW_MS = 60_000;
/** Hard cap on retained events, so a bot farm quoting at 0.1¢ cannot grow this without bound. */
export const MAX_EVENTS = 4_000;
/** Hard cap on retained imbalance samples (one a second over the longest window, with slack). */
const MAX_SAMPLES = 240;
/** A level counts as depleted when it empties; replenishment within this window is "it came back". */
export const REPLENISH_MS = 10_000;

/** What a book delta actually proves: size was added, or size was pulled. Never "a trade happened". */
export type BookEventKind = "add" | "cancel";

export type BookEvent = {
  t: number;
  /** YES-space side the resting size sits on. */
  side: "bid" | "ask";
  price: number;
  /** Signed size change at that level: positive added, negative pulled. */
  delta: number;
  kind: BookEventKind;
};

export type Tape2State = {
  events: BookEvent[];
  /** Imbalance history for persistence and velocity: { t, imb } newest last. */
  samples: { t: number; imb: number }[];
  /** Best bid/ask last seen, and when they last changed — for touch age. */
  touch: { bid: number; ask: number; t: number };
  /** side:price of levels that emptied, and when, for replenishment. */
  emptied: Map<string, number>;
  /** Levels that refilled within REPLENISH_MS of emptying. */
  replenished: number;
  /** Times the sign of L1 imbalance flipped. */
  flips: number;
  /** Executions seen on the trade channel, kept apart from book flow on purpose. */
  trades: { t: number; side: "yes" | "no"; size: number }[];
};

export function freshTape2(): Tape2State {
  return {
    events: [],
    samples: [],
    touch: { bid: 0, ask: 0, t: 0 },
    emptied: new Map(),
    replenished: 0,
    flips: 0,
    trades: [],
  };
}

/**
 * Is this event inside the backward window ending at `now`?
 *
 * Both edges are bounded on purpose. Only checking the lower edge would let an
 * event stamped later than `now` answer a question about `now` — which in a live
 * stream cannot happen, and in a replay or a reordered feed absolutely can. The
 * upper bound is what makes "this reading used only what had happened" a
 * property of the code rather than a property of the caller's discipline.
 */
function inWindow(t: number, now: number, windowMs: number): boolean {
  return t <= now && t >= now - windowMs;
}

function trim<T extends { t: number }>(xs: T[], now: number, windowMs: number, cap: number): T[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < xs.length && xs[i]!.t < cutoff) i++;
  const kept = i > 0 ? xs.slice(i) : xs;
  return kept.length > cap ? kept.slice(kept.length - cap) : kept;
}

/**
 * Record one book delta. `sizeAfter` is the level's size once the delta applied,
 * so a level reaching zero is recognised as depletion rather than guessed at.
 * The YES-space side is what the caller must supply: a NO-side delta is an ASK
 * event in this frame.
 */
export function onBookDelta(
  st: Tape2State,
  side: "bid" | "ask",
  price: number,
  delta: number,
  sizeAfter: number,
  now: number,
): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  st.events.push({ t: now, side, price, delta, kind: delta > 0 ? "add" : "cancel" });
  st.events = trim(st.events, now, EVENT_WINDOW_MS, MAX_EVENTS);
  const key = `${side}:${price}`;
  if (sizeAfter <= 0) {
    st.emptied.set(key, now);
  } else if (delta > 0) {
    const at = st.emptied.get(key);
    if (at != null && now - at <= REPLENISH_MS) st.replenished += 1;
    if (at != null) st.emptied.delete(key);
  }
  // Keep the depletion map small: forget anything older than the replenish window.
  if (st.emptied.size > 200) {
    for (const [k, at] of st.emptied) if (now - at > REPLENISH_MS) st.emptied.delete(k);
  }
}

/**
 * Record an execution from the trade channel. Kept separate from book events so
 * that order-flow imbalance can never be polluted by cancellations, and trade
 * flow can never be invented from a disappearing quote.
 */
export function onTape2Trade(st: Tape2State, side: "yes" | "no", size: number, now: number): void {
  if (!(size > 0)) return;
  st.trades.push({ t: now, side, size });
  st.trades = trim(st.trades, now, EVENT_WINDOW_MS, MAX_EVENTS);
}

/** Sample the current imbalance so persistence and velocity have a history to read. */
export function sampleTape2(st: Tape2State, view: YesView, now: number): void {
  const imb = depthImbalance(view, 1);
  st.samples.push({ t: now, imb });
  st.samples = trim(st.samples, now, EVENT_WINDOW_MS + 5_000, MAX_SAMPLES);
  const prev = st.samples.length >= 2 ? st.samples[st.samples.length - 2]!.imb : null;
  if (prev != null && Math.sign(prev) !== 0 && Math.sign(imb) !== 0 && Math.sign(prev) !== Math.sign(imb)) {
    st.flips += 1;
  }
  const bid = view.bids[0]?.price ?? 0;
  const ask = view.asks[0]?.price ?? 0;
  if (bid !== st.touch.bid || ask !== st.touch.ask) st.touch = { bid, ask, t: now };
}

function depthOf(levels: Level[], n: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(n, levels.length); i++) sum += levels[i]!.size;
  return sum;
}

function ratio(a: number, b: number): number {
  const tot = a + b;
  if (!(tot > 0)) return 0;
  return round4((a - b) / tot);
}

function round4(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : 0;
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Depth imbalance over the top `n` levels: +1 all bid, −1 all ask, 0 balanced. */
export function depthImbalance(view: YesView, n: number): number {
  return ratio(depthOf(view.bids, n), depthOf(view.asks, n));
}

/**
 * Depth imbalance with nearer levels counted more heavily. Size resting one
 * cent from the touch is far more likely to matter in the next few seconds than
 * size ten cents away, which a flat sum over five levels treats as equal.
 * Weight falls as 1/(1 + distance in cents from the touch).
 */
export function weightedImbalance(view: YesView, n = 5): number {
  const bestBid = view.bids[0]?.price ?? 0;
  const bestAsk = view.asks[0]?.price ?? 0;
  const w = (levels: Level[], best: number) => {
    let sum = 0;
    for (let i = 0; i < Math.min(n, levels.length); i++) {
      const l = levels[i]!;
      sum += l.size / (1 + Math.abs(l.price - best));
    }
    return sum;
  };
  return ratio(w(view.bids, bestBid), w(view.asks, bestAsk));
}

/**
 * Microprice: the mid weighted by the size resting on the other side. When the
 * ask is thin and the bid is heavy, fair value sits nearer the ask, because the
 * thin side is the one that gives way first. Falls back to the mid when either
 * side is missing.
 */
export function microprice(view: YesView): number {
  const bid = view.bids[0];
  const ask = view.asks[0];
  if (!bid || !ask) return round2(bid?.price ?? ask?.price ?? 0);
  const tot = bid.size + ask.size;
  if (!(tot > 0)) return round2((bid.price + ask.price) / 2);
  return round2((bid.price * ask.size + ask.price * bid.size) / tot);
}

export function midpoint(view: YesView): number {
  const bid = view.bids[0];
  const ask = view.asks[0];
  if (!bid || !ask) return round2(bid?.price ?? ask?.price ?? 0);
  return round2((bid.price + ask.price) / 2);
}

/**
 * Order-flow imbalance from book events only: size added to the bid and size
 * pulled from the ask both read as upward pressure, and the mirror for
 * downward. A cancel is a cancel — it is never counted as an execution.
 */
export function ofi(st: Tape2State, now: number, windowMs = 15_000): number {
  let up = 0;
  let down = 0;
  for (const e of st.events) {
    if (!inWindow(e.t, now, windowMs)) continue;
    const mag = Math.abs(e.delta);
    // Size added to the bid, or pulled from the ask, is pressure toward UP.
    const upward = e.side === "bid" ? e.kind === "add" : e.kind === "cancel";
    if (upward) up += mag;
    else down += mag;
  }
  return round2(up - down);
}

/**
 * The least depth this will divide by. A share of nothing is not a share, and a
 * denominator near zero turns a small flow into an enormous number — which is
 * exactly what happened in production before the book stopped storing
 * cancelled-to-residue levels (see QTY_EPS in lab-book.ts): depth summed dust
 * around 1e-13 and this function reported values around 1e17.
 *
 * The book no longer produces those levels, so this is a second line rather than
 * the fix. It stays because a ratio with an unbounded denominator is a trap, and
 * an honest zero is better than a number that looks like a signal.
 */
export const MIN_OFI_DEPTH = 1e-6;

/** OFI as a share of the depth it is moving against, so a quiet book is not flattered by raw size. */
export function normalizedOfi(st: Tape2State, view: YesView, now: number, windowMs = 15_000): number {
  const depth = depthOf(view.bids, 5) + depthOf(view.asks, 5);
  if (!(depth >= MIN_OFI_DEPTH)) return 0;
  return round4(ofi(st, now, windowMs) / depth);
}

/** Added and pulled size per side in the window, so pressure can be read without netting it away. */
export function addCancelPressure(st: Tape2State, now: number, windowMs = 15_000) {
  const acc = { bid_add: 0, bid_cancel: 0, ask_add: 0, ask_cancel: 0, events: 0 };
  for (const e of st.events) {
    if (!inWindow(e.t, now, windowMs)) continue;
    acc.events += 1;
    const mag = Math.abs(e.delta);
    if (e.side === "bid") {
      if (e.kind === "add") acc.bid_add += mag;
      else acc.bid_cancel += mag;
    } else if (e.kind === "add") {
      acc.ask_add += mag;
    } else {
      acc.ask_cancel += mag;
    }
  }
  return {
    bid_add: round2(acc.bid_add),
    bid_cancel: round2(acc.bid_cancel),
    ask_add: round2(acc.ask_add),
    ask_cancel: round2(acc.ask_cancel),
    events: acc.events,
    /** Share of pulled size against added size, both sides: 1 means everything was a cancel. */
    cancel_share: round4(
      (acc.bid_cancel + acc.ask_cancel) /
        Math.max(1e-9, acc.bid_add + acc.bid_cancel + acc.ask_add + acc.ask_cancel),
    ),
  };
}

/**
 * Share of the window in which imbalance held its current sign. 1 means it has
 * pointed one way for the whole window; near 0 means it has been flipping.
 * Null until there are at least two samples inside the window to compare.
 */
export function persistence(st: Tape2State, now: number, windowMs: number): number | null {
  const xs = st.samples.filter((s) => inWindow(s.t, now, windowMs));
  if (xs.length < 2) return null;
  const sign = Math.sign(xs[xs.length - 1]!.imb);
  if (sign === 0) return 0;
  const same = xs.reduce((n, s) => n + (Math.sign(s.imb) === sign ? 1 : 0), 0);
  return round4(same / xs.length);
}

/** Imbalance change per second over the window. Null without two samples to difference. */
export function imbalanceVelocity(st: Tape2State, now: number, windowMs = 15_000): number | null {
  const xs = st.samples.filter((s) => inWindow(s.t, now, windowMs));
  if (xs.length < 2) return null;
  const first = xs[0]!;
  const last = xs[xs.length - 1]!;
  const dt = (last.t - first.t) / 1000;
  if (!(dt > 0)) return null;
  return round4((last.imb - first.imb) / dt);
}

/** Share of visible depth sitting at the touch: high means the book is a shell. */
export function depthConcentration(view: YesView, n = 5): number {
  const top = (view.bids[0]?.size ?? 0) + (view.asks[0]?.size ?? 0);
  const all = depthOf(view.bids, n) + depthOf(view.asks, n);
  if (!(all > 0)) return 0;
  return round4(top / all);
}

/**
 * How quickly size grows moving away from the touch, averaged over both sides:
 * size per cent of distance. A steep slope is a book that thickens fast; a flat
 * one is thin all the way out.
 */
export function depthSlope(view: YesView, n = 5): number {
  const side = (levels: Level[]) => {
    if (levels.length < 2) return 0;
    const best = levels[0]!.price;
    let num = 0;
    let den = 0;
    for (let i = 1; i < Math.min(n, levels.length); i++) {
      const l = levels[i]!;
      const d = Math.abs(l.price - best);
      if (d <= 0) continue;
      num += l.size / d;
      den += 1;
    }
    return den > 0 ? num / den : 0;
  };
  return round2((side(view.bids) + side(view.asks)) / 2);
}

/** Milliseconds since the best bid or ask last changed. Null before a first sample. */
export function touchAge(st: Tape2State, now: number): number | null {
  if (!st.touch.t) return null;
  return Math.max(0, now - st.touch.t);
}

/** Levels currently sitting empty after having held size. */
export function depletedNow(st: Tape2State, now: number): number {
  let n = 0;
  for (const at of st.emptied.values()) if (inWindow(at, now, REPLENISH_MS)) n += 1;
  return n;
}

/** Executions in the window, split by the side the aggressor bought. Trade channel only. */
export function tradeFlow(st: Tape2State, now: number, windowMs = 15_000) {
  let yes = 0;
  let no = 0;
  let n = 0;
  for (const tr of st.trades) {
    if (!inWindow(tr.t, now, windowMs)) continue;
    n += 1;
    if (tr.side === "yes") yes += tr.size;
    else no += tr.size;
  }
  return { n, yes: round2(yes), no: round2(no), imbalance: ratio(yes, no) };
}

export type Tape2Features = {
  /** Touch. */
  yes_bid: number;
  yes_ask: number;
  spread: number;
  bid_levels: number;
  ask_levels: number;
  /** Imbalance, shallow to deep. */
  imb_l1: number;
  imb_l3: number;
  imb_l5: number;
  imb_weighted: number;
  touch_imb: number;
  /** Price. */
  microprice: number;
  midpoint: number;
  micro_minus_mid: number;
  /** Flow, from book deltas only. */
  ofi_15s: number;
  ofi_norm_15s: number;
  bid_add: number;
  bid_cancel: number;
  ask_add: number;
  ask_cancel: number;
  cancel_share: number;
  book_events_15s: number;
  /** Dynamics. */
  imb_velocity: number | null;
  persist_5s: number | null;
  persist_15s: number | null;
  persist_30s: number | null;
  persist_60s: number | null;
  flips: number;
  touch_age_ms: number | null;
  depleted: number;
  replenished: number;
  /** Shape. */
  depth_concentration: number;
  depth_slope: number;
  /** Executions, kept apart from book flow. */
  trade_n_15s: number;
  trade_imb_15s: number;
};

/**
 * The whole feature set at this instant. Everything reads the state's backward
 * window and the book as it stands now; nothing here can see a later tick.
 */
export function tape2Features(st: Tape2State, view: YesView, now: number): Tape2Features {
  const p = addCancelPressure(st, now, 15_000);
  const tf = tradeFlow(st, now, 15_000);
  const micro = microprice(view);
  const mid = midpoint(view);
  const bid = view.bids[0];
  const ask = view.asks[0];
  return {
    yes_bid: bid?.price ?? 0,
    yes_ask: ask?.price ?? 0,
    spread: bid && ask ? round2(ask.price - bid.price) : 0,
    bid_levels: view.bids.length,
    ask_levels: view.asks.length,
    imb_l1: depthImbalance(view, 1),
    imb_l3: depthImbalance(view, 3),
    imb_l5: depthImbalance(view, 5),
    imb_weighted: weightedImbalance(view, 5),
    touch_imb: ratio(bid?.size ?? 0, ask?.size ?? 0),
    microprice: micro,
    midpoint: mid,
    micro_minus_mid: round2(micro - mid),
    ofi_15s: ofi(st, now, 15_000),
    ofi_norm_15s: normalizedOfi(st, view, now, 15_000),
    bid_add: p.bid_add,
    bid_cancel: p.bid_cancel,
    ask_add: p.ask_add,
    ask_cancel: p.ask_cancel,
    cancel_share: p.cancel_share,
    book_events_15s: p.events,
    imb_velocity: imbalanceVelocity(st, now, 15_000),
    persist_5s: persistence(st, now, 5_000),
    persist_15s: persistence(st, now, 15_000),
    persist_30s: persistence(st, now, 30_000),
    persist_60s: persistence(st, now, 60_000),
    flips: st.flips,
    touch_age_ms: touchAge(st, now),
    depleted: depletedNow(st, now),
    replenished: st.replenished,
    depth_concentration: depthConcentration(view, 5),
    depth_slope: depthSlope(view, 5),
    trade_n_15s: tf.n,
    trade_imb_15s: tf.imbalance,
  };
}
