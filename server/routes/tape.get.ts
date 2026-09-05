/** Public pulse: what the box can actually see right now.
 *  Micro-cached so outside pollers can't burn the Coinbase per-IP budget
 *  (3 req/s) that the brain and the fast lane share. */
let tapeCache: { at: number; body: string } | null = null;

export default async function tape() {
  if (tapeCache && Date.now() - tapeCache.at < 2_000) {
    return new Response(tapeCache.body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const ac = AbortSignal.timeout(4500);
  const headers = { "user-agent": "SatoshiCouncil/1.0 (paper research)" };
  const grab = async (url: string) => {
    const r = await fetch(url, { signal: ac, headers });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json() as Promise<unknown>;
  };
  const [cb, kalshi, okx] = await Promise.allSettled([
    grab("https://api.exchange.coinbase.com/products/BTC-USD/ticker"),
    grab("https://api.elections.kalshi.com/trade-api/v2/markets?status=open&series_ticker=KXBTC15M&limit=1"),
    grab("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP"),
  ]);
  const coinbase =
    cb.status === "fulfilled"
      ? Number((cb.value as { price?: string }).price)
      : null;
  const markets =
    kalshi.status === "fulfilled"
      ? ((kalshi.value as { markets?: { ticker?: string; yes_bid_dollars?: string; floor_strike?: number; close_time?: string }[] })
          .markets ?? [])
      : [];
  const m = markets[0];
  const funding =
    okx.status === "fulfilled"
      ? Number(((okx.value as { data?: { fundingRate?: string }[] }).data ?? [])[0]?.fundingRate)
      : null;
  const body = {
    ok: coinbase != null && Boolean(m?.ticker),
    spot: coinbase,
    spot_source: coinbase != null ? "coinbase exchange" : "DOWN",
    ticker: m?.ticker ?? null,
    close_time: m?.close_time ?? null,
    yes_bid: m?.yes_bid_dollars ?? null,
    strike: m?.floor_strike ?? null,
    funding,
    errors: {
      coinbase: cb.status === "rejected" ? String(cb.reason) : null,
      kalshi: kalshi.status === "rejected" ? String(kalshi.reason) : null,
      okx: okx.status === "rejected" ? String(okx.reason) : null,
    },
    as_of: Date.now(),
  };
  const json = JSON.stringify(body);
  tapeCache = { at: Date.now(), body: json };
  return new Response(json, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
