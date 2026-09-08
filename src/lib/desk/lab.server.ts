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
import {
  applyDelta,
  applySnapshot,
  bests,
  freshBook,
  levelCount,
  priceCents,
  sameBests,
  type Bests,
  type LabBook,
} from "./lab-book";
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
};

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
    const rows = await db<{ ticker: string }>`
      select ticker from desk_ledger
       where official_value is null and close_time < now() - interval '3 minutes'
       order by close_time desc limit 4
    `;
    if (!rows.length) return;
    const host = L.getSnap()?.kalshi_host || REST_HOST;
    for (const { ticker } of rows) {
      try {
        const r = await fetch(`${host}/markets/${encodeURIComponent(ticker)}`, {
          signal: AbortSignal.timeout(4_000),
          headers: { accept: "application/json", "user-agent": "SatoshiCouncil/1.0 (paper research)" },
        });
        if (!r.ok) continue;
        const j = (await r.json()) as { market?: Record<string, unknown> };
        const v = Number(j.market?.expiration_value);
        if (!Number.isFinite(v) || v <= 0) continue;
        await db`update desk_ledger set official_value = ${v} where ticker = ${ticker} and official_value is null`;
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
      if (d && tk === currentTicker(L)) onDelta(L.study, d.side, d.price, d.size, t);
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
      onTrade(L.study, {
        t,
        yes_price: priceCents(msg.yes_price ?? msg.yes_price_dollars),
        no_price: priceCents(msg.no_price ?? msg.no_price_dollars),
        taker_side: String(msg.taker_side ?? "").toLowerCase(),
      });
      return;
    }
    case "__gap": {
      if (String(msg.channel) === "orderbook_delta") L.ws?.resubscribe("orderbook_delta");
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
  if (!b?.ok) return;
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

function afterBook(L: Lab, tk: string, b: LabBook, t: number): void {
  if (tk !== currentTicker(L)) return;
  const nb = bests(b);
  const prev = L.lastBests.get(tk);
  if (prev && sameBests(prev, nb)) return;
  L.lastBests.set(tk, nb);
  if (L.fair && L.fairTicker === tk) onBookBests(L.study, nb, fairYesCents(L), t);
}

function secondTick(L: Lab): void {
  const t = Date.now();
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
          book: b?.ok ? { ...bests(b), levels: levelCount(b), age_s: Math.round((now - b.upd_t) / 100) / 10 } : null,
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
    receipts: { ...L.receipts, official_backfilled: L.backfilled },
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
        from desk_ledger
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
