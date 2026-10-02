import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { allowedUrl, FEEDS, ingestItems, latestNews, newsResponse, normalizeItem, parseFeed, pruneItems, type NewsDb } from "./news.ts";
import { fetchFeed } from "./fetch.ts";

const now = new Date("2026-10-02T22:00:00Z");
const item = { title: "Bitcoin market update", url: "https://www.coindesk.com/markets/bitcoin", published_at: "2026-10-02T21:48:00Z" };
async function database() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("../../../migrations/0076_bitcoin_wire.sql", import.meta.url), "utf8"));
  return db;
}
const sql = (db: PGlite): NewsDb => ({ query: (text, params) => db.query<Record<string, unknown>>(text, params) });

test("same URL in one poll and repeated poll = exactly one persisted row", async () => {
  const db = await database();
  try {
    assert.equal(await ingestItems(sql(db), "CoinDesk", [item, item], now), 1);
    assert.equal(await ingestItems(sql(db), "CoinDesk", [item], now), 0);
    const rows = await latestNews(sql(db), now);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fetched_at, now.toISOString());
  } finally { await db.close(); }
});
test("unknown source rejected before insertion; schema also rejects it", async () => {
  const db = await database();
  try {
    await assert.rejects(ingestItems(sql(db), "Untrusted Blog", [item], now), /non-allowlisted/);
    await assert.rejects(db.query("insert into news_items(title, source, url, published_at) values('BTC', 'Untrusted Blog', 'https://unknown.example/a', now())"), /check constraint/);
    assert.equal((await latestNews(sql(db), now)).length, 0);
  } finally { await db.close(); }
});
test("non-BTC item dropped, title or description accepts Bitcoin/BTC case-insensitively", async () => {
  const db = await database();
  try {
    assert.equal(await ingestItems(sql(db), "CoinDesk", [{ ...item, title: "Ethereum update" }], now), 0);
    assert.ok(normalizeItem("CoinDesk", { ...item, title: "bTc update" }, now));
    assert.ok(normalizeItem("CoinDesk", { ...item, title: "Market update", description: "BITCOIN moved today" }, now));
    assert.equal(normalizeItem("CoinDesk", { ...item, title: "BTCUSD is a symbol" }, now), null);
  } finally { await db.close(); }
});
test("source spoofing, lookalike domains and unsafe protocols are rejected", () => {
  for (const url of ["https://coindesk.com.evil.test/btc", "https://evil.test/btc", "javascript:alert(1)", "http://www.coindesk.com/btc", "https://user:pass@www.coindesk.com/btc", "https://www.coindesk.com:123/btc"]) assert.equal(allowedUrl("CoinDesk", url), false);
  assert.equal(allowedUrl("Decrypt", item.url), false);
  assert.deepEqual(FEEDS.map(feed => feed.source), ["CoinDesk", "The Block", "Decrypt", "Bitcoin Magazine", "Reuters Markets/Crypto"]);
});
test("endpoint JSON returns latest 30 newest-first, stable ties, no expired/future items", async () => {
  const db = await database();
  try {
    for (let i = 0; i < 35; i++) await ingestItems(sql(db), "CoinDesk", [{ ...item, url: `${item.url}/${i}`, published_at: new Date(now.getTime() - i * 60000).toISOString() }], now);
    await db.query("insert into news_items(title, source, url, published_at) values ('BTC expired', 'CoinDesk', 'https://www.coindesk.com/old', $1), ('BTC future', 'CoinDesk', 'https://www.coindesk.com/future', $2)", ["2026-09-01", "2026-11-01"]);
    const response = await newsResponse(sql(db), now);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const rows = await response.json();
    assert.equal(rows.length, 30);
    assert.equal(rows[0].url, `${item.url}/0`);
    assert.equal(rows[29].url, `${item.url}/29`);
    for (let i = 1; i < rows.length; i++) assert.ok(Date.parse(rows[i - 1].published_at) >= Date.parse(rows[i].published_at));
    await ingestItems(sql(db), "CoinDesk", [{ ...item, url: `${item.url}/tie`, published_at: now.toISOString() }], now);
    assert.equal((await latestNews(sql(db), now))[0].url, `${item.url}/tie`);
  } finally { await db.close(); }
});
test("pruning removes older than seven days and preserves exact boundary", async () => {
  const db = await database();
  try {
    await db.query("insert into news_items(title, source, url, published_at) values ('BTC old', 'CoinDesk', 'https://www.coindesk.com/old', $1), ('BTC boundary', 'CoinDesk', 'https://www.coindesk.com/boundary', $2)", ["2026-09-25T21:59:59Z", "2026-09-25T22:00:00Z"]);
    await pruneItems(sql(db), now);
    assert.equal((await db.query("select * from news_items")).rows.length, 1);
    assert.equal((await latestNews(sql(db), now))[0].url, "https://www.coindesk.com/boundary");
    assert.equal(normalizeItem("CoinDesk", { ...item, published_at: "nonsense" }, now), null);
    assert.equal(normalizeItem("CoinDesk", { ...item, published_at: "2026-11-01" }, now), null);
    assert.equal(normalizeItem("CoinDesk", { ...item, published_at: "2026-09-01" }, now), null);
  } finally { await db.close(); }
});
test("RSS entities, CDATA, namespaced dates, HTML descriptions and Atom links", () => {
  const rss = parseFeed(`<rss><channel><item><title><![CDATA[Bitcoin & BTC]]></title><link>https://decrypt.co/a?x=1&amp;y=2</link><pubDate>Fri, 02 Oct 2026 21:00:00 GMT</pubDate><description><![CDATA[<p>Bitcoin context</p>]]></description></item></channel></rss>`);
  assert.equal(rss[0].title, "Bitcoin & BTC");
  assert.equal(rss[0].url, "https://decrypt.co/a?x=1&y=2");
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>BTC</title><link rel="self" href="https://decrypt.co/feed"/><link rel="alternate" href="https://decrypt.co/a"/><published>2026-10-02T21:00:00Z</published></entry></feed>`);
  assert.equal(atom[0].url, "https://decrypt.co/a");
  assert.throws(() => parseFeed("<rss><channel></rss>"), /invalid/);
  assert.throws(() => parseFeed("<html>not a feed</html>"), /not an RSS/);
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'), /invalid/);
});
test("feed redirects cannot leave publisher allowlist", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://evil.test/rss" } }); };
  await assert.rejects(fetchFeed(FEEDS[0], request), /non-allowlisted/);
  assert.equal(calls, 1);
  await assert.rejects(fetchFeed({ ...FEEDS[0], url: "https://evil.test/rss" }, request), /non-allowlisted/);
  assert.equal(calls, 1);
});
test("feed errors and oversize XML fail explicitly", async () => {
  await assert.rejects(fetchFeed(FEEDS[0], async () => new Response("unavailable", { status: 404 })), /HTTP 404/);
  await assert.rejects(fetchFeed(FEEDS[0], async () => new Response("x".repeat(2 * 1024 * 1024 + 1))), /exceeds/);
});
