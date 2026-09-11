/**
 * The lab (server only): the desk's measuring instrument. It listens to
 * Kalshi's own feed — the BRTI settlement index, the order book, trades —
 * records everything event-level for replay, prices every window on the
 * settlement rule, runs the stale-quote study, samples the basis between
 * our spot feeds and the index, and hands the ledger a settlement receipt
 * per window so the rule itself is checked against every official result.
 * Nothing here trades. The council is not consulted.
 */
import { kalshiConfigured, kalshiKeyInfo } from "./kalshi-auth.server";
import { KalshiWs } from "./kalshi-ws.server";
import { Recorder } from "./lab-recorder.server";
import {
  FEED_TRUST_PRINTS,
  freshBrti,
  noteSettleFeed,
  pushBrti,
  quarterClose,
  settleFair,
  settlePrints,
  sigma1,
  trailingAvg,
  type BrtiState,
  type SettleFair,
} from "./brti";
import { missingCanonicalSide, sourceLagMs, takerOutcomeSide, tradeSourceMs } from "./kalshi-wire";
import { faultLine, mayWriteOfficial } from "./window-identity";
import {
  applyDelta,
  applySnapshot,
  bests,
  bookTrusted,
  freshBook,
  levelCount,
  markBookGap,
  priceCents,
  sameBests,
  tenths,
  yesView,
  type Bests,
  type LabBook,
} from "./lab-book";
import {
  freshTape2,
  onBookDelta,
  onTape2Trade,
  sampleTape2,
  tape2Features,
  type Tape2Features,
  type Tape2State,
} from "./tape2";
import { readClock } from "./clock";
import { vel2Features, type Vel2Features, type Vel2Sample } from "./vel2";
import type { PrintRecord } from "./absorption.server";
import {
  CLUSTER_MS,
  readPrint,
  whaleReport,
  type MidPoint,
  type Print,
  type WhaleReport,
} from "./whale2";
import {
  FAST_JUMP_MS,
  FILL_LATENCIES,
  fills,
  freshStudy,
  onBookBests,
  onDelta,
  onFair,
  onTick,
  onTrade,
  SHOCK_CENTS,
  type Shock,
  type StudyState,
} from "./lab-study";
import type { Snapshot } from "./types";

const REST_HOST = "https://api.elections.kalshi.com/trade-api/v2";
const TICKER_REST_MS = 30_000;
const KEEP_CLOSED_MS = 120_000;
const BRTI_FRESH_MS = 15_000;
const BASIS_MAX_AGE_MS = 4_000;

type Survival = { alive: number; total: number; edge_alive: number; edge_total: number; edge_net_sum: number };
type BasisAcc = {
  minute: number;
  session: string;
  bin: number;
  bin_abs: number;
  bin_n: number;
  cb: number;
  cb_abs: number;
  cb_n: number;
};

type Lab = {
  started: boolean;
  rec: Recorder | null;
  ws: KalshiWs | null;
  brti: BrtiState;
  books: Map<string, LabBook>;
  lastBests: Map<string, Bests>;
  study: StudyState;
  getSnap: () => Snapshot | null;
  fair: SettleFair | null;
  fairT: number;
  fairTicker: string;
  fairPre: Map<string, number>;
  tickerTimer: ReturnType<typeof setInterval> | null;
  secTimer: ReturnType<typeof setInterval> | null;
  backfillTimer: ReturnType<typeof setInterval> | null;
  backfilled: number;
  /** Official-value writes REFUSED because the payload contradicted the row. */
  backfillRefused: number;
  /** The last refusal, as an identity fault line. Survives the next unrelated error. */
  backfillRefusedLine: string | null;
  restAt: number;
  snapshotAt: number;
  restTickers: { ticker: string; close: number }[];
  basis: BasisAcc | null;
  basisSnapAt: number;
  receipts: { n: number; avg_ok: number; last_ok: number; partial: number; exact: number };
  survival: Map<number, Survival>;
  shocksDone: number;
  lastShocks: Shock[];
  persistErrors: number;
  lastError: string | null;
  /** Trade-direction provenance and feed lag, for WARDEN and research telemetry. */
  tradeClock: TradeClock;
  /** TAPE 2.0 microstructure state for the current window. Research only: no
   *  seat reads it, no skill exists for it, and it cannot reach the chair. */
  tape2: Tape2State;
  /** The ticker tape2 is accumulating for, so a new window starts clean. */
  tape2Ticker: string;
  /** Last computed feature set, for the lab panel and the replay. */
  tape2Last: Tape2Features | null;
  /** VEL 2.0 samples for the current window: spot, YES and the clock state that
   *  sets the contract's sensitivity. Research only. */
  vel2: Vel2Sample[];
  vel2Last: Vel2Features | null;
  /**
   * WHALE 2.0's raw material: real executions and the midpoint path they landed
   * in. Kept as prints rather than aggregates so impact can be measured at
   * horizons AFTER each one — an aggregate cannot be asked what happened next.
   */
  /**
   * Keyed by ticker, NOT a single current-window buffer.
   *
   * A window settles AFTER the snapshot has already rolled to the next one, so
   * a single buffer is wiped on the roll and the settle then finds nothing —
   * the prints are destroyed a moment before the only code that wanted them
   * runs. Replay learned this already and keeps a map; so does this. Entries
   * are deleted when written and pruned by age otherwise.
   */
  whale: Map<string, { prints: StampedPrint[]; marks: WhaleMark[]; t: number }>;
  /**
   * The last desk state the engine handed over, with when.
   *
   * The lab runs on the websocket; the seats, the regime and fair value are
   * computed on the brain tick. So a print's context is as of the last tick and
   * its AGE is recorded beside it — a read from four minutes ago is not a
   * reading of this moment, and a study that could not see the staleness would
   * treat it as one.
   */
  deskState: {
    t: number;
    drift: number | null;
    cascade: number | null;
    regime: string;
    fair_yes: number | null;
    dist: number | null;
    sigma: number | null;
  };
};

/** How trades are arriving: which direction field carried them, and how late. */
type TradeClock = {
  n: number;
  /** Carried the canonical taker_outcome_side. */
  canonical: number;
  /** Canonical field absent; parsed from the deprecated taker_side. */
  legacy: number;
  /** Neither field readable — direction unknown, never guessed. */
  unknown: number;
  /** Receipt minus exchange event time, summed over trades that carried one. */
  lag_sum_ms: number;
  lag_n: number;
  lag_max_ms: number;
  /** Trades with no exchange event time at all, so no lag can be claimed. */
  no_source_ts: number;
};

function freshTradeClock(): TradeClock {
  return { n: 0, canonical: 0, legacy: 0, unknown: 0, lag_sum_ms: 0, lag_n: 0, lag_max_ms: 0, no_source_ts: 0 };
}

const g = globalThis as typeof globalThis & { __desk_lab__?: Lab };

function lab(): Lab {
  g.__desk_lab__ ??= {
    started: false,
    rec: null,
    ws: null,
    brti: freshBrti(),
    books: new Map(),
    lastBests: new Map(),
    study: freshStudy(),
    getSnap: () => null,
    fair: null,
    fairT: 0,
    fairTicker: "",
    fairPre: new Map(),
    tickerTimer: null,
    secTimer: null,
    backfillTimer: null,
    backfilled: 0,
    backfillRefused: 0,
    backfillRefusedLine: null,
    restAt: 0,
    snapshotAt: 0,
    restTickers: [],
    basis: null,
    basisSnapAt: 0,
    receipts: { n: 0, avg_ok: 0, last_ok: 0, partial: 0, exact: 0 },
    survival: new Map(FILL_LATENCIES.map((L) => [L, { alive: 0, total: 0, edge_alive: 0, edge_total: 0, edge_net_sum: 0 }])),
    shocksDone: 0,
    lastShocks: [],
    persistErrors: 0,
    lastError: null,
    tradeClock: freshTradeClock(),
    tape2: freshTape2(),
    tape2Ticker: "",
    tape2Last: null,
    vel2: [],
    vel2Last: null,
    whale: new Map(),
    deskState: { t: 0, drift: null, cascade: null, regime: "", fair_yes: null, dist: null, sigma: null },
  };
  return g.__desk_lab__;
}

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  hour12: false,
});

/** "wk-09" / "wkd-21": New York weekday-or-weekend plus hour. */
export function sessionTag(t: number): string {
  let wd = "";
  let hh = "";
  for (const p of nyFmt.formatToParts(new Date(t))) {
    if (p.type === "weekday") wd = p.value;
    if (p.type === "hour") hh = p.value;
  }
  const weekend = wd === "Sat" || wd === "Sun";
  return `${weekend ? "wkd" : "wk"}-${hh === "24" ? "00" : hh}`;
}

export function startLab(getSnap: () => Snapshot | null): void {
  const L = lab();
  if (L.started) return;
  L.started = true;
  L.getSnap = getSnap;
  L.rec = new Recorder();
  if (!kalshiConfigured()) {
    console.log("[lab] no Kalshi API key found — trying an unsigned connection (Kalshi may refuse it)");
  }
  L.ws = new KalshiWs((type, msg, raw, t) => {
    try {
      onWsMessage(L, type, msg, raw, t);
    } catch (err) {
      L.lastError = `ws ${type}: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
  L.ws.start();
  L.tickerTimer = setInterval(() => void refreshTickers(L), 5_000);
  L.tickerTimer.unref?.();
  L.secTimer = setInterval(() => {
    try {
      secondTick(L);
    } catch (err) {
      L.lastError = `tick: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, 1_000);
  L.secTimer.unref?.();
  L.backfillTimer = setInterval(() => void backfillOfficial(L), BACKFILL_MS);
  L.backfillTimer.unref?.();
  void refreshTickers(L);
  setTimeout(() => void backfillOfficial(L), 20_000).unref?.();
}

const BACKFILL_MS = 5 * 60_000;

/** Kalshi publishes the official settled average (`expiration_value`) on
 *  each finished market. Windows graded before it was available get it
 *  filled in here, so every ledger row can be checked against Kalshi's
 *  own number. Public endpoint, a few tickers per pass. */
async function backfillOfficial(L: Lab): Promise<void> {
  try {
    const db = await sql();
    // BOTH halves of the row's identity. `desk_ledger` is unique on
    // (ticker, close_time) — migration 0005 — so a ticker is NOT a row, and on
    // 2026-09-10 nine rows shared one. Selecting the ticker alone made the narrow
    // write below impossible to express.
    const rows = await db<{ ticker: string; close_ms: string | number }>`
      select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms
        from desk_ledger
       where official_value is null and close_time < now() - interval '3 minutes'
       order by close_time desc limit 4
    `;
    if (!rows.length) return;
    const host = L.getSnap()?.kalshi_host || REST_HOST;
    for (const row of rows) {
      const ticker = row.ticker;
      const closeMs = Number(row.close_ms);
      try {
        const r = await fetch(`${host}/markets/${encodeURIComponent(ticker)}`, {
          signal: AbortSignal.timeout(4_000),
          headers: { accept: "application/json", "user-agent": "SatoshiCouncil/1.0 (paper research)" },
        });
        if (!r.ok) continue;
        const j = (await r.json()) as { market?: Record<string, unknown> };
        const m = j.market ?? {};
        const v = Number(m.expiration_value);
        if (!Number.isFinite(v) || v <= 0) continue;
        // The same invariant grading goes through since #133, now on the one write
        // that did not. A payload that contradicts the row is refused, loudly and
        // durably, and the row stays null — it is not guessed at, and the next pass
        // will ask again.
        const verdict = mayWriteOfficial(ticker, closeMs, {
          ticker: typeof m.ticker === "string" ? m.ticker : undefined,
          close_ms: Date.parse(String(m.close_time ?? m.expiration_time ?? "")) || 0,
        });
        if (!verdict.ok) {
          L.backfillRefused += 1;
          L.backfillRefusedLine = faultLine(ticker, closeMs, verdict.fault, verdict.detail);
          L.lastError = `backfill refused: ${L.backfillRefusedLine}`;
          continue;
        }
        // Exactly one row: both halves of the identity, and still only when the
        // value is absent, so an already-recorded official is never overwritten.
        await db`
          update desk_ledger set official_value = ${v}
           where ticker = ${ticker}
             and close_time = ${new Date(closeMs).toISOString()}
             and official_value is null
        `;
        L.backfilled += 1;
      } catch {
        /* next ticker; the timer comes back */
      }
    }
  } catch (err) {
    L.lastError = `backfill: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function currentTicker(L: Lab): string {
  return L.getSnap()?.ticker ?? "";
}

async function refreshTickers(L: Lab): Promise<void> {
  const now = Date.now();
  const snap = L.getSnap();
  if (now - L.restAt > TICKER_REST_MS) {
    L.restAt = now;
    try {
      const host = snap?.kalshi_host || REST_HOST;
      const r = await fetch(`${host}/markets?status=open&series_ticker=KXBTC15M&limit=3`, {
        signal: AbortSignal.timeout(4_000),
        headers: { accept: "application/json", "user-agent": "SatoshiCouncil/1.0 (paper research)" },
      });
      if (r.ok) {
        const j = (await r.json()) as { markets?: Record<string, unknown>[] };
        const fresh = (j.markets ?? [])
          .map((m) => ({
            ticker: String(m.ticker ?? ""),
            close: Date.parse(String(m.close_time ?? m.expiration_time ?? "")) || 0,
          }))
          .filter((m) => m.ticker);
        const keep = L.restTickers.filter((m) => !fresh.some((f) => f.ticker === m.ticker));
        L.restTickers = [...fresh, ...keep];
      }
    } catch {
      /* the engine's own ticker still drives subscriptions */
    }
  }
  if (now - L.snapshotAt > 60_000) {
    L.snapshotAt = now;
    L.ws?.requestSnapshot();
  }
  L.restTickers = L.restTickers.filter((m) => !m.close || m.close > now - KEEP_CLOSED_MS);
  const list = new Set<string>(L.restTickers.map((m) => m.ticker));
  if (snap?.ticker) list.add(snap.ticker);
  if (snap?.close_time && snap.close_time > now - KEEP_CLOSED_MS) list.add(snap.ticker);
  for (const [tk, b] of L.books) {
    if (!list.has(tk) && now - b.upd_t > KEEP_CLOSED_MS * 2) {
      L.books.delete(tk);
      L.lastBests.delete(tk);
    }
  }
  L.ws?.setTickers([...list]);
}

function book(L: Lab, ticker: string): LabBook {
  let b = L.books.get(ticker);
  if (!b) {
    // Shape 0 of the orderbook subscription is use_yes_price: true.
    b = freshBook(ticker, L.ws?.variantOf("orderbook_delta") !== 1);
    L.books.set(ticker, b);
  }
  return b;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function tsMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && v.trim() !== "") return n < 1e11 ? n * 1000 : n;
    const p = Date.parse(v);
    if (Number.isFinite(p)) return p;
  }
  return 0;
}

/** Book deltas within this many cents of the same side's best are recorded;
 *  deeper churn (the 0.1¢ bids of a bot farm, hundreds a second) is counted
 *  and dropped. A minute-by-minute snapshot re-anchors any replay. */
const RECORD_BAND_CENTS = 15;

function onWsMessage(L: Lab, type: string, msg: Record<string, unknown>, raw: Record<string, unknown>, t: number): void {
  const sid = raw.sid;
  const seq = raw.seq;
  const meta = sid != null || seq != null ? { sid, seq } : undefined;
  if (type !== "orderbook_delta") L.rec?.write(type, msg, t, meta);
  switch (type) {
    case "orderbook_snapshot": {
      const tk = String(msg.market_ticker ?? "");
      if (!tk) return;
      const b = book(L, tk);
      // A snapshot always follows a (re)subscribe: refresh the wire convention.
      b.yesLeg = L.ws?.variantOf("orderbook_delta") !== 1;
      applySnapshot(b, msg, t);
      afterBook(L, tk, b, t);
      return;
    }
    case "orderbook_delta": {
      const tk = String(msg.market_ticker ?? "");
      if (!tk) return;
      const b = book(L, tk);
      const before = L.lastBests.get(tk);
      const d = applyDelta(b, msg, t);
      if (d && tk === currentTicker(L) && bookTrusted(b)) {
        onDelta(L.study, d.side, d.price, d.size, t);
        // TAPE 2.0 sees the same delta in YES space: a NO-side level is an ASK
        // here, so positive imbalance always means pressure toward UP. Only ADD
        // and CANCEL are recorded — a vanished quote is never called a trade.
        const yesSide = d.side === "yes" ? "bid" : "ask";
        const yesPrice = d.side === "yes" ? d.price : tenths(100 - d.price);
        onBookDelta(L.tape2, yesSide, yesPrice, d.delta, d.size, t);
      }
      afterBook(L, tk, b, t);
      const after = L.lastBests.get(tk);
      const bestSame = before ? (d?.side === "yes" ? before.yes_bid : before.no_bid) : 0;
      const nearTop = !d || !bestSame || Math.abs(d.price - bestSame) <= RECORD_BAND_CENTS || after !== before;
      if (L.rec) {
        if (nearTop && !L.rec.lowDisk) L.rec.write(type, msg, t, meta);
        else L.rec.skipped += 1;
      }
      return;
    }
    case "trade": {
      const tk = String(msg.market_ticker ?? "");
      if (tk !== currentTicker(L)) return;
      // Direction off the canonical field, with the deprecated name as a
      // fallback only; an unreadable aggressor stays unknown rather than being
      // counted as a YES buyer. The exchange's own event time is kept apart
      // from our receipt time so feed lag stays visible as lag.
      const side = takerOutcomeSide(msg);
      noteTradeClock(L, msg, side, t);
      // Executions are accounted separately from book flow, on purpose.
      const count = Number(msg.count_fp ?? msg.count) || 0;
      if (side) onTape2Trade(L.tape2, side, count, t);
      // WHALE 2.0 keeps the print itself. The aggressor's outcome side IS the
      // direction they pushed: a taker who bought YES lifted the offer.
      if (side && count > 0) noteWhalePrint(L, side === "yes" ? "UP" : "DOWN", count, t);
      onTrade(L.study, {
        t,
        yes_price: priceCents(msg.yes_price ?? msg.yes_price_dollars),
        no_price: priceCents(msg.no_price ?? msg.no_price_dollars),
        taker_side: side ?? "",
      });
      return;
    }
    case "__gap": {
      if (String(msg.channel) !== "orderbook_delta") return;
      // At least one delta was missed, so every reconstructed book may hold
      // levels that no longer exist. Quarantine them all until a fresh
      // snapshot re-anchors, and ask for that snapshot now.
      for (const b of L.books.values()) markBookGap(b, t);
      L.ws?.resubscribe("orderbook_delta");
      return;
    }
    default:
      if (type === "cfbenchmarks_value" || type === "cfbenchmarks_value_5hz") onBrti(L, type, msg, t);
  }
}

/** Per the docs: the per-second channel carries the vendor frame as a JSON
 *  string in `data` ({id, time, value}) plus `avg_60s_data` and, in the final
 *  minute before a quarter-hour close, `last_60s_windowed_average_15min`
 *  ({value, window_size}); the 5 Hz channel carries `value_usd` and
 *  `source_ts_ms` and no averages. `received_at` is Kalshi's receipt time. */
function onBrti(L: Lab, type: string, msg: Record<string, unknown>, t: number): void {
  const id = String(msg.index_id ?? msg.id ?? "").toUpperCase();
  if (id && id !== "BRTI") return;
  let v = num(msg.value_usd ?? msg.value);
  let src = tsMs(msg.source_ts_ms ?? msg.time);
  if (typeof msg.data === "string") {
    try {
      const d = JSON.parse(msg.data) as Record<string, unknown>;
      if (!Number.isFinite(v)) v = num(d.value);
      if (!src) src = tsMs(d.time);
    } catch {
      /* raw frame unreadable — the top-level fields still count */
    }
  }
  if (!Number.isFinite(v)) return;
  const isPrint = type === "cfbenchmarks_value";
  pushBrti(L.brti, v, t, src, isPrint, tsMs(msg.received_at));
  if (isPrint) {
    const a60 = msg.avg_60s_data as Record<string, unknown> | undefined;
    if (a60 && typeof a60 === "object") {
      const av = num(a60.value);
      if (Number.isFinite(av)) L.brti.avg60_feed = av;
    }
    const sw = msg.last_60s_windowed_average_15min as Record<string, unknown> | undefined;
    if (sw && typeof sw === "object") noteSettleFeed(L.brti, num(sw.value), Number(sw.window_size), src || t, t);
    else if (L.brti.settle_live && t - L.brti.settle_live.t > 5_000) L.brti.settle_live = null;
  }
  recomputeFair(L, t);
}

/** The lab's current settlement fair for a ticker in yes-cents, or null
 *  when the lab has none fresh enough (30 s). Read by the window replay. */
export function labFairNow(ticker: string): number | null {
  const L = lab();
  if (!L.fair || L.fairTicker !== ticker || Date.now() - L.fairT > 30_000) return null;
  return Math.round(L.fair.p_up * 1000) / 10;
}

export type LabFairState = { yes_cents: number; locked: number; age_s: number; mean: number; sd: number };

/** The settlement-rule fair value as the INDEX seat reads it: YES cents, locked final-minute prints, and its age. */
export function labFairState(ticker: string): LabFairState | null {
  const L = lab();
  if (!L.fair || L.fairTicker !== ticker) return null;
  const age = (Date.now() - L.fairT) / 1000;
  if (age > 30) return null;
  return {
    yes_cents: Math.round(L.fair.p_up * 1000) / 10,
    locked: Math.max(0, Math.min(60, Math.round(L.fair.k))),
    age_s: Math.round(age * 10) / 10,
    mean: L.fair.mean,
    sd: L.fair.sd,
  };
}

function fairYesCents(L: Lab): number {
  return L.fair ? L.fair.p_up * 100 : 50;
}

function recomputeFair(L: Lab, t: number): void {
  const snap = L.getSnap();
  if (!snap || !(snap.strike > 0) || !(snap.close_time > 0) || !snap.ticker) return;
  const secsLeft = (snap.close_time - t) / 1000;
  if (secsLeft < -5) return;
  const fallback = snap.atr > 0 ? snap.atr / Math.sqrt(60) : (0.5 / 1e4) * L.brti.last;
  const sig1 = sigma1(L.brti, fallback);
  const fair = settleFair(L.brti, snap.strike, snap.close_time, t, sig1);
  if (L.fairTicker !== snap.ticker) {
    L.fairTicker = snap.ticker;
    L.study = freshStudy();
  }
  L.fair = fair;
  L.fairT = t;
  if (secsLeft <= 61.5 && secsLeft > 55 && !L.fairPre.has(snap.ticker)) L.fairPre.set(snap.ticker, fair.p_up);
  const b = L.books.get(snap.ticker);
  // A book that has missed a sequence number is not evidence. The fair value
  // above still stands (it is BRTI-derived, not book-derived), but nothing
  // priced off these levels enters the study until a snapshot re-anchors.
  if (!bookTrusted(b)) return;
  const bs = L.lastBests.get(snap.ticker) ?? bests(b);
  const fy = fair.p_up * 100;
  onFair(L.study, fy, t, bs, {
    ticker: snap.ticker,
    secs_left: Math.round(secsLeft * 10) / 10,
    final_minute: secsLeft <= 60,
    session: sessionTag(t),
  });
  finishShocks(L, onTick(L.study, fy, t));
}

/**
 * Sample the microstructure state once a second. A new window resets it, because
 * depth, persistence and flow from the previous contract say nothing about this
 * one. Skipped entirely while the book is quarantined: a book that has missed a
 * delta would produce confident nonsense.
 */
function sampleTape2Now(L: Lab, t: number): void {
  const tk = currentTicker(L);
  if (!tk) return;
  if (L.tape2Ticker !== tk) {
    L.tape2 = freshTape2();
    L.tape2Ticker = tk;
    L.tape2Last = null;
    L.vel2 = [];
    L.vel2Last = null;
  }
  const b = L.books.get(tk);
  if (!bookTrusted(b)) return;
  const view = yesView(b);
  sampleTape2(L.tape2, view, t);
  L.tape2Last = tape2Features(L.tape2, view, t);
  sampleVel2Now(L, view, t);
  // The midpoint path WHALE 2.0 measures each print against. Sampled on the
  // same trusted-book path as everything else, so a dark feed leaves a gap
  // rather than a flat line that would read as absorption.
  noteWhaleMid(L, t);
}

/**
 * One VEL 2.0 sample a second: BTC, the YES midpoint, and the clock state that
 * sets how much the contract SHOULD move per dollar of BTC. The distance and
 * sigma come from readClock, the same model the chair's own fair value uses, so
 * the expected response is not a second opinion invented here.
 *
 * The noise floor for "BTC moved" is a fraction of sigma rather than a fixed
 * number of dollars, because a dollar means something different in a quiet
 * window than in a violent one.
 */
function sampleVel2Now(L: Lab, view: ReturnType<typeof yesView>, t: number): void {
  const snap = L.getSnap();
  if (!snap || snap.ticker !== L.tape2Ticker) return;
  const bid = view.bids[0]?.price ?? 0;
  const ask = view.asks[0]?.price ?? 0;
  if (!(bid > 0) || !(ask > 0) || !(snap.spot > 0)) return;
  const c = readClock(snap);
  L.vel2.push({ t, spot: snap.spot, yes: (bid + ask) / 2, dist: c.dist, sigma: c.sigma });
  // 60s is the longest horizon; keep a little slack and cap the array.
  const cutoff = t - 75_000;
  L.vel2 = L.vel2.filter((x) => x.t >= cutoff).slice(-200);
  L.vel2Last = vel2Features(L.vel2, t, Math.max(1, 0.15 * c.sigma));
}

/** The current expected-response residuals, or null when none measured. Research only. */
export function vel2Now(ticker: string): Vel2Features | null {
  const L = lab();
  return L.tape2Ticker === ticker ? L.vel2Last : null;
}

/**
 * The engine's latest window state, for the absorption study's conditioning
 * tests. Called on the brain tick; never read back into a decision.
 */
export function noteDeskState(st: {
  t: number;
  drift: number | null;
  cascade: number | null;
  regime: string;
  fair_yes: number | null;
  dist: number | null;
  sigma: number | null;
}): void {
  lab().deskState = st;
}

/**
 * A print with the state of the world AT THE MOMENT IT LANDED.
 *
 * The context has to be captured here and not at settle. The first version read
 * the lab's live state when the window closed, so all 501 prints of a window
 * carried one identical order-flow reading, one regime, one spread and one
 * distance — the conditioning tests, which are the point of the study, were
 * every one of them reading a single constant. Worse, the fields that depend on
 * per-window buffers came back empty, because the ticker had already rolled.
 */
type StampedPrint = Print & {
  ofi_norm: number | null;
  spread: number | null;
  depth: number | null;
  touch: number | null;
  dist: number | null;
  sigma: number | null;
  fair_yes: number | null;
  vel_resid: number | null;
  drift_ev: number | null;
  cascade_ev: number | null;
  seat_age_ms: number | null;
  regime: string;
};

/** One instant of the window: the midpoint a print is measured against, and BTC beside it. */
type WhaleMark = MidPoint & { spot: number | null };

/** How long a print and its midpoint path are kept. Long enough to outlive the follow horizon. */
const WHALE_KEEP_MS = 120_000;
/** A window's buffer is dropped this long after its last activity if it never settled. */
const WHALE_WINDOW_KEEP_MS = 60 * 60_000;
/** At most one midpoint mark per this, so a busy book does not fill memory. */
const WHALE_MID_MS = 500;
const WHALE_MAX = 4_000;

/**
 * Record an execution with the midpoint it landed in. The midpoint is taken
 * BEFORE the book has refilled, which is the price the aggressor actually
 * moved away from; impact is then measured against the book a moment later.
 */
function noteWhalePrint(L: Lab, side: "UP" | "DOWN", size: number, t: number): void {
  const tk = currentTicker(L);
  const mid = whaleMidNow(L);
  if (!tk || mid == null) return;
  const b = L.books.get(tk);
  const view = b && bookTrusted(b) ? yesView(b) : null;
  // The size a taker on this side had to get through, and the depth behind it.
  // An order small against the visible book has a mechanical reason not to move
  // it, and the study must be able to tell that apart from absorption.
  const touchLevel = view ? (side === "UP" ? view.asks[0] : view.bids[0]) : null;
  const depth = view
    ? [...view.bids.slice(0, 5), ...view.asks.slice(0, 5)].reduce((a, l) => a + l.size, 0)
    : null;
  const d = L.deskState;
  const w = whaleFor(L, tk, t);
  w.prints.push({
    t,
    side,
    size,
    mid,
    ofi_norm: L.tape2Last?.ofi_norm_15s ?? null,
    spread: L.tape2Last?.spread ?? null,
    depth,
    touch: touchLevel && touchLevel.size > 0 ? touchLevel.size : null,
    dist: d.dist,
    sigma: d.sigma,
    fair_yes: d.fair_yes,
    vel_resid: L.vel2Last?.h30.ok ? L.vel2Last.h30.residual : null,
    drift_ev: d.drift,
    cascade_ev: d.cascade,
    // How old the desk's read was when this print landed. Not clamped at zero:
    // a negative value would mean the state arrived after the print, which is a
    // fault worth seeing rather than hiding behind a 0.
    seat_age_ms: d.t ? Math.round(t - d.t) : null,
    regime: d.regime,
  });
  if (w.prints.length > WHALE_MAX) w.prints = w.prints.slice(-WHALE_MAX);
}

/** This ticker's buffer, creating it and pruning stale windows on the way. */
function whaleFor(L: Lab, tk: string, t: number): { prints: StampedPrint[]; marks: WhaleMark[]; t: number } {
  let w = L.whale.get(tk);
  if (!w) {
    // A window that never settled (a restart mid-window, a feed outage) would
    // otherwise sit here forever.
    for (const [k, v] of L.whale) if (t - v.t > WHALE_WINDOW_KEEP_MS) L.whale.delete(k);
    w = { prints: [], marks: [], t };
    L.whale.set(tk, w);
  }
  w.t = t;
  return w;
}

/** The YES midpoint from the local book right now, or null when it cannot be trusted. */
function whaleMidNow(L: Lab): number | null {
  const tk = currentTicker(L);
  const b = tk ? L.books.get(tk) : null;
  if (!b || !bookTrusted(b)) return null;
  const bs = bests(b);
  if (!(bs.yes_bid > 0) || !(bs.yes_ask > 0)) return null;
  return Math.round(((bs.yes_bid + bs.yes_ask) / 2) * 10) / 10;
}

/** Sample the midpoint so every print has a path to be measured against. */
function noteWhaleMid(L: Lab, t: number): void {
  const tk = currentTicker(L);
  if (!tk) return;
  const w = whaleFor(L, tk, t);
  const last = w.marks[w.marks.length - 1];
  if (last && t - last.t < WHALE_MID_MS) return;
  const mid = whaleMidNow(L);
  if (mid == null) return;
  // BTC is kept on the same mark as the midpoint so "nothing happened" can be
  // told apart from "nothing happened HERE". Held per window, because the VEL
  // sample buffer is cleared on the ticker roll and would be empty at settle.
  w.marks.push({ t, mid, spot: L.vel2[L.vel2.length - 1]?.spot ?? null });
  if (w.marks.length > WHALE_MAX) w.marks = w.marks.slice(-WHALE_MAX);
}

/**
 * Measure every print this window held, for the prospective absorption study.
 *
 * Called once at settle, when the whole midpoint path exists — a print cannot
 * be measured at the moment it lands, because the thing being measured is what
 * happened for the next sixty seconds. Each print is ranked only against the
 * sizes recorded BEFORE it, so a later print never decides whether an earlier
 * one was large.
 *
 * Nothing is classified here. No "large", no "absorbed": those are decided at
 * read time from frozen bands, and a recorder that applied them would have to
 * be re-run to change one.
 */
export function whalePrintRecords(ticker: string, closeMs: number): PrintRecord[] {
  const L = lab();
  // Looked up by ticker, never against the CURRENT one: by the time a window
  // settles the desk has already moved to the next, and a currentness check
  // here would reject every window exactly when it is ready to be written.
  const w = L.whale.get(ticker);
  if (!w || !w.prints.length) return [];
  const clustered = clusterStamped(w.prints);
  const out: PrintRecord[] = [];
  for (let i = 0; i < clustered.length; i++) {
    const c = clustered[i]!;
    const before = clustered.slice(0, i).map((x) => x.size);
    const r = readPrint(c, w.marks, before);
    out.push({
      ticker,
      close_time: closeMs,
      t: c.t,
      side: c.side,
      cluster_n: c.prints,
      size: c.size,
      size_pctile: r.pctile,
      // Every field below comes from the print's OWN stamp, taken when it
      // landed. Reading the lab's live state here would give one identical
      // value to every print in the window — which is exactly what the first
      // version did, and it made all ten conditioning tests meaningless.
      size_vs_touch: c.touch && c.touch > 0 ? round3(c.size / c.touch) : null,
      size_vs_depth: c.depth && c.depth > 0 ? round3(c.size / c.depth) : null,
      impact_2s: r.impact,
      impact_per_100: r.impact_per_100,
      move_5s: midMoveOver(w.marks, c, 5_000),
      move_15s: midMoveOver(w.marks, c, 15_000),
      move_30s: midMoveOver(w.marks, c, 30_000),
      move_60s: midMoveOver(w.marks, c, 60_000),
      btc_5s: btcMoveOver(w.marks, c.t, 5_000),
      btc_15s: btcMoveOver(w.marks, c.t, 15_000),
      btc_30s: btcMoveOver(w.marks, c.t, 30_000),
      btc_60s: btcMoveOver(w.marks, c.t, 60_000),
      ofi_norm: c.ofi_norm,
      replenished: r.replenished,
      spread: c.spread,
      depth: c.depth,
      dist: c.dist,
      sigma: c.sigma,
      secs_left: closeMs > c.t ? Math.round((closeMs - c.t) / 100) / 10 : 0,
      market_prob_up: c.mid,
      regime: c.regime,
      fair_yes: c.fair_yes,
      vel_resid: c.vel_resid,
      drift_ev: c.drift_ev,
      cascade_ev: c.cascade_ev,
      seat_age_ms: c.seat_age_ms,
    });
  }
  return out;
}

/**
 * Cluster same-side prints, carrying the FIRST print's context forward.
 *
 * A burst is one decision, made when it starts, so the state that decision was
 * taken against is the state at its first print. Averaging the context across a
 * burst would invent a reading nobody ever saw.
 */
function clusterStamped(prints: readonly StampedPrint[]): (StampedPrint & { prints: number })[] {
  const sorted = [...prints].sort((a, b) => a.t - b.t);
  const out: (StampedPrint & { prints: number })[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last.side === p.side && p.t - last.t <= CLUSTER_MS) {
      last.size += p.size;
      last.prints += 1;
      continue;
    }
    out.push({ ...p, prints: 1 });
  }
  return out;
}

/** Midpoint move over a horizon, signed the aggressor's way. Null when unmeasurable. */
function midMoveOver(marks: readonly WhaleMark[], c: { t: number; side: "UP" | "DOWN"; mid: number }, ms: number): number | null {
  const later = marks.find((m) => m.t >= c.t + ms && m.t <= c.t + ms + 5_000);
  if (!later) return null;
  return Math.round((later.mid - c.mid) * (c.side === "UP" ? 1 : -1) * 100) / 100;
}

/**
 * BTC move over the same horizon, in dollars, so a flat contract can be told
 * apart from a flat market. Read off the window's own marks: the VEL sample
 * buffer is cleared on the ticker roll and is empty by the time a window
 * settles, which is why this field came back null for every print.
 */
function btcMoveOver(marks: readonly WhaleMark[], t: number, ms: number): number | null {
  const at = marks.find((m) => m.spot != null && m.t >= t - 2_000 && m.t <= t + 2_000);
  const later = marks.find((m) => m.spot != null && m.t >= t + ms && m.t <= t + ms + 5_000);
  if (!at || !later) return null;
  return Math.round((later.spot! - at.spot!) * 100) / 100;
}

const round3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

/**
 * Discard a window's buffer once its prints are safely written.
 *
 * Kept separate from reading them: a read that is followed by a failed write
 * must not lose the data, so only the caller that knows the write succeeded
 * calls this. Without it a settled window lingers until the hourly prune and
 * `whale2Now` keeps answering with a book that is finished.
 */
export function forgetWhaleWindow(ticker: string): void {
  lab().whale.delete(ticker);
}

/**
 * WHALE 2.0's read of the prints held for this window. Each print is ranked
 * against the sizes recorded BEFORE it — ranking against the whole window would
 * let a later print decide whether an earlier one was large.
 */
export function whale2Now(ticker: string): WhaleReport | null {
  const L = lab();
  const w = L.whale.get(ticker);
  if (!w || !w.prints.length) return null;
  const clustered = clusterStamped(w.prints);
  const reads = clustered.map((c, i) => readPrint(c, w.marks, clustered.slice(0, i).map((x) => x.size)));
  return whaleReport(reads, w.prints.length);
}

/** The current microstructure features, or null when none have been measured. Research only. */
export function tape2Now(ticker: string): Tape2Features | null {
  const L = lab();
  return L.tape2Ticker === ticker ? L.tape2Last : null;
}

/** Record how this trade's direction arrived and how late it was. Telemetry only. */
function noteTradeClock(L: Lab, msg: Record<string, unknown>, side: "yes" | "no" | null, t: number): void {
  const c = L.tradeClock;
  c.n += 1;
  if (side == null) c.unknown += 1;
  else if (missingCanonicalSide(msg)) c.legacy += 1;
  else c.canonical += 1;
  const lag = sourceLagMs(tradeSourceMs(msg), t);
  if (lag == null) c.no_source_ts += 1;
  else {
    c.lag_n += 1;
    c.lag_sum_ms += lag;
    if (lag > c.lag_max_ms) c.lag_max_ms = lag;
  }
}

function afterBook(L: Lab, tk: string, b: LabBook, t: number): void {
  if (tk !== currentTicker(L)) return;
  const nb = bests(b);
  const prev = L.lastBests.get(tk);
  if (prev && sameBests(prev, nb)) return;
  L.lastBests.set(tk, nb);
  if (L.fair && L.fairTicker === tk && bookTrusted(b)) onBookBests(L.study, nb, fairYesCents(L), t);
}

function secondTick(L: Lab): void {
  const t = Date.now();
  sampleTape2Now(L, t);
  if (L.fair && t - L.brti.last_t < BRTI_FRESH_MS) finishShocks(L, onTick(L.study, fairYesCents(L), t));
  sampleBasis(L, t);
}

function finishShocks(L: Lab, done: Shock[]): void {
  for (const s of done) {
    const f = fills(s);
    for (const [Lms, acc] of L.survival) {
      const hit = f[Lms as (typeof FILL_LATENCIES)[number]];
      acc.total += 1;
      if (hit) acc.alive += 1;
      if (s.net_edge > 0) {
        acc.edge_total += 1;
        if (hit) {
          acc.edge_alive += 1;
          acc.edge_net_sum += s.net_edge;
        }
      }
    }
    L.shocksDone += 1;
    L.lastShocks = [s, ...L.lastShocks].slice(0, 20);
    void persistShock(L, s, f);
  }
}

async function persistShock(L: Lab, s: Shock, f: ReturnType<typeof fills>): Promise<void> {
  try {
    const db = await sql();
    await db`
      insert into desk_lag_events
        (ticker, t, session, secs_left, final_minute, side, fair_before, fair_after, ask_before, ask_size,
         misprice, fee, net_edge, gone_ms, gone_how,
         markout_100, markout_250, markout_500, markout_1000,
         fill_50, fill_100, fill_150, fill_200, fill_300, fill_500, jump_ms, book_age_ms)
      values
        (${s.ticker}, ${new Date(s.t0).toISOString()}, ${s.session}, ${s.secs_left}, ${s.final_minute}, ${s.side},
         ${s.fair_before}, ${s.fair_after}, ${s.ask_before}, ${s.ask_size},
         ${s.misprice}, ${s.fee}, ${s.net_edge}, ${s.gone_ms}, ${s.gone_how},
         ${s.markouts[100] ?? null}, ${s.markouts[250] ?? null}, ${s.markouts[500] ?? null}, ${s.markouts[1000] ?? null},
         ${f[50]}, ${f[100]}, ${f[150]}, ${f[200]}, ${f[300]}, ${f[500]}, ${s.jump_ms}, ${s.book_age_ms})
    `;
  } catch (err) {
    L.persistErrors += 1;
    L.lastError = `persist shock: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function venueOf(src: string): "bin" | "cb" | null {
  const s = src.toLowerCase();
  if (s.includes("binance")) return "bin";
  if (s.includes("coinbase")) return "cb";
  return null;
}

function sampleBasis(L: Lab, t: number): void {
  const snap = L.getSnap();
  if (!snap || snap.as_of === L.basisSnapAt) return;
  L.basisSnapAt = snap.as_of;
  const brti = L.brti.last;
  if (!(brti > 0) || t - L.brti.last_t > BASIS_MAX_AGE_MS) return;
  const minute = Math.floor(t / 60_000) * 60_000;
  if (L.basis && L.basis.minute !== minute) void flushBasis(L, L.basis);
  if (!L.basis || L.basis.minute !== minute) {
    L.basis = { minute, session: sessionTag(t), bin: 0, bin_abs: 0, bin_n: 0, cb: 0, cb_abs: 0, cb_n: 0 };
  }
  const acc = L.basis;
  const add = (px: number, src: string) => {
    const v = venueOf(src);
    if (!v || !(px > 0)) return;
    const bps = ((px - brti) / brti) * 1e4;
    if (v === "bin") {
      acc.bin += bps;
      acc.bin_abs += Math.abs(bps);
      acc.bin_n += 1;
    } else {
      acc.cb += bps;
      acc.cb_abs += Math.abs(bps);
      acc.cb_n += 1;
    }
  };
  if (snap.spot_age_s <= 6) add(snap.spot, snap.spot_source);
  add(snap.spot_backup, snap.spot_backup_source);
}

async function flushBasis(L: Lab, acc: BasisAcc): Promise<void> {
  if (!acc.bin_n && !acc.cb_n) return;
  try {
    const db = await sql();
    await db`
      insert into desk_basis_minutes
        (minute, session, n, binance_bps, binance_abs_bps, coinbase_bps, coinbase_abs_bps, brti_sigma1)
      values
        (${new Date(acc.minute).toISOString()}, ${acc.session}, ${acc.bin_n + acc.cb_n},
         ${acc.bin_n ? acc.bin / acc.bin_n : null}, ${acc.bin_n ? acc.bin_abs / acc.bin_n : null},
         ${acc.cb_n ? acc.cb / acc.cb_n : null}, ${acc.cb_n ? acc.cb_abs / acc.cb_n : null},
         ${sigma1(L.brti, 0) || null})
      on conflict (minute) do update set
        n = excluded.n, binance_bps = excluded.binance_bps, binance_abs_bps = excluded.binance_abs_bps,
        coinbase_bps = excluded.coinbase_bps, coinbase_abs_bps = excluded.coinbase_abs_bps,
        brti_sigma1 = excluded.brti_sigma1
    `;
  } catch (err) {
    L.persistErrors += 1;
    L.lastError = `persist basis: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export type SettleReceipt = {
  settle_avg: number | null;
  settle_last: number | null;
  brti_prints: number;
  settle_gap: number | null;
  fair_pre: number | null;
  rule_avg_ok: boolean | null;
  rule_last_ok: boolean | null;
  settle_feed: number | null;
  settle_feed_n: number | null;
  official_value: number | null;
};

/** Called by the ledger at grade time: what the settlement index did in the
 *  window's final minute — our own 1-Hz average, Kalshi's streamed
 *  accumulating average, the last print — against Kalshi's official
 *  expiration value and result. Synchronous. */
export function labSettleReceipt(
  ticker: string,
  closeMs: number,
  strike: number,
  winner: "UP" | "DOWN",
  official: number | null = null,
): SettleReceipt {
  const L = lab();
  const feed = L.brti.settle.get(quarterClose(closeMs)) ?? null;
  const empty: SettleReceipt = {
    settle_avg: null,
    settle_last: null,
    brti_prints: 0,
    settle_gap: null,
    fair_pre: L.fairPre.get(ticker) ?? null,
    rule_avg_ok: null,
    rule_last_ok: null,
    settle_feed: null,
    settle_feed_n: null,
    official_value: official,
  };
  void settleShocks(L, ticker, winner);
  L.fairPre.delete(ticker);
  const c = Math.floor(closeMs / 1000);
  let sum = 0;
  let k = 0;
  let last = 0;
  for (const p of L.brti.prints) {
    if (p.s > c - 60 && p.s <= c) {
      sum += p.v;
      k += 1;
      last = p.v;
    }
  }
  if (!k || !(strike > 0)) return empty;
  const avg = sum / k;
  const up = winner === "UP";
  const avgOk = avg >= strike === up;
  const lastOk = last >= strike === up;
  if (k >= FEED_TRUST_PRINTS) {
    L.receipts.n += 1;
    if (avgOk) L.receipts.avg_ok += 1;
    if (lastOk) L.receipts.last_ok += 1;
    if (official != null && Math.abs(avg - official) <= 0.05) L.receipts.exact += 1;
  } else {
    L.receipts.partial += 1;
  }
  return {
    ...empty,
    settle_avg: avg,
    settle_last: last,
    brti_prints: k,
    settle_gap: avg - strike,
    rule_avg_ok: k >= FEED_TRUST_PRINTS ? avgOk : null,
    rule_last_ok: k >= FEED_TRUST_PRINTS ? lastOk : null,
    // The streamed average only means "Kalshi's arithmetic" when we saw the
    // whole minute; after a mid-minute connect it averages a partial set.
    settle_feed: k >= FEED_TRUST_PRINTS ? (feed?.value ?? null) : null,
    settle_feed_n: k >= FEED_TRUST_PRINTS ? (feed?.n ?? null) : null,
  };
}

async function settleShocks(L: Lab, ticker: string, winner: "UP" | "DOWN"): Promise<void> {
  try {
    const db = await sql();
    await db`
      update desk_lag_events
         set winner = ${winner},
             realized = case when side = ${winner} then 100 - ask_before - fee else -ask_before - fee end
       where ticker = ${ticker} and winner is null
    `;
  } catch (err) {
    L.persistErrors += 1;
    L.lastError = `settle shocks: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function labSummary(opts: { samples?: boolean } = {}): Record<string, unknown> {
  const L = lab();
  const now = Date.now();
  const snap = L.getSnap();
  const tk = snap?.ticker ?? "";
  const b = tk ? L.books.get(tk) : undefined;
  const survival = [...L.survival].map(([Lms, a]) => ({
    latency_ms: Lms,
    alive: a.alive,
    total: a.total,
    edge_alive: a.edge_alive,
    edge_total: a.edge_total,
    edge_hit_pct: a.edge_total ? Math.round((1000 * a.edge_alive) / a.edge_total) / 10 : null,
    mean_net_if_hit: a.edge_alive ? Math.round((10 * a.edge_net_sum) / a.edge_alive) / 10 : null,
  }));
  const t60 = trailingAvg(L.brti, now);
  return {
    started: L.started,
    signed: kalshiConfigured(),
    key: kalshiKeyInfo(),
    ws: L.ws?.summary() ?? null,
    recorder: L.rec?.summary() ?? null,
    // Feed provenance for WARDEN: which direction field carried each trade, how
    // late trades arrive off the exchange clock, and whether the reconstructed
    // book is currently trusted or quarantined by a sequence gap.
    trade_clock: {
      n: L.tradeClock.n,
      canonical: L.tradeClock.canonical,
      legacy: L.tradeClock.legacy,
      unknown_side: L.tradeClock.unknown,
      no_source_ts: L.tradeClock.no_source_ts,
      source_lag_avg_ms: L.tradeClock.lag_n ? Math.round(L.tradeClock.lag_sum_ms / L.tradeClock.lag_n) : null,
      source_lag_max_ms: L.tradeClock.lag_n ? L.tradeClock.lag_max_ms : null,
    },
    // TAPE 2.0: the microstructure measurements, so every value can be audited
    // against the book it came from. Research only — nothing votes on these.
    tape2: L.tape2Last
      ? { ticker: L.tape2Ticker, ...L.tape2Last }
      : { ticker: L.tape2Ticker, note: "no trusted book sampled yet" },
    // VEL 2.0: the part of the contract's move the underlying does not explain,
    // at four horizons, plus which market actually moved first. Research only.
    vel2: L.vel2Last ?? { note: "no samples yet" },
    // WHALE 2.0: real executions, clustered, with what the midpoint did after
    // each. Entirely separate from the incumbent volume-proxy WHALE seat, whose
    // calibration record is its own and is never pooled with this. Research only.
    whale2: whale2Now(tk) ?? {
      note: "no prints recorded on this window yet",
      prints_held: L.whale.get(tk)?.prints.length ?? 0,
      mid_marks: L.whale.get(tk)?.marks.length ?? 0,
      windows_buffered: L.whale.size,
    },
    book_integrity: {
      books: L.books.size,
      trusted: [...L.books.values()].filter((x) => bookTrusted(x)).length,
      quarantined: [...L.books.values()].filter((x) => x.ok && x.stale).length,
      gaps: [...L.books.values()].reduce((a, x) => a + x.gaps, 0),
      current_trusted: bookTrusted(b),
      stale_for_s: b?.stale && b.gap_t ? Math.round((now - b.gap_t) / 100) / 10 : null,
    },
    brti: {
      last: L.brti.last || null,
      age_s: L.brti.last_t ? Math.round((now - L.brti.last_t) / 100) / 10 : null,
      source_lag_ms: L.brti.last_src_t ? L.brti.last_t - L.brti.last_src_t : null,
      ticks: L.brti.n,
      sigma1_usd: L.brti.var_n >= 30 ? Math.round(Math.sqrt(L.brti.var1) * 100) / 100 : null,
      prints: L.brti.n_prints,
      lag_vendor_to_us_ms: L.brti.lag_us == null ? null : Math.round(L.brti.lag_us),
      lag_vendor_to_kalshi_ms: L.brti.lag_kalshi == null ? null : Math.round(L.brti.lag_kalshi),
      avg60: t60.n ? Math.round(t60.avg * 100) / 100 : null,
      avg60_n: t60.n,
      feed_avg60: L.brti.avg60_feed,
      feed_settle: L.brti.settle_live
        ? { close: new Date(L.brti.settle_live.close).toISOString(), value: L.brti.settle_live.value, n: L.brti.settle_live.n }
        : null,
      known_now: snap ? settlePrints(L.brti, snap.close_time) : null,
    },
    window: snap
      ? {
          ticker: tk,
          strike: snap.strike,
          secs_left: Math.round((snap.close_time - now) / 100) / 10,
          fair: L.fair
            ? {
                p_up: Math.round(L.fair.p_up * 1000) / 1000,
                mean: Math.round(L.fair.mean * 100) / 100,
                sd: Math.round(L.fair.sd * 100) / 100,
                prints_known: L.fair.k,
                prints_left: L.fair.m,
                known_from: L.fair.source,
                age_s: Math.round((now - L.fairT) / 100) / 10,
              }
            : null,
          book: b?.ok
            ? { ...bests(b), levels: levelCount(b), age_s: Math.round((now - b.upd_t) / 100) / 10, trusted: bookTrusted(b) }
            : null,
        }
      : null,
    study: {
      shock_cents: SHOCK_CENTS,
      shocks: L.study.n_shocks,
      with_edge: L.study.n_edge,
      no_book: L.study.n_nobook,
      open: L.study.open.length,
      done: L.shocksDone,
      survival,
      last: L.lastShocks.slice(0, 8).map((s) => ({
        t: new Date(s.t0).toISOString().slice(11, 23),
        side: s.side,
        ask: s.ask_before,
        size: s.ask_size,
        fair: Math.round(s.fair_after * 10) / 10,
        net: Math.round(s.net_edge * 10) / 10,
        gone_ms: s.gone_ms,
        how: s.gone_how,
        mo500: s.markouts[500] == null ? null : Math.round(s.markouts[500] * 10) / 10,
        secs_left: s.secs_left,
        kind: s.jump_ms <= FAST_JUMP_MS ? "jump" : "drift",
        jump_ms: s.jump_ms,
      })),
    },
    receipts: {
      ...L.receipts,
      official_backfilled: L.backfilled,
      official_refused: L.backfillRefused,
      official_refused_last: L.backfillRefusedLine,
    },
    basis: L.basis
      ? {
          minute: new Date(L.basis.minute).toISOString(),
          binance_bps: L.basis.bin_n ? Math.round((100 * L.basis.bin) / L.basis.bin_n) / 100 : null,
          coinbase_bps: L.basis.cb_n ? Math.round((100 * L.basis.cb) / L.basis.cb_n) / 100 : null,
          n: L.basis.bin_n + L.basis.cb_n,
        }
      : null,
    persist_errors: L.persistErrors,
    last_error: L.lastError,
    samples: opts.samples ? (L.rec?.samples() ?? null) : undefined,
  };
}

/** Nightly recap lines. Reads the tables so restarts don't lose the count. */
export async function labDigestBits(bits: string[]): Promise<void> {
  const L = lab();
  try {
    const db = await sql();
    const [lag] = await db<{
      n: number;
      edge: number;
      hit150: number;
      hit500: number;
      net150: number | null;
      mo500: number | null;
      taken: number;
      fast: number;
      fast_edge: number;
      fast_hit150: number;
      fast_real: number | null;
      fast_settled: number;
      drift_real: number | null;
      drift_settled: number;
    }>`
      select count(*)::int as n,
             count(*) filter (where net_edge > 0)::int as edge,
             count(*) filter (where net_edge > 0 and fill_150)::int as hit150,
             count(*) filter (where net_edge > 0 and fill_500)::int as hit500,
             avg(net_edge) filter (where net_edge > 0 and fill_150) as net150,
             avg(markout_500) filter (where net_edge > 0 and fill_150) as mo500,
             count(*) filter (where net_edge > 0 and gone_how = 'taken')::int as taken,
             count(*) filter (where jump_ms <= ${FAST_JUMP_MS})::int as fast,
             count(*) filter (where jump_ms <= ${FAST_JUMP_MS} and net_edge > 0)::int as fast_edge,
             count(*) filter (where jump_ms <= ${FAST_JUMP_MS} and net_edge > 0 and fill_150)::int as fast_hit150,
             avg(realized) filter (where jump_ms <= ${FAST_JUMP_MS} and net_edge > 0 and fill_150 and winner is not null) as fast_real,
             count(*) filter (where jump_ms <= ${FAST_JUMP_MS} and net_edge > 0 and fill_150 and winner is not null)::int as fast_settled,
             avg(realized) filter (where jump_ms > ${FAST_JUMP_MS} and net_edge > 0 and winner is not null) as drift_real,
             count(*) filter (where jump_ms > ${FAST_JUMP_MS} and net_edge > 0 and winner is not null)::int as drift_settled
        from desk_lag_events
       where t > now() - interval '24 hours'
    `;
    const ws = L.ws?.summary() as { state?: string; msgs?: number } | undefined;
    bits.push(`feed ${ws?.state ?? "off"}, BRTI ${L.brti.n} ticks and ${L.rec?.lines ?? 0} events recorded since the last restart`);
    if (lag && lag.n > 0) {
      const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
      const money = (v: number | null, n: number) =>
        v == null || !n ? "no settled sample yet" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}¢ per contract over ${n} settled`;
      bits.push(
        `stale quotes: ${lag.n} fair-value shocks ≥${SHOCK_CENTS}¢ (${lag.fast} true jumps within 1s, the rest drift), ${lag.edge} with edge after fee; still hittable at 150ms ${pct(lag.hit150, lag.edge)}, at 500ms ${pct(lag.hit500, lag.edge)}; ${lag.taken} were taken by someone else${
          lag.net150 != null ? `; mean net edge if hit at 150ms ${Number(lag.net150).toFixed(1)}¢, fair 500ms later ${Number(lag.mo500 ?? 0) >= 0 ? "+" : ""}${Number(lag.mo500 ?? 0).toFixed(1)}¢ vs price paid` : ""
        }`,
      );
      bits.push(
        `what those would have made at settlement: jumps hit at 150ms ${money(lag.fast_real, lag.fast_settled)}; drift (model vs book) ${money(lag.drift_real, lag.drift_settled)}`,
      );
    }
    const [rc] = await db<{
      n: number;
      avg_ok: number;
      last_ok: number;
      partial: number;
      official: number;
      exact: number;
      feed_exact: number;
      err_cents: number | null;
    }>`
      select count(*) filter (where brti_prints >= 55)::int as n,
             count(*) filter (where brti_prints >= 55 and rule_avg_ok)::int as avg_ok,
             count(*) filter (where brti_prints >= 55 and rule_last_ok)::int as last_ok,
             count(*) filter (where brti_prints > 0 and brti_prints < 55)::int as partial,
             count(*) filter (where official_value is not null and brti_prints >= 55)::int as official,
             count(*) filter (where official_value is not null and brti_prints >= 55 and abs(settle_avg - official_value) <= 0.05)::int as exact,
             count(*) filter (where official_value is not null and settle_feed is not null and brti_prints >= 55 and abs(settle_feed - official_value) <= 0.05)::int as feed_exact,
             avg(abs(settle_avg - official_value) * 100) filter (where official_value is not null and brti_prints >= 55) as err_cents
        from desk_ledger_research
       where close_time > now() - interval '24 hours'
    `;
    if (rc && rc.n > 0) {
      bits.push(
        `settlement rule check: 60s-average rule agreed with Kalshi's result on ${rc.avg_ok}/${rc.n} windows, last-tick rule ${rc.last_ok}/${rc.n}${
          rc.official ? `; our average matched Kalshi's official value within 5¢ on ${rc.exact}/${rc.official} (mean gap ${Number(rc.err_cents ?? 0).toFixed(1)}¢), Kalshi's streamed average on ${rc.feed_exact}` : ""
        }${rc.partial ? ` (${rc.partial} windows had partial index data)` : ""}`,
      );
    }
    const [bs] = await db<{
      n: number | null;
      bin: number | null;
      cb: number | null;
      bin_abs: number | null;
      cb_abs: number | null;
    }>`
      select sum(n)::int as n, avg(binance_bps) as bin, avg(coinbase_bps) as cb,
             avg(binance_abs_bps) as bin_abs, avg(coinbase_abs_bps) as cb_abs
        from desk_basis_minutes
       where minute > now() - interval '24 hours'
    `;
    if (bs && bs.n) {
      const f = (v: number | null) => (v == null ? "n/a" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}`);
      bits.push(
        `basis vs BRTI: Binance ${f(bs.bin)} bps (|${f(bs.bin_abs)}|), Coinbase ${f(bs.cb)} bps (|${f(bs.cb_abs)}|) over ${bs.n} samples`,
      );
    }
  } catch (err) {
    L.lastError = `digest: ${err instanceof Error ? err.message : String(err)}`;
  }
}
