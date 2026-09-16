import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function interpretKalshiBook(raw, ticker) {
  const book = raw?.orderbook ?? raw?.orderbook_fp ?? raw;
  const best = (rows) => Array.isArray(rows) && rows.length ? rows.reduce((m, r) => Number(r[0]) > Number(m[0]) ? r : m) : null;
  const y = best(book?.yes);
  const n = best(book?.no);
  const yesBid = y ? Number(y[0]) : ticker.yes_bid;
  const noBid = n ? Number(n[0]) : ticker.no_bid;
  return {
    yes_bid: yesBid,
    yes_ask: n ? 100 - noBid : ticker.yes_ask,
    no_bid: noBid,
    no_ask: y ? 100 - yesBid : ticker.no_ask,
    yes_bid_size: Number(y?.[1] ?? 0),
    no_bid_size: Number(n?.[1] ?? 0),
  };
}

function loadFastPulse() {
  const path = "src/lib/desk/fast-pulse.server.ts";
  const output = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (id) => {
      if (id === "./kalshi-book") return { interpretKalshiBook };
      throw new Error(`unexpected require ${id}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}

const snap = (extra = {}) => ({
  as_of: 1_700_000_000_000,
  ticker: "KXBTC15M-26SEP161430-30",
  kalshi_host: "https://external-api.kalshi.com/trade-api/v2",
  yes_bid: 54,
  yes_ask: 55,
  no_bid: 45,
  no_ask: 46,
  close_time: 1_700_000_900_000,
  strike: 75_900,
  ...extra,
});

function reply(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test("fast pulse takes contract prices from the orderbook, not market-list summaries", async () => {
  const mod = loadFastPulse();
  mod.resetFastPulseCache();
  const old = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("/orderbook")) return reply({ orderbook: { yes: [[62, 9]], no: [[37, 8]] } });
    if (String(url).includes("coinbase")) return reply({ price: "75912.34" });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const p = await mod.fetchFastPulse(snap());
    assert.equal(p.stale, false);
    assert.equal(p.yes_bid, 62);
    assert.equal(p.yes_ask, 63);
    assert.equal(p.no_bid, 37);
    assert.equal(p.no_ask, 38);
    assert.equal(p.spot, 75912.34);
    assert.ok(urls.some((u) => u.includes("/markets/KXBTC15M-26SEP161430-30/orderbook?depth=1")));
    assert.ok(!urls.some((u) => u.includes("series_ticker=KXBTC15M")), "market-list summary must not feed fast quotes");
  } finally {
    globalThis.fetch = old;
  }
});

test("same-ticker viewers coalesce behind one upstream orderbook request", async () => {
  const mod = loadFastPulse();
  mod.resetFastPulseCache();
  const old = globalThis.fetch;
  let bookN = 0;
  let spotN = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/orderbook")) {
      bookN += 1;
      await new Promise((r) => setTimeout(r, 5));
      return reply({ orderbook: { yes: [[60, 4]], no: [[39, 3]] } });
    }
    spotN += 1;
    return reply({ price: "76000" });
  };
  try {
    const rows = await Promise.all(Array.from({ length: 12 }, () => mod.fetchFastPulse(snap())));
    assert.ok(rows.every((p) => p.yes_bid === 60 && p.yes_ask === 61));
    assert.equal(bookN, 1);
    assert.equal(spotN, 1);
    await mod.fetchFastPulse(snap());
    assert.equal(bookN, 1, "fresh cache should absorb the next viewer request");
  } finally {
    globalThis.fetch = old;
  }
});

test("an orderbook failure is visibly stale instead of disguising an old quote as live", async () => {
  const mod = loadFastPulse();
  mod.resetFastPulseCache();
  const old = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/orderbook")) return reply({}, false, 503);
    return reply({ price: "75888" });
  };
  try {
    const p = await mod.fetchFastPulse(snap());
    assert.equal(p.stale, true);
    assert.equal(p.yes_bid, 54);
    assert.equal(p.yes_ask, 55);
    assert.equal(p.spot, 75888);
  } finally {
    globalThis.fetch = old;
  }
});

test("ticker identity is fail-closed and cannot turn the pulse into an arbitrary URL fetch", async () => {
  const mod = loadFastPulse();
  mod.resetFastPulseCache();
  const old = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => { n += 1; return reply({}); };
  try {
    const p = await mod.fetchFastPulse(snap({ ticker: "https://evil.example/" }));
    assert.equal(p.stale, true);
    assert.equal(n, 0);
  } finally {
    globalThis.fetch = old;
  }
});

test("fast lane remains display-only and the route no longer reads the old market-summary pulse", () => {
  const fast = read("src/lib/desk/fast-pulse.server.ts");
  const route = read("server/routes/pulse.get.ts");
  const client = read("src/lib/desk/pulse.ts");
  assert.match(route, /fetchFastPulse/);
  assert.ok(!route.includes("getPulse()"));
  assert.ok(!fast.includes("series_ticker=KXBTC15M"));
  assert.ok(!/decideChair|runBots|noteCall|bookState|applyEntryMode/.test(fast));
  assert.match(client, /const POLL_MS = 1_000/);
  assert.match(client, /LEAF components only/);
});
