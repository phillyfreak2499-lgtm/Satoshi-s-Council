/**
 * SPOT AND PERP SIGNED TRADE FLOW — instrument first, no decision use (pure).
 *
 * The collector (trade-flow.server.ts) polls each venue's PUBLIC recent-trades
 * endpoint and folds the trades into one-minute buckets, per venue, kept
 * separate:
 *   COINBASE_SPOT  BTC-USD on Coinbase Exchange
 *   OKX_PERP       BTC-USDT-SWAP on OKX
 *
 * The signed-flow definition is FROZEN here (FLOW_DEF) before any trade is
 * collected. Buy and sell mean the AGGRESSOR's side. The two venues report it
 * differently, and getting it backwards silently inverts the whole signal:
 *   - Coinbase Exchange reports the MAKER order's side, so the aggressor is
 *     the opposite of `side`;
 *   - OKX reports the TAKER's side, so the aggressor is `side`.
 *
 * CONTINUITY. A minute is only written once it is SEALED: a poll that landed
 * after its end (plus a lag) overlapped the previously seen trades, or the
 * break was recorded. A break in continuity is a GAP flag on every minute it
 * touches; it is never filled in. Only a flag-free minute is `complete`, and
 * only complete minutes feed a feature.
 *
 * The first deliverable is COLLECTION QUALITY. The H0 test runs only after
 * enough clean windows exist, it is scored against the same-time Kalshi price,
 * and flow that merely restates the price is a retirement candidate. Nothing
 * here feeds the Chair, a seat, a gate or booking.
 */
import { takerFeeCents } from "./clock.ts";
import { DEPTH_CLOCKS } from "./book-depth.ts";
import { fillStats, round, type Fill } from "./research-factory.ts";
import { marginalValue, type SignalObs } from "./research-factory-insight.ts";

export const FLOW_VENUES = ["COINBASE_SPOT", "OKX_PERP"] as const;
export type FlowVenue = (typeof FLOW_VENUES)[number];

/** The signed-flow definition, frozen before collection. Changing it means a new id and version. */
export const FLOW_DEF = Object.freeze({
  id: "FLOW_DEF_V1",
  version: 1,
  signed_volume: "aggressor-buy BTC minus aggressor-sell BTC",
  normalized_delta: "signed volume / total volume over the same minutes (-1..1); null when there was no volume",
  bucket: "the exchange's trade timestamp, floored to the UTC minute",
  venues: Object.freeze({
    COINBASE_SPOT: Object.freeze({ product: "BTC-USD", aggressor: "opposite of the reported side (Coinbase Exchange reports the maker order's side)", size: "size (BTC)", contract_base: 1 }),
    OKX_PERP: Object.freeze({ product: "BTC-USDT-SWAP", aggressor: "the reported side (OKX reports the taker's side)", size: "sz contracts x ctVal 0.01 BTC", contract_base: 0.01 }),
  }),
});

/** Fixed clocks for the same-time price marks: the depth collector's clocks. */
export const FLOW_CLOCKS = DEPTH_CLOCKS;
const MINUTE = 60_000;
/** A trade stamped this far ahead of our clock is flagged CLOCK_SKEW. */
export const MAX_SKEW_MS = 5_000;
/** A trade stamped this far behind a trade with a lower id is flagged OUT_OF_ORDER. */
export const OUT_OF_ORDER_MS = 2_000;
/** A continuity break longer than this is not written minute by minute: those minutes are simply absent (uncovered). */
export const MAX_GAP_MINUTES = 30;

export type NormTrade = { id: number; ts: number; px: number; base: number; aggressor: "BUY" | "SELL" };
export type Parsed = { trades: NormTrade[]; rejected: number };

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
};
const safeId = (x: unknown): number | null => { const n = num(x); return n != null && Number.isSafeInteger(n) && n >= 0 ? n : null; };

/** Coinbase Exchange GET /products/BTC-USD/trades: `side` is the MAKER's side. */
export function parseCoinbaseTrades(raw: unknown): Parsed {
  if (!Array.isArray(raw)) return { trades: [], rejected: 0 };
  const trades: NormTrade[] = [];
  let rejected = 0;
  for (const r of raw as Array<Record<string, unknown>>) {
    const id = safeId(r?.trade_id), ts = typeof r?.time === "string" ? Date.parse(r.time) : NaN, px = num(r?.price), base = num(r?.size);
    const side = r?.side === "buy" ? "SELL" : r?.side === "sell" ? "BUY" : null; // maker buy was hit by an aggressive seller
    if (id == null || !Number.isFinite(ts) || px == null || px <= 0 || base == null || base <= 0 || side == null) { rejected += 1; continue; }
    trades.push({ id, ts, px, base, aggressor: side });
  }
  return { trades, rejected };
}

/** OKX GET /api/v5/market/trades and /market/history-trades: `side` is the TAKER's side; `sz` is in contracts. */
export function parseOkxTrades(raw: unknown, contractBase: number = FLOW_DEF.venues.OKX_PERP.contract_base): Parsed {
  const body = raw as { code?: unknown; data?: unknown } | null;
  if (!body || String(body.code) !== "0" || !Array.isArray(body.data)) return { trades: [], rejected: 0 };
  const trades: NormTrade[] = [];
  let rejected = 0;
  for (const r of body.data as Array<Record<string, unknown>>) {
    const id = safeId(r?.tradeId), ts = num(r?.ts), px = num(r?.px), sz = num(r?.sz);
    const side = r?.side === "buy" ? "BUY" : r?.side === "sell" ? "SELL" : null;
    if (id == null || ts == null || px == null || px <= 0 || sz == null || sz <= 0 || side == null) { rejected += 1; continue; }
    trades.push({ id, ts, px, base: sz * contractBase, aggressor: side });
  }
  return { trades, rejected };
}

/** OKX GET /api/v5/public/instruments for BTC-USDT-SWAP: the contract must be exactly what FLOW_DEF froze. */
export function okxContractMatches(raw: unknown): boolean {
  const inst = (raw as { data?: Array<Record<string, unknown>> } | null)?.data?.[0];
  return !!inst && inst.instId === "BTC-USDT-SWAP" && num(inst.ctVal) === FLOW_DEF.venues.OKX_PERP.contract_base && inst.ctValCcy === "BTC";
}

// ---------------------------------------------------------------------------
// Continuity and minute buckets.
// ---------------------------------------------------------------------------

type Bucket = {
  n_buy: number; n_sell: number; buy_base: number; sell_base: number; buy_quote: number; sell_quote: number;
  open: { id: number; px: number } | null; close: { id: number; px: number } | null; high: number | null; low: number | null; max_trade_base: number;
  first_id: number | null; last_id: number | null; flags: Set<string>;
};
export type FlowMinute = {
  venue: FlowVenue; minute_ms: number; def_version: number; complete: boolean; flags: string[];
  n_buy: number; n_sell: number; buy_base: number; sell_base: number; buy_quote: number; sell_quote: number;
  open_px: number | null; close_px: number | null; high_px: number | null; low_px: number | null; max_trade_base: number | null;
  first_trade_id: string | null; last_trade_id: string | null;
};
export type VenueState = {
  venue: FlowVenue;
  lastId: number | null;
  lastTs: number | null;
  /** Minutes before this were never fully observed and are never written. */
  coverageFrom: number | null;
  /** The next minute to seal. */
  nextSeal: number | null;
  lastPollAt: number | null;
  buckets: Map<number, Bucket>;
  gaps: Array<{ from: number; to: number }>;
  counters: { polls: number; gaps: number; long_gaps: number; late: number; out_of_order: number; clock_skew: number; rejected: number };
};

export const floorMinute = (t: number) => Math.floor(t / MINUTE) * MINUTE;

export function freshVenue(venue: FlowVenue): VenueState {
  return { venue, lastId: null, lastTs: null, coverageFrom: null, nextSeal: null, lastPollAt: null, buckets: new Map(), gaps: [], counters: { polls: 0, gaps: 0, long_gaps: 0, late: 0, out_of_order: 0, clock_skew: 0, rejected: 0 } };
}

const emptyBucket = (): Bucket => ({ n_buy: 0, n_sell: 0, buy_base: 0, sell_base: 0, buy_quote: 0, sell_quote: 0, open: null, close: null, high: null, low: null, max_trade_base: 0, first_id: null, last_id: null, flags: new Set() });

/** Did this fetch reach back to trades we had already seen? */
export const overlaps = (vs: VenueState, trades: readonly NormTrade[]) => vs.lastId == null || trades.some((t) => t.id <= vs.lastId!);

/**
 * Fold one poll (the newest page plus any backfill pages) into the venue's
 * buckets. `overlapped` says whether the fetch reached trades already seen;
 * if not, the stretch between the last seen trade and the oldest fetched one
 * is a GAP. An empty poll carries no information and changes nothing.
 */
export function applyPoll(vs: VenueState, trades: readonly NormTrade[], overlapped: boolean, pollAt: number): { accepted: number } {
  if (!trades.length) return { accepted: 0 };
  const byId = new Map<number, NormTrade>();
  for (const t of trades) byId.set(t.id, t);
  const sorted = [...byId.values()].sort((a, b) => a.id - b.id);
  const sealedBefore = vs.nextSeal;
  if (vs.lastId == null) {
    // First observation: the oldest trade's minute was only partly seen.
    vs.coverageFrom = floorMinute(sorted[0]!.ts) + MINUTE;
    vs.nextSeal = vs.coverageFrom;
  }
  const fresh = vs.lastId == null ? sorted : sorted.filter((t) => t.id > vs.lastId!);
  if (vs.lastId != null && !overlapped && fresh.length) {
    const from = vs.lastTs ?? fresh[0]!.ts, to = fresh[0]!.ts;
    vs.counters.gaps += 1;
    if (floorMinute(to) - Math.max(vs.nextSeal ?? 0, floorMinute(from)) > MAX_GAP_MINUTES * MINUTE) {
      // Too long to write minute by minute: skip ahead; those minutes stay absent.
      vs.counters.long_gaps += 1;
      for (const m of [...vs.buckets.keys()]) if (m < floorMinute(to) + MINUTE) vs.buckets.delete(m);
      vs.gaps = vs.gaps.filter((g) => g.to >= floorMinute(to) + MINUTE);
      vs.nextSeal = floorMinute(to) + MINUTE;
    } else {
      vs.gaps.push({ from, to });
    }
  }
  let runningMax = vs.lastTs ?? -Infinity;
  let accepted = 0;
  for (const t of fresh) {
    const m = floorMinute(t.ts);
    if (vs.nextSeal != null && m < vs.nextSeal) {
      if (sealedBefore != null && m < sealedBefore) vs.counters.late += 1; // lands in a minute already written
    } else {
      const b = vs.buckets.get(m) ?? emptyBucket();
      if (t.aggressor === "BUY") { b.n_buy += 1; b.buy_base += t.base; b.buy_quote += t.base * t.px; } else { b.n_sell += 1; b.sell_base += t.base; b.sell_quote += t.base * t.px; }
      if (!b.open || t.id < b.open.id) b.open = { id: t.id, px: t.px };
      if (!b.close || t.id > b.close.id) b.close = { id: t.id, px: t.px };
      b.high = b.high == null ? t.px : Math.max(b.high, t.px);
      b.low = b.low == null ? t.px : Math.min(b.low, t.px);
      b.max_trade_base = Math.max(b.max_trade_base, t.base);
      b.first_id = b.first_id == null ? t.id : Math.min(b.first_id, t.id);
      b.last_id = b.last_id == null ? t.id : Math.max(b.last_id, t.id);
      if (t.ts > pollAt + MAX_SKEW_MS) { b.flags.add("CLOCK_SKEW"); vs.counters.clock_skew += 1; }
      if (t.ts < runningMax - OUT_OF_ORDER_MS) { b.flags.add("OUT_OF_ORDER"); vs.counters.out_of_order += 1; }
      vs.buckets.set(m, b);
      accepted += 1;
    }
    runningMax = Math.max(runningMax, t.ts);
  }
  const newest = sorted[sorted.length - 1]!;
  if (vs.lastId == null || newest.id > vs.lastId) { vs.lastId = newest.id; vs.lastTs = newest.ts; }
  vs.lastPollAt = Math.max(vs.lastPollAt ?? 0, pollAt);
  vs.counters.polls += 1;
  return { accepted };
}

/**
 * Minutes whose end (plus `sealLagMs`) precedes the last successful poll are
 * final: emit them in order, including empty minutes, each with its flags.
 */
export function sealReady(vs: VenueState, sealLagMs: number): FlowMinute[] {
  const out: FlowMinute[] = [];
  if (vs.nextSeal == null || vs.lastPollAt == null) return out;
  while (vs.nextSeal + MINUTE + sealLagMs <= vs.lastPollAt) {
    const m: number = vs.nextSeal;
    const b = vs.buckets.get(m) ?? emptyBucket();
    const flags = [...b.flags];
    if (vs.gaps.some((g) => g.from < m + MINUTE && g.to >= m)) flags.push("GAP");
    flags.sort();
    out.push({
      venue: vs.venue, minute_ms: m, def_version: FLOW_DEF.version, complete: flags.length === 0, flags,
      n_buy: b.n_buy, n_sell: b.n_sell, buy_base: round(b.buy_base, 8)!, sell_base: round(b.sell_base, 8)!, buy_quote: round(b.buy_quote, 2)!, sell_quote: round(b.sell_quote, 2)!,
      open_px: b.open?.px ?? null, close_px: b.close?.px ?? null, high_px: b.high, low_px: b.low, max_trade_base: b.max_trade_base > 0 ? round(b.max_trade_base, 8) : null,
      first_trade_id: b.first_id == null ? null : String(b.first_id), last_trade_id: b.last_id == null ? null : String(b.last_id),
    });
    vs.buckets.delete(m);
    vs.nextSeal = m + MINUTE;
  }
  vs.gaps = vs.gaps.filter((g) => g.to >= vs.nextSeal!);
  return out;
}

// ---------------------------------------------------------------------------
// Window features, collection quality, and the gated H0.
// ---------------------------------------------------------------------------

/** The minimal slice of a stored minute the report needs. */
export type StoredMinute = { venue: FlowVenue; minute_ms: number; complete: boolean; flags: string[]; buy_base: number; sell_base: number; n: number };
export type FlowMark = { yes_mid: number | null; yes_bid: number | null; yes_ask: number | null; no_bid: number | null; no_ask: number | null; quote_age_ms: number | null };
export type FlowSpan = { minutes: number; complete: boolean; delta_base: number | null; volume_base: number | null; norm: number | null };
export type FlowWindow = { ticker: string; close_ms: number; winner: "UP" | "DOWN" | null; marks: Partial<Record<number, FlowMark>> };

export type MinuteIndex = ReadonlyMap<string, StoredMinute>;
const key = (venue: FlowVenue, m: number) => `${venue}|${m}`;
export function indexMinutes(rows: readonly StoredMinute[]): Map<string, StoredMinute> {
  const idx = new Map<string, StoredMinute>();
  for (const r of rows) idx.set(key(r.venue, r.minute_ms), r);
  return idx;
}

/** Signed flow over [to - minutes, to): null features unless every minute is present and complete. */
export function flowSpan(idx: MinuteIndex, venue: FlowVenue, toMs: number, minutes: number): FlowSpan {
  let delta = 0, vol = 0, complete = true;
  for (let m = toMs - minutes * MINUTE; m < toMs; m += MINUTE) {
    const r = idx.get(key(venue, m));
    if (!r || !r.complete) { complete = false; break; }
    delta += r.buy_base - r.sell_base;
    vol += r.buy_base + r.sell_base;
  }
  if (!complete) return { minutes, complete, delta_base: null, volume_base: null, norm: null };
  return { minutes, complete, delta_base: round(delta, 6), volume_base: round(vol, 6), norm: vol > 0 ? round(delta / vol, 4) : null };
}

/** Pre-registered H0 parameters, frozen here before any trade is collected. */
export const FLOW_H0 = Object.freeze({
  id: "TRADE_FLOW_H0_V1",
  hypothesis_kind: "PRESPECIFIED" as const,
  statement: "Spot aggressor-signed flow over the 5 minutes before T-3:00 provides no incremental predictive value for the official KXBTC15M settlement beyond the same-time market price.",
  primary: Object.freeze({ venue: "COINBASE_SPOT" as FlowVenue, clock: 180, span_minutes: 5, feature: "normalized_delta" }),
  /** |normalized delta| at or above this counts as flow leaning to a side (positive = UP). */
  stance_threshold: 0.1,
  /** Clean settled windows required before the test runs. */
  min_clean_observations: 300,
  /** A same-time price mark older than this is not a clean control. */
  max_quote_age_ms: 10_000,
  /** The hypothetical entry rule, for economics only: buy the favourite at its ask when flow leans its way. */
  entry: Object.freeze({ min_ask: 80, max_ask_exclusive: 99 }),
  /** Reported alongside, never as the finding: labelled EXPLORATORY. */
  secondaries: Object.freeze(["OKX_PERP normalized delta, same span and clock", "spot and perp both leaning the same way"]),
  retire_if: "walk-forward incremental log loss <= 0 at the minimum sample: flow restates price",
});

const leanOf = (norm: number | null): "UP" | "DOWN" | null => (norm == null ? null : norm >= FLOW_H0.stance_threshold ? "UP" : norm <= -FLOW_H0.stance_threshold ? "DOWN" : null);

type Scored = { w: FlowWindow; mark: FlowMark; spot: FlowSpan; perp: FlowSpan };
function scoredWindows(windows: readonly FlowWindow[], idx: MinuteIndex): Scored[] {
  const { clock, span_minutes } = FLOW_H0.primary;
  const out: Scored[] = [];
  for (const w of windows) {
    const mark = w.marks[clock];
    if (!w.winner || !mark || mark.yes_mid == null || mark.quote_age_ms == null || mark.quote_age_ms > FLOW_H0.max_quote_age_ms) continue;
    const at = w.close_ms - clock * 1000;
    out.push({ w, mark, spot: flowSpan(idx, "COINBASE_SPOT", at, span_minutes), perp: flowSpan(idx, "OKX_PERP", at, span_minutes) });
  }
  return out;
}

function valueOf(rows: readonly Scored[], lean: (s: Scored) => "UP" | "DOWN" | null) {
  const obs: SignalObs[] = [];
  const control: Fill[] = [], rule: Fill[] = [];
  for (const s of rows) {
    const yes = s.mark.yes_mid! / 100;
    const fav: "UP" | "DOWN" = yes >= 0.5 ? "UP" : "DOWN";
    const l = lean(s);
    obs.push({ window: `${s.w.ticker}|${s.w.close_ms}`, close_ms: s.w.close_ms, fav_prob: Math.max(yes, 1 - yes), stance: l == null ? "SILENT" : l === fav ? "AGREE" : "OPPOSE", fav_won: s.w.winner === fav ? 1 : 0 });
    const ask = fav === "UP" ? s.mark.yes_ask : s.mark.no_ask ?? (s.mark.yes_bid != null ? round(100 - s.mark.yes_bid, 1) : null);
    if (ask != null && ask >= FLOW_H0.entry.min_ask && ask < FLOW_H0.entry.max_ask_exclusive) {
      const f: Fill = { side: fav, ask_cents: ask, fee_cents: takerFeeCents(ask), winner: s.w.winner, close_ms: s.w.close_ms };
      control.push(f);
      if (l === fav) rule.push(f);
    }
  }
  const mv = marginalValue(obs);
  return { mv, economics: { flow_rule: fillStats(rule), same_time_price_control: fillStats(control) } };
}

export function flowH0(windows: readonly FlowWindow[], idx: MinuteIndex) {
  const all = scoredWindows(windows, idx);
  const primary = all.filter((s) => s.spot.complete);
  const base = { h0: FLOW_H0, def: FLOW_DEF.id, clean_observations: primary.length };
  if (primary.length < FLOW_H0.min_clean_observations) {
    return { ...base, verdict: "INSUFFICIENT_SAMPLE" as const, note: `the test runs at ${FLOW_H0.min_clean_observations} clean settled windows (complete spot minutes and a fresh price mark at T-${FLOW_H0.primary.clock}s); collection quality comes first` };
  }
  const p = valueOf(primary, (s) => leanOf(s.spot.norm));
  const inc = p.mv.incremental_value.incremental_log_loss;
  const both = all.filter((s) => s.spot.complete && s.perp.complete);
  const perp = all.filter((s) => s.perp.complete);
  return {
    ...base,
    verdict: inc == null ? "INSUFFICIENT_SAMPLE" as const : inc <= 0 ? "RETIRE_CANDIDATE" as const : "INFORMATIVE_CANDIDATE" as const,
    marginal_value: p.mv,
    economics: { rule: "hypothetical: buy the favourite at its ask (80-99c) at T-3:00 when spot flow leans its way; taker fee applied", ...p.economics },
    exploratory: {
      hypothesis_kind: "EXPLORATORY" as const,
      variants_tested: 2,
      note: "secondaries are reported for context only; they cannot rescue or replace the primary verdict",
      perp: { n: perp.length, ...valueOf(perp, (s) => leanOf(s.perp.norm)).mv.incremental_value },
      spot_and_perp_agree: { n: both.length, ...valueOf(both, (s) => { const a = leanOf(s.spot.norm), b = leanOf(s.perp.norm); return a != null && a === b ? a : null; }).mv.incremental_value },
    },
    note: "INFORMATIVE_CANDIDATE only earns a frozen prospective shadow test; RETIRE_CANDIDATE means flow restates price. Neither changes production.",
  };
}

/** Collection quality per venue, then per clock: the first deliverable. */
export function flowQuality(minutes: readonly StoredMinute[], windows: readonly FlowWindow[], idx: MinuteIndex) {
  const venues = FLOW_VENUES.map((venue) => {
    const rs = minutes.filter((r) => r.venue === venue);
    if (!rs.length) return { venue, minutes_recorded: 0, first_minute: null, last_minute: null, coverage_pct: null, complete: 0, complete_pct: null, flags: [], median_trades_per_minute: null };
    const first = rs.reduce((a, r) => Math.min(a, r.minute_ms), Infinity), last = rs.reduce((a, r) => Math.max(a, r.minute_ms), -Infinity);
    const expected = (last - first) / MINUTE + 1;
    const flags = new Map<string, number>();
    for (const r of rs) for (const f of r.flags) flags.set(f, (flags.get(f) ?? 0) + 1);
    const n = rs.map((r) => r.n).sort((a, b) => a - b);
    const complete = rs.filter((r) => r.complete).length;
    return {
      venue, minutes_recorded: rs.length, first_minute: new Date(first).toISOString(), last_minute: new Date(last).toISOString(),
      coverage_pct: round((rs.length / expected) * 100), complete, complete_pct: round((complete / rs.length) * 100),
      flags: [...flags.entries()].sort((a, b) => b[1] - a[1]).map(([flag, k]) => ({ flag, n: k })), median_trades_per_minute: n[Math.floor(n.length / 2)]!,
    };
  });
  const settled = windows.filter((w) => w.winner);
  const by_clock = FLOW_CLOCKS.map((clock) => {
    const marked = settled.filter((w) => w.marks[clock]);
    const fresh = marked.filter((w) => { const a = w.marks[clock]!.quote_age_ms; return a != null && a <= FLOW_H0.max_quote_age_ms; });
    const spot = fresh.filter((w) => flowSpan(idx, "COINBASE_SPOT", w.close_ms - clock * 1000, FLOW_H0.primary.span_minutes).complete).length;
    const perp = fresh.filter((w) => flowSpan(idx, "OKX_PERP", w.close_ms - clock * 1000, FLOW_H0.primary.span_minutes).complete).length;
    return { clock, settled_windows: settled.length, marks: marked.length, fresh_marks: fresh.length, complete_spot_5m: spot, complete_perp_5m: perp };
  });
  return { population: "one-minute buckets per venue; windows with a price mark and settlement", def: FLOW_DEF.id, venues, by_clock };
}
