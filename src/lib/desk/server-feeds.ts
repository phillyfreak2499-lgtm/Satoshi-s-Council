import { createServerFn } from "@tanstack/react-start";
import type { Candle, LiveBundle } from "./types";

const T = 4500;

async function getJson(url: string, timeout = T): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function klines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as unknown[];
    const t = Number(r[0]);
    const closeT = Number(r[6]);
    return {
      t,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closed: closeT < Date.now() - 500,
    };
  });
}

function cents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1.5) return Math.round(n * 100);
  return Math.round(n);
}

async function binanceKlines(interval: string, limit: number): Promise<{ candles: Candle[]; source: string }> {
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
    `https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
  ];
  for (const u of urls) {
    try {
      const raw = await getJson(u, 4000);
      const c = klines(raw);
      if (c.length) return { candles: c, source: u.includes("vision") ? "binance_vision" : "binance_us" };
    } catch {
      /* try next */
    }
  }
  return { candles: [], source: "DOWN" };
}

async function coinbaseSpot(): Promise<number | null> {
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

async function kalshi() {
  const hosts = [
    "https://api.elections.kalshi.com/trade-api/v2",
    "https://api.kalshi.com/trade-api/v2",
  ];
  for (const host of hosts) {
    try {
      const mk = (await getJson(
        `${host}/markets?status=open&series_ticker=KXBTC15M&limit=1`,
        4000,
      )) as { markets?: Record<string, unknown>[] };
      const m = mk.markets?.[0];
      if (!m) continue;
      const ticker = String(m.ticker ?? "");
      let yes_bid = cents(m.yes_bid_dollars ?? m.yes_bid);
      let yes_ask = cents(m.yes_ask_dollars ?? m.yes_ask);
      let no_bid = cents(m.no_bid_dollars ?? m.no_bid);
      let no_ask = cents(m.no_ask_dollars ?? m.no_ask);
      let yes_bid_size = 0;
      let no_bid_size = 0;
      try {
        const ob = (await getJson(`${host}/markets/${ticker}/orderbook`, 3500)) as {
          orderbook?: {
            yes?: [number, number][];
            no?: [number, number][];
            yes_dollars?: [number, number][];
            no_dollars?: [number, number][];
          };
        };
        const book = ob.orderbook;
        const yes = book?.yes_dollars ?? book?.yes ?? [];
        const no = book?.no_dollars ?? book?.no ?? [];
        if (yes.length) {
          yes_bid = cents(yes[0]![0]);
          yes_bid_size = Number(yes[0]![1] ?? 0);
        }
        if (no.length) {
          no_bid = cents(no[0]![0]);
          no_bid_size = Number(no[0]![1] ?? 0);
        }
        if (yes.length > 1) yes_ask = cents(yes[0]![0]) || yes_ask;
      } catch {
        /* book optional — still return quotes if market printed */
      }
      const strike = Number(
        m.floor_strike ?? m.strike ?? m.yes_sub_title ?? m.cap_strike ?? 0,
      );
      const close =
        Date.parse(String(m.close_time ?? m.expiration_time ?? m.latest_expiration_time ?? "")) ||
        0;
      return {
        ticker,
        strike: Number.isFinite(strike) && strike > 1000 ? strike : 0,
        close_time: close,
        yes_bid,
        yes_ask,
        no_bid,
        no_ask,
        yes_bid_size,
        no_bid_size,
        quote_age_s: 1,
        ok: true,
      };
    } catch {
      /* next host */
    }
  }
  return null;
}

async function okx() {
  try {
    const [fr, oi] = await Promise.all([
      getJson("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP", 3500) as Promise<{
        data?: { fundingRate?: string }[];
      }>,
      getJson("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP", 3500) as Promise<{
        data?: { oi?: string }[];
      }>,
    ]);
    return {
      funding: Number(fr.data?.[0]?.fundingRate ?? NaN),
      oi: Number(oi.data?.[0]?.oi ?? NaN),
      source: "okx",
    };
  } catch {
    return { funding: NaN, oi: NaN, source: "DOWN" };
  }
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

export const fetchLiveBundle = createServerFn({ method: "GET" }).handler(async () => {
  const errors: Record<string, string> = {};
  const [k1, k5, k15, k1h, ks, deriv, sent, cb] = await Promise.all([
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
      return { funding: NaN, oi: NaN, source: "DOWN" };
    }),
    fng(),
    coinbaseSpot(),
  ]);

  let spot = k1.candles.at(-1)?.close ?? null;
  let source = k1.source;
  let age = k1.candles.length ? Math.max(0, (Date.now() - (k1.candles.at(-1)?.t ?? 0)) / 1000) : 999;
  if (spot == null && cb != null) {
    spot = cb;
    source = "coinbase";
    age = 2;
  }

  const bundle: LiveBundle = {
    as_of: Date.now(),
    spot,
    spot_source: source,
    spot_age_s: age,
    klines_1m: k1.candles,
    klines_5m: k5.candles,
    klines_15m: k15.candles,
    klines_1h: k1h.candles,
    kalshi: ks,
    funding_rate: Number.isFinite(deriv.funding) ? deriv.funding : null,
    funding_history: Number.isFinite(deriv.funding) ? [deriv.funding] : [],
    open_interest: Number.isFinite(deriv.oi) ? deriv.oi : null,
    oi_history: Number.isFinite(deriv.oi) ? [deriv.oi] : [],
    fear_greed: Number.isFinite(sent.value) ? sent.value : null,
    fear_greed_label: sent.label,
    fng_history: sent.hist,
    errors,
  };
  return bundle;
});
