import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const observer = read("src/lib/desk/chair-v3-prospective.server.ts");
const migration = read("migrations/0039_desk_chair_v3_prospective.sql");
const health = read("server/routes/healthz.get.ts");
const route = read("server/routes/research/chair-v3.get.ts");

test("prospective v3 is booted beside the brain, never imported by it", () => {
  assert.match(health, /chair-v3-prospective\.server/);
  assert.match(health, /ensureChairV3ProspectiveObserver/);
  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
  ]) {
    assert.ok(!read(path).includes("chair-v3-prospective"), `${path} imports prospective v3`);
  }
});

test("prospective observer has one-way frame read and only its own research write", () => {
  assert.match(observer, /import\("\.\/server-engine"\)/);
  assert.match(observer, /getServerFrame\(\)/);
  assert.match(observer, /insert into desk_v3_samples/i);
  const writes = [...observer.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(writes, ["desk_v3_samples"]);
  for (const forbidden of ["noteCall", "applyDeskOp", "bookState", "selectiveBlock", "decideChair", "runChair", "onLean("]) {
    assert.ok(!observer.includes(forbidden), `observer reaches ${forbidden}`);
  }
});

test("prospective rows are frozen before outcome and protected by one-row-per-window identity", () => {
  assert.match(observer, /close_time < \$\{new Date\(closeMs\)\.toISOString\(\)\}/);
  assert.match(observer, /on conflict \(ticker, close_time\) do nothing/i);
  assert.match(observer, /V3_PROSPECTIVE_SINCE = Date\.parse\("2026-09-16T21:00:00\.000Z"\)/);
  assert.match(migration, /primary key \(ticker, close_time\)/i);
  assert.match(migration, /check \(abs\(adjustment_pp\) <= 10\.001\)/i);
  assert.ok(!/winner\s+text/i.test(migration), "future winner must not be stored at prediction time");
});

test("prospective report joins outcomes later and remains admin-only", () => {
  assert.match(observer, /left join desk_ledger_research/i);
  assert.match(route, /adminKeyOk\(key\)/);
  assert.match(route, /return new Response\("not found", \{ status: 404 \}\)/);
  assert.match(route, /chairV3ProspectiveSnapshot/);
});
