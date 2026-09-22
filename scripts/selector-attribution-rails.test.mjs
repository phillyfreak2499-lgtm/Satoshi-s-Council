/**
 * SELECTOR ATTRIBUTION v1 rails (docs/SELECTOR_ATTRIBUTION_V1_2026-09-22.md).
 *
 * The recorder is observer-only (nothing on a decision path imports it),
 * prospective-only (no row for a window that started before the manifests'
 * boundary or before this observer session), writes exactly one table, reaches
 * no production actuator, and its pure module has no clock, database, Chair or
 * book import. Before the boundary exists, a tick touches nothing but the
 * boundary read.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function loader(deps = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (key) => {
      if (key in deps) return deps[key];
      const bare = key.replace(/\.ts$/, "");
      if (bare in deps) return deps[bare];
      assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
      const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
      return load(path.href.slice(root.href.length));
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, Promise, Error, structuredClone, setInterval, clearInterval, globalThis: {}, console, process: { env: { ...globals.env } } });
    return exports;
  }
  return load;
}

function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const rel = `${dir}${name}`;
    if (statSync(new URL(rel, root)).isDirectory()) walk(`${rel}/`, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

test("SELECTOR ATTRIBUTION v1 is observer-only, prospective-only, writes one table and reaches no actuator", async () => {
  // Nothing on a decision path imports the recorder; only the shadow-lab observer does.
  for (const f of walk("src/").concat(walk("server/"))) {
    if (f.startsWith("src/lib/desk/selector-attribution") || f === "src/lib/desk/shadow-lab.server.ts") continue;
    assert.ok(!read(f).includes("selector-attribution"), `${f} imports the attribution recorder`);
  }
  const server = codeOf("src/lib/desk/selector-attribution.server.ts");
  const writes = [...server.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)].map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual([...new Set(writes)].sort(), ["desk_selector_attribution"]);
  assert.match(server, /on conflict \(ticker, close_time, kind\) do nothing/);
  assert.match(server, /status = 'SHADOW' and prospective_start_at is not null/);
  assert.match(server, /snap\.close_time - WINDOW_MS < t\.boundary_ms\) return/);
  assert.match(server, /snap\.close_time - WINDOW_MS < input\.session_started_ms\) return/, "a restart never records a market it only saw part of");
  for (const forbidden of ["noteCall(", "applyDeskOp(", "promoteToLive(", "reviewSeats(", "runHuddle(", "desk_ledger (", "desk_state", "e.learner", "server-engine", "book-floor"]) {
    assert.ok(!server.includes(forbidden), `attribution reaches ${forbidden}`);
  }
  assert.match(read("migrations/0059_desk_selector_attribution.sql"), /check \(close_time - interval '15 minutes' >= prospective_start_at\)/);
  const pure = codeOf("src/lib/desk/selector-attribution.ts");
  assert.doesNotMatch(pure, /import .* from ["']\.\/(chair|server-engine|learner|book-floor)/, "the pure module reads no Chair internals and no book");
  assert.doesNotMatch(pure, /@\/lib\/db|getSql|Date\.now\(\)/, "the pure module has no clock and no database");

  // Before the boundary exists the observer step touches nothing but the boundary read; a boundary-less database yields no writes.
  const calls = [];
  const sql = async (strings) => { calls.push(strings.join("?")); return []; };
  const load = loader({ "@/lib/db": { getSql: async () => sql } }, { env: {} });
  const mod = load("src/lib/desk/selector-attribution.server.ts");
  const close = Date.parse("2026-10-01T15:00:00Z");
  const snap = { as_of: close - 400_000, close_time: close, ticker: "KXBTC15M-26OCT011100-00", yes_ask: 84, yes_bid: 83, no_ask: 17, no_bid: 16, no_bid_size: 10, yes_bid_size: 10, spot_age_s: 1, quote_age_s: 1, obs: { receipt_ts: close - 401_000, gap: "ok" }, health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false }, edge_up: 3, edge_down: -20, fair_yes: 88, yes_mid: 83.5, lab_fair_yes: null, lab_age_s: 999, fee_yes: 2, fee_no: 2 };
  const chair = { lean: "WAIT", confidence: 50, score: 0, bar: 0.4, rows: [], gates: [], quorum: { up: 0, down: 0, wait: 0 }, sit_mass: 1 };
  const t = mod.blankAttributionTracker();
  await mod.observeSelectorAttribution(sql, { snap, chair, call_log: [], audit: null, ready: true, start: 0 }, t, snap.as_of);
  assert.ok(calls.length === 1 && /from desk_shadow_manifests/.test(calls[0]), "exactly one boundary read, no insert");
  assert.equal(t.boundary_ms, null);
  assert.equal(t.written, 0);
});
