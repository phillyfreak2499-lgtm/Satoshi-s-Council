import { createServerFn } from "@tanstack/react-start";
import { takerOutcomeSide } from "./kalshi-wire";
import { asMs, uniqueByT, valuesOf, type HistPoint } from "./hist";
import { interpretKalshiBook, readSeq } from "./kalshi-book";
import { candleTs, emptyTally, tally } from "./candle-time";
import { applyInstrument, funding8h, notionalUsd, pickPrimaryVenue, specTag, volumeUsd } from "./units";
import type { PathPoint } from "./path-time";
import type { Candle, LiveBundle, OfficialSettle } from "./types";

const T = 4500;
const UA = "SatoshiCouncil/1.0 (paper research)";
const KALSHI_HOSTS = [
  "https://external-api.kalshi.com/trade-api/v2",
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://api.kalshi.com/trade-api/v2",
];

async function getJson(url: string, timeout = T): Promise<unknown> {
  return (await getJsonMeta(url, timeout)).json;
}

async function getJsonPost(url: string, body: unknown, timeout = T): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getJsonMeta(
  url: string,
  timeout = T,
): Promise<{ json: unknown; httpDate: number; fetchedAt: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": UA },
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const fetchedAt = Date.now();
    const httpDate = Date.parse(res.headers.get("date") ?? "") || fetchedAt;
    return { json: await res.json(), httpDate, fetchedAt };
  } finally {
    clearTimeout(t);
  }
}

function klines(raw: unknown, source: string, receipt_ts: number): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as unknown[];
    const t = Number(r[0]);
    const closeT = Number(r[6]);
    const close = Number(r[4]);
    const base = Number(r[5]);
    const quote = Number(r[7]);
    return {
      t,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close,
      volume: volumeUsd({ base, quote, px: close, venue: source.includes("coinbase") ? "coinbase" : "binance" }),
      closed: closeT < Date.now() - 500,
      receipt_ts,
      source,
    };
  });
}

function cents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1.5) return Math.round(n * 100);
  return Math.round(n);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Last time THIS ticker's best bid/ask actually moved. REST has no book seq. */
const bookClock: { ticker: string; fp: string; changedAt: number } = {
  ticker: "",
  fp: "",
  changedAt: 0,
};

function quoteUpdateTs(
  ticker: string,
  fp: string,
  trade_ts: number,
  seenAt: number,
): number {
  if (bookClock.ticker !== ticker) {
    bookClock.ticker = ticker;
    bookClock.fp = fp;
    bookClock.changedAt = trade_ts || seenAt;
  } else if (bookClock.fp !== fp) {
    bookClock.fp = fp;
    bookClock.changedAt = seenAt;
  }
  return Math.max(trade_ts, bookClock.changedAt);
}

type KalshiMarketRow = {
  ticker?: string;
  result?: string;
  settlement_value?: string | number;
  settlement_ts?: string;
  close_time?: string;
  expiration_time?: string;
  expiration_value?: string | number;
};

function parseKalshiResult(row: KalshiMarketRow): "UP" | "DOWN" | null {
  const r = String(row.result ?? "").toLowerCase();
  if (r === "yes") return "UP";
  if (r === "no") return "DOWN";
  const v = Number(row.settlement_value);
  if (v === 1) return "UP";
  if (v === 0) return "DOWN";
  return null;
}

function collectSettles(
  rows: KalshiMarketRow[] | undefined,
  receipt_ts: number,
  host: string,
  into: OfficialSettle[],
) {
  if (!rows) return;
  const seen = new Set(into.map((s) => s.ticker));
  for (const row of rows) {
    const lean = parseKalshiResult(row);
    if (!lean) continue;
    const ticker = String(row.ticker ?? "");
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const closeTs = Date.parse(String(row.close_time ?? row.expiration_time ?? "")) || 0;
    const settledAt = Date.parse(String(row.settlement_ts ?? "")) || closeTs;
    const value = Number(row.expiration_value);
    into.push({
      ticker,
      close_time: closeTs,
      lean,
      provider_ts: settledAt,
      receipt_ts,
      source: host,
      ...(Number.isFinite(value) && value > 0 ? { value } : {}),
    });
  }
}

async function binanceKlines(interval: string, limit: number): Promise<{ candles: Candle[]; source: string }> {
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
    `https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
  ];
  for (const u of urls) {
    try {
      const meta = await getJsonMeta(u, 4000);
      const src = u.includes("vision") ? "binance_vision spot" : "binance_us spot";
      const c = klines(meta.json, src, meta.fetchedAt);
      if (c.length) return { candles: c, source: src };
    } catch {
      /* try next */
    }
  }
  return { candles: [], source: "DOWN" };
}

async function coinbaseExchange(): Promise<number | null> {
  try {
    const raw = (await getJson("https://api.exchange.coinbase.com/products/BTC-USD/ticker", 3500)) as {
      price?: string;
    };
    const n = Number(raw?.price);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function coinbaseRetail(): Promise<number | null> {
  try {
    const raw = (await getJson("https://api.coinbase.com/v2/prices/BTC-USD/spot", 3500)) as {
      data?: { amount?: string };
    };
    const n = Number(raw?.data?.amount);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

type KalshiPack = NonNullable<LiveBundle["kalshi"]>;

async function kalshi(): Promise<KalshiPack | null> {
  for (const host of KALSHI_HOSTS) {
    try {
      const mk = (await getJson(`${host}/markets?status=open&series_ticker=KXBTC15M&limit=1`, 4000)) as {
        markets?: Record<string, unknown>[];
      };
      const m = mk.markets?.[0];
      if (!m) continue;
      const ticker = String(m.ticker ?? "");
      let yes_bid = cents(m.yes_bid_dollars ?? m.yes_bid);
      let yes_ask = cents(m.yes_ask_dollars ?? m.yes_ask);
      let no_bid = cents(m.no_bid_dollars ?? m.no_bid);
      let no_ask = cents(m.no_ask_dollars ?? m.no_ask);
      let yes_bid_size = 0;
      let no_bid_size = 0;

      const nowSec = Math.floor(Date.now() / 1000);
      const extras = await Promise.allSettled([
        getJsonMeta(`${host}/markets/${ticker}/orderbook`, 3500),
        getJsonMeta(`${host}/markets/trades?ticker=${encodeURIComponent(ticker)}&limit=80`, 3500),
        getJson(
          `${host}/series/KXBTC15M/markets/${ticker}/candlesticks?period_interval=1&start_ts=${nowSec - 960}&end_ts=${nowSec}`,
          3500,
        ),
        getJsonMeta(`${host}/markets?status=settled&series_ticker=KXBTC15M&limit=16`, 3500),
        getJsonMeta(`${host}/markets?status=closed&series_ticker=KXBTC15M&limit=8`, 3500),
      ]);

      const bookMeta = extras[0].status === "fulfilled" ? extras[0].value : null;
      const quote = interpretKalshiBook(bookMeta?.json ?? null, { yes_bid, yes_ask, no_bid, no_ask });
      yes_bid = quote.yes_bid;
      yes_ask = quote.yes_ask;
      no_bid = quote.no_bid;
      no_ask = quote.no_ask;
      yes_bid_size = quote.yes_bid_size;
      no_bid_size = quote.no_bid_size;

      let trade_n = 0;
      let taker_yes = 0.5;
      let trade_ts = 0;
      let last_trade_id = "";
      const tradeMeta = extras[1].status === "fulfilled" ? extras[1].value : null;
      const tradeRaw = tradeMeta?.json ?? null;
      if (tradeRaw && typeof tradeRaw === "object") {
        const trades = ((tradeRaw as { trades?: Record<string, unknown>[] }).trades ?? []).slice(0, 80);
        trade_n = trades.length;
        let yesN = 0;
        let tot = 0;
        for (const tr of trades) {
          const c = num(tr.count_fp ?? tr.count);
          tot += c;
          // Canonical field first; the deprecated taker_side is a fallback only.
          const side = takerOutcomeSide(tr);
          if (side === "yes") yesN += c;
        }
        if (tot > 0) taker_yes = yesN / tot;
        const newest = trades[0];
        if (newest) {
          trade_ts = Date.parse(String(newest.created_time ?? "")) || 0;
          last_trade_id = String(newest.trade_id ?? "");
        }
      }

      const receipt_ts = Math.max(
        bookMeta?.fetchedAt ?? 0,
        tradeMeta?.fetchedAt ?? 0,
        0,
      ) || Date.now();
      const seenAt = bookMeta?.httpDate ?? receipt_ts;
      const fp = `${yes_bid}|${yes_ask}|${no_bid}|${no_ask}|${Math.round(yes_bid_size)}|${Math.round(no_bid_size)}`;
      const quote_ts = quoteUpdateTs(ticker, fp, trade_ts, seenAt);
      const quote_seq = readSeq(bookMeta?.json) || readSeq(tradeMeta?.json);
      const quote_age_s = quote_ts ? Math.max(0, (Date.now() - quote_ts) / 1000) : 999;

      // The bare array production reads today, UNCHANGED: same rows, same order, same
      // filter. The timestamped copy is built alongside it and replaces nothing.
      const yes_path: number[] = [];
      const yes_path_pts: PathPoint[] = [];
      const candle_ts = emptyTally();
      const candleRaw = extras[2].status === "fulfilled" ? extras[2].value : null;
      if (candleRaw && typeof candleRaw === "object") {
        const rows = (candleRaw as { candlesticks?: { price?: { close_dollars?: string } }[] }).candlesticks ?? [];
        const nowMs = Date.now();
        for (const row of rows) {
          const px = cents(row.price?.close_dollars);
          if (!(px > 0)) continue;
          yes_path.push(px);
          candle_ts.rows_priced++;
          // The candle's own period timestamp, normalised to epoch ms. A row whose
          // timestamp cannot be read is counted and left out of the timestamped path
          // rather than given a made-up time - an invented timestamp would corrupt
          // the very measurement this exists to take.
          const got = candleTs(row, nowMs);
          tally(candle_ts, got);
          if (got.ok) yes_path_pts.push({ t: got.t, px, source: "candle" });
        }
      }

      const settles: OfficialSettle[] = [];
      const settleMeta = extras[3].status === "fulfilled" ? extras[3].value : null;
      const closedMeta = extras[4].status === "fulfilled" ? extras[4].value : null;
      const settleReceipt = Math.max(settleMeta?.fetchedAt ?? 0, closedMeta?.fetchedAt ?? 0, receipt_ts);
      const marketsOf = (raw: unknown): KalshiMarketRow[] =>
        raw && typeof raw === "object"
          ? ((raw as { markets?: KalshiMarketRow[] }).markets ?? [])
          : [];
      collectSettles(marketsOf(settleMeta?.json), settleReceipt, host, settles);
      collectSettles(marketsOf(closedMeta?.json), settleReceipt, host, settles);
      collectSettles([m as KalshiMarketRow], settleReceipt, host, settles);
      settles.sort((a, b) => a.close_time - b.close_time);

      const strike = Number(m.floor_strike ?? m.strike ?? m.yes_sub_title ?? m.cap_strike ?? 0);
      const close =
        Date.parse(String(m.close_time ?? m.expiration_time ?? m.latest_expiration_time ?? "")) || 0;
      return {
        ticker,
        host,
        strike: Number.isFinite(strike) && strike > 1000 ? strike : 0,
        close_time: close,
        yes_bid,
        yes_ask,
        no_bid,
        no_ask,
        yes_bid_size,
        no_bid_size,
        quote_age_s,
        quote_ts,
        quote_seq,
        trade_ts,
        last_trade_id,
        receipt_ts,
        ok: true,
        trade_n,
        taker_yes,
        yes_path,
        yes_path_pts,
        candle_ts,
        settles,
      };
    } catch {
      /* next host */
    }
  }
  return null;
}

async function okx() {
  try {
    const [fr, oi, frh, oih, inst, tick] = await Promise.all([
      getJson("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP", 3500) as Promise<{
        data?: { fundingRate?: string; fundingTime?: string }[];
      }>,
      getJson("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP", 3500) as Promise<{
        data?: { oi?: string; oiCcy?: string; oiUsd?: string }[];
      }>,
      getJson("https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=16", 3500) as Promise<{
        data?: { fundingRate?: string; realizedRate?: string; fundingTime?: string }[];
      }>,
      getJson(
        "https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=5m&limit=16",
        3500,
      ) as Promise<{ data?: [string, string, string, string][] }>,
      getJson("https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP", 3500) as Promise<{
        data?: { ctVal?: string; ctMult?: string; ctValCcy?: string; settleCcy?: string }[];
      }>,
      getJson("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP", 3500) as Promise<{
        data?: { last?: string; idxPx?: string; markPx?: string }[];
      }>,
    ]);
    const instRow = inst.data?.[0];
    if (instRow) applyInstrument("okx", instRow);
    const fundingTime = asMs(Number(fr.data?.[0]?.fundingTime));
    const fundingSeries = uniqueByT(
      (frh.data ?? []).map((r) => ({
        t: asMs(Number(r.fundingTime)),
        v: funding8h(Number(r.realizedRate ?? r.fundingRate), "okx"),
      })),
    );
    const oiBtcSeries = uniqueByT(
      (oih.data ?? []).map((row) => ({
        t: asMs(Number(row?.[0])),
        v: Number(row?.[2] ?? row?.[1]),
      })),
    );
    const oiUsdSeries = uniqueByT(
      (oih.data ?? []).map((row) => ({
        t: asMs(Number(row?.[0])),
        v: Number(row?.[3] ?? 0),
      })),
    );
    return {
      funding: funding8h(Number(fr.data?.[0]?.fundingRate ?? NaN), "okx"),
      fundingTime,
      oi: Number(oi.data?.[0]?.oiCcy ?? NaN),
      oiUsd: Number(oi.data?.[0]?.oiUsd ?? NaN),
      fundingSeries,
      oiSeries: oiBtcSeries,
      oiUsdSeries,
      source: "okx",
      perp: Number(tick.data?.[0]?.last ?? tick.data?.[0]?.markPx ?? NaN),
      index: Number(tick.data?.[0]?.idxPx ?? NaN),
    };
  } catch {
    return {
      funding: NaN,
      fundingTime: 0,
      oi: NaN,
      oiUsd: NaN,
      fundingSeries: [] as HistPoint[],
      oiSeries: [] as HistPoint[],
      oiUsdSeries: [] as HistPoint[],
      source: "DOWN",
      perp: NaN,
      index: NaN,
    };
  }
}

type LiqEvent = { t: number; usd: number; side: "long" | "short"; venue: string };
type LiqPack = { longUsd: number; shortUsd: number; n: number; source: string; last_t: number };

function packLiq(events: LiqEvent[], source: string, windowMs = 15 * 60_000): LiqPack | null {
  if (!events.length) return null;
  const cutoff = Date.now() - windowMs;
  const seen = new Set<string>();
  const uniq: LiqEvent[] = [];
  for (const e of events) {
    const t = e.t > 0 ? e.t : Date.now();
    if (!Number.isFinite(e.usd) || e.usd <= 0) continue;
    const key = `${e.venue ?? ""}|${t}|${e.side}|${Math.round(e.usd)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ ...e, t });
  }
  uniq.sort((a, b) => a.t - b.t);
  const recent = uniq.filter((e) => e.t >= cutoff);
  const use = recent.length ? recent : uniq.slice(-8);
  if (!use.length) return null;
  let longUsd = 0;
  let shortUsd = 0;
  for (const e of use) {
    if (e.side === "long") longUsd += e.usd;
    else shortUsd += e.usd;
  }
  return { longUsd, shortUsd, n: use.length, source, last_t: use[use.length - 1]!.t };
}

async function bybitLiq(): Promise<LiqEvent[]> {
  const urls = [
    "https://api.bybit.com/v5/market/recent-liquidation?category=linear&symbol=BTCUSDT&limit=100",
    "https://api.bytick.com/v5/market/recent-liquidation?category=linear&symbol=BTCUSDT&limit=100",
  ];
  for (const u of urls) {
    try {
      const raw = (await getJson(u, 3500)) as {
        retCode?: number;
        result?: { list?: { side?: string; size?: string; qty?: string; price?: string; updatedTime?: string }[] };
      };
      const list = raw.result?.list ?? [];
      if (!list.length || (raw.retCode != null && raw.retCode !== 0)) continue;
      const out: LiqEvent[] = [];
      for (const row of list) {
        const t = asMs(Number(row.updatedTime ?? 0));
        const px = num(row.price);
        const sz = num(row.size ?? row.qty);
        const usd = notionalUsd(sz, px, "bybit");
        if (usd <= 0) continue;
        const sideRaw = String(row.side ?? "").toLowerCase();
        const side: "long" | "short" = sideRaw === "sell" || sideRaw === "short" ? "long" : "short";
        out.push({ t, usd, side, venue: "bybit" });
      }
      if (out.length) return out;
    } catch {
      /* next host */
    }
  }
  return [];
}

async function okxLiq(): Promise<LiqEvent[]> {
  const urls = [
    "https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled",
    "https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled",
  ];
  for (const u of urls) {
    try {
      const raw = (await getJson(u, 3500)) as {
        data?: {
          details?: { posSide?: string; side?: string; sz?: string; bkPx?: string; ts?: string; time?: number }[];
        }[];
      };
      const details = raw.data?.[0]?.details ?? [];
      if (!details.length) continue;
      const out: LiqEvent[] = [];
      for (const row of details) {
        const t = asMs(Number(row.ts ?? row.time ?? 0));
        const px = num(row.bkPx);
        const sz = num(row.sz);
        const usd = notionalUsd(sz, px, "okx");
        if (usd <= 0) continue;
        const pos = String(row.posSide ?? row.side ?? "").toLowerCase();
        const side: "long" | "short" = pos === "long" || pos === "sell" ? "long" : "short";
        out.push({ t, usd, side, venue: "okx" });
      }
      if (out.length) return out;
    } catch {
      /* next */
    }
  }
  return [];
}

async function bitfinexLiq(): Promise<LiqEvent[]> {
  try {
    const raw = (await getJson("https://api-pub.bitfinex.com/v2/liquidations/hist?limit=50", 3500)) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: LiqEvent[] = [];
    for (const row of raw) {
      if (!Array.isArray(row)) continue;
      const t = asMs(Number(row[1]));
      const amt = Number(row[4]);
      const px = Number(row[5] ?? row[8]);
      const usd = notionalUsd(Math.abs(amt), px > 0 ? px : 1, "bitfinex");
      if (usd <= 0) continue;
      out.push({ t, usd, side: amt < 0 ? "long" : "short", venue: "bitfinex" });
    }
    return out;
  } catch {
    return [];
  }
}

async function binanceLiq(): Promise<LiqEvent[]> {
  const urls = [
    "https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=50",
    "https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT",
  ];
  for (const u of urls) {
    try {
      const raw = (await getJson(u, 3500)) as
        | { code?: number }
        | { symbol?: string; side?: string; price?: string; executedQty?: string; time?: number; avgPrice?: string }[];
      if (!Array.isArray(raw)) continue;
      const out: LiqEvent[] = [];
      for (const row of raw) {
        const t = asMs(Number(row.time ?? 0));
        const px = num(row.avgPrice ?? row.price);
        const sz = num(row.executedQty);
        const usd = notionalUsd(sz, px, "binance");
        if (usd <= 0) continue;
        const sideRaw = String(row.side ?? "").toLowerCase();
        const side: "long" | "short" = sideRaw === "sell" ? "long" : "short";
        out.push({ t, usd, side, venue: "binance" });
      }
      if (out.length) return out;
    } catch {
      /* geo-blocked from some regions */
    }
  }
  return [];
}

async function hyperliquidLiq(): Promise<LiqEvent[]> {
  try {
    const raw = (await getJsonPost("https://api.hyperliquid.xyz/info", { type: "recentTrades", coin: "BTC" }, 3500)) as
      | { coin?: string; side?: string; px?: string; sz?: string; time?: number; liquidation?: unknown }[]
      | unknown;
    if (!Array.isArray(raw)) return [];
    const out: LiqEvent[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const r = row as { side?: string; px?: string; sz?: string; time?: number; liquidation?: unknown };
      if (!r.liquidation) continue;
      const t = asMs(Number(r.time ?? 0));
      const px = num(r.px);
      const sz = num(r.sz);
      const usd = notionalUsd(sz, px, "hyperliquid");
      if (usd <= 0) continue;
      const side: "long" | "short" = String(r.side ?? "").toUpperCase() === "A" || String(r.side ?? "") === "sell" ? "long" : "short";
      out.push({ t, usd, side, venue: "hyperliquid" });
    }
    return out;
  } catch {
    return [];
  }
}

async function liquidations(): Promise<LiqPack> {
  const [bybit, binance, okx, hl, bitf] = await Promise.all([
    bybitLiq(),
    binanceLiq(),
    okxLiq(),
    hyperliquidLiq(),
    bitfinexLiq(),
  ]);
  const packs = [
    { name: "bybit", rows: bybit },
    { name: "binance", rows: binance },
    { name: "okx", rows: okx },
    { name: "hyperliquid", rows: hl },
    { name: "bitfinex", rows: bitf },
  ]
    .map(({ name, rows }) => packLiq(rows, `${name} ${specTag(name)}`))
    .filter((p): p is LiqPack => Boolean(p));
  return pickPrimaryVenue(packs) ?? { longUsd: 0, shortUsd: 0, n: 0, source: "DOWN", last_t: 0 };
}

async function fng() {
  try {
    const raw = (await getJson("https://api.alternative.me/fng/?limit=7", 3500)) as {
      data?: { value?: string; value_classification?: string }[];
    };
    const rows = raw.data ?? [];
    return {
      value: Number(rows[0]?.value ?? NaN),
      label: String(rows[0]?.value_classification ?? ""),
      hist: rows.map((r) => Number(r.value)).filter(Number.isFinite).reverse(),
    };
  } catch {
    return { value: NaN, label: "DOWN", hist: [] as number[] };
  }
}

async function binancePerp(): Promise<{ mark: number; index: number; source: string }> {
  try {
    const raw = (await getJson("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 3500)) as {
      markPrice?: string;
      indexPrice?: string;
    };
    const mark = Number(raw.markPrice);
    const index = Number(raw.indexPrice);
    if (!Number.isFinite(mark)) return { mark: NaN, index: NaN, source: "DOWN" };
    return { mark, index, source: "binance perpetual" };
  } catch {
    return { mark: NaN, index: NaN, source: "DOWN" };
  }
}

export const fetchLiveBundle = createServerFn({ method: "GET" }).handler(async () => {
  return loadBundle();
});

async function scrapeBundle(): Promise<LiveBundle> {
  const errors: Record<string, string> = {};
  const [k1, k5, k15, k1h, ks, deriv, liq, sent, cbEx, prem] = await Promise.all([
    binanceKlines("1m", 90).catch((e) => {
      errors.spot = String(e);
      return { candles: [] as Candle[], source: "DOWN" };
    }),
    binanceKlines("5m", 36).catch(() => ({ candles: [] as Candle[], source: "DOWN" })),
    binanceKlines("15m", 24).catch(() => ({ candles: [] as Candle[], source: "DOWN" })),
    binanceKlines("1h", 24).catch(() => ({ candles: [] as Candle[], source: "DOWN" })),
    kalshi().catch((e) => {
      errors.kalshi = String(e);
      return null;
    }),
    okx().catch((e) => {
      errors.derivs = String(e);
      return {
        funding: NaN,
        fundingTime: 0,
        oi: NaN,
        oiUsd: NaN,
        fundingSeries: [] as HistPoint[],
        oiSeries: [] as HistPoint[],
        oiUsdSeries: [] as HistPoint[],
        source: "DOWN",
        perp: NaN,
        index: NaN,
      };
    }),
    liquidations().catch(() => ({ longUsd: 0, shortUsd: 0, n: 0, source: "DOWN", last_t: 0 })),
    fng(),
    coinbaseExchange(),
    binancePerp().catch(() => ({ mark: NaN, index: NaN, source: "DOWN" })),
  ]);

  let spot = k1.candles.at(-1)?.close ?? null;
  let source = k1.source;
  let age = k1.candles.length ? Math.max(0, (Date.now() - (k1.candles.at(-1)?.t ?? 0)) / 1000) : 999;
  let backup = cbEx;
  let backupSource = cbEx != null ? "coinbase_ex" : "";
  if (backup == null) {
    backup = await coinbaseRetail();
    if (backup != null) backupSource = "coinbase";
  }
  if (spot == null && backup != null) {
    spot = backup;
    source = `${backupSource || "coinbase"} spot`;
    age = 2;
  }

  const perp = Number.isFinite(deriv.perp)
    ? deriv.perp
    : Number.isFinite(prem.mark)
      ? prem.mark
      : null;
  const perp_source = Number.isFinite(deriv.perp)
    ? "okx perpetual"
    : Number.isFinite(prem.mark)
      ? prem.source
      : "";
  const index_px = Number.isFinite(deriv.index)
    ? deriv.index
    : Number.isFinite(prem.index)
      ? prem.index
      : null;

  const bundle: LiveBundle = {
    as_of: Date.now(),
    receipt_ts:
      Math.max(ks?.receipt_ts ?? 0, k1.candles.at(-1)?.receipt_ts ?? 0) || Date.now(),
    spot,
    spot_source: source,
    spot_age_s: age,
    spot_backup: backup,
    spot_backup_source: backupSource,
    perp,
    perp_source,
    index_px,
    klines_1m: k1.candles,
    klines_5m: k5.candles,
    klines_15m: k15.candles,
    klines_1h: k1h.candles,
    kalshi: ks,
    funding_rate: Number.isFinite(deriv.funding) ? deriv.funding : null,
    funding_time: deriv.fundingTime || null,
    funding_history: valuesOf(deriv.fundingSeries ?? []),
    funding_series: deriv.fundingSeries ?? [],
    open_interest: Number.isFinite(deriv.oi) ? deriv.oi : null,
    oi_usd: Number.isFinite(deriv.oiUsd) ? deriv.oiUsd : null,
    oi_history: valuesOf(deriv.oiSeries ?? []),
    oi_series: deriv.oiSeries ?? [],
    oi_usd_series: deriv.oiUsdSeries ?? [],
    liq_long_usd: liq.longUsd,
    liq_short_usd: liq.shortUsd,
    liq_n: liq.n,
    liq_source: liq.source,
    fear_greed: Number.isFinite(sent.value) ? sent.value : null,
    fear_greed_label: sent.label,
    fng_history: sent.hist,
    errors,
  };
  return bundle;
}

let bundleCache: { at: number; bundle: LiveBundle } | null = null;
let bundleInflight: Promise<LiveBundle> | null = null;
const BUNDLE_TTL_MS = 3_000;

export async function loadBundle(): Promise<LiveBundle> {
  if (bundleCache && Date.now() - bundleCache.at < BUNDLE_TTL_MS) return bundleCache.bundle;
  if (bundleInflight) return bundleInflight;
  bundleInflight = scrapeBundle()
    .then((bundle) => {
      bundleCache = { at: Date.now(), bundle };
      return bundle;
    })
    .finally(() => {
      bundleInflight = null;
    });
  return bundleInflight;
}
