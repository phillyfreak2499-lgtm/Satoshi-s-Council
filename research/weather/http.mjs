/** Public GET only; exact host allow-list, bounded bodies/time, no credentials. */
import { spec } from "./store.mjs";
export const KALSHI = "https://external-api.kalshi.com/trade-api/v2";
export async function publicJson(url, fetcher = fetch) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["external-api.kalshi.com", "api.weather.gov"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw Error("weather URL refused");
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(spec.http_timeout_ms),
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "SatoshisCouncil-WeatherResearch/1.0 (private research; satoshiscouncil.com)",
    },
  });
  if (!response.ok)
    throw Error(`weather GET ${response.status}: ${parsed.hostname}${parsed.pathname}`);
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > spec.max_response_bytes) throw Error("weather response exceeds bound");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  return {
    body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    at: new Date().toISOString(),
    headers: { date: response.headers.get("date"), age: response.headers.get("age") },
  };
}
export async function marketPages(series, status, fetcher = publicJson, query = {}) {
  const markets = [];
  const pages = [];
  let cursor = "";
  for (let i = 0; i < spec.max_pages; i++) {
    const u = new URL(KALSHI + "/markets");
    for (const [k, v] of Object.entries({
      series_ticker: series,
      status,
      limit: "100",
      ...query,
      ...(cursor ? { cursor } : {}),
    }))
      u.searchParams.set(k, v);
    const page = await fetcher(u.href);
    pages.push({ ...page, url: u.href });
    if (!Array.isArray(page.body.markets)) throw Error("weather market list malformed");
    markets.push(...page.body.markets);
    cursor = page.body.cursor ?? "";
    if (!cursor) return { markets, pages };
  }
  throw Error("weather market pagination incomplete");
}
