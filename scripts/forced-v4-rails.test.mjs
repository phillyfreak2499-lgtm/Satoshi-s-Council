import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const pure = read("src/lib/desk/forced-v4.ts");
const observer = read("src/lib/desk/forced-v4.server.ts");
const migration = read("migrations/0042_desk_forced_v4.sql");
const health = read("server/routes/healthz.get.ts");
const labPublic = read("src/lib/desk/lab-public.ts");

test("V4 freezes one direction at T-7:30 and its output type has no WAIT", () => {
  assert.match(pure, /V4_LOCK_SECS = 450/);
  assert.match(pure, /V4_LOCK_GRACE_SECS = 12/);
  assert.match(pure, /type V4Side = "UP" \| "DOWN"/);
  const i = pure.indexOf("export function forcedV4Side");
  const j = pure.indexOf("export function predictForcedV4", i);
  const body = pure.slice(i, j);
  assert.match(body, /return "UP"/);
  assert.match(body, /return "DOWN"/);
  assert.doesNotMatch(body, /return "WAIT"/);
});

test("V4 direction is frozen before quote economics are read", () => {
  const start = observer.indexOf("async function captureOnce");
  const decision = observer.indexOf("const pred = predictForcedV4", start);
  const yesAsk = observer.indexOf("const yesAsk = validAsk(snap.yes_ask)", start);
  const noAsk = observer.indexOf("const noAsk = validAsk(snap.no_ask)", start);
  assert.ok(start >= 0 && decision > start && yesAsk > decision && noAsk > decision);

  const beforeDecision = observer.slice(start, decision);
  for (const forbidden of [
    /snap\.yes_ask/,
    /snap\.no_ask/,
    /snap\.chalk/,
    /chair\.lean/,
    /chair\.confidence/,
    /chair\.hard_fail/,
    /quorum/i,
    /margin/i,
    /fee/i,
  ]) {
    assert.doesNotMatch(beforeDecision, forbidden);
  }
});

test("V4 observer writes only its isolated shadow ledger", () => {
  assert.match(observer, /insert into desk_v4_forced/i);
  const writes = [...observer.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(writes, ["desk_v4_forced"]);

  for (const forbidden of [
    "noteCall",
    "applyDeskOp",
    "bookState",
    "selectiveBlock",
    "decideChair",
    "runChair",
    "promoteToLive",
    "setKnob",
    "reviewSeats",
  ]) {
    assert.ok(!observer.includes(forbidden), `V4 observer reaches ${forbidden}`);
  }
});

test("V4 is booted beside the brain and the brain never imports it", () => {
  assert.match(health, /forced-v4\.server/);
  assert.match(health, /ensureForcedV4Observer/);
  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
  ]) {
    assert.ok(!read(path).includes("forced-v4"), `${path} imports forced-v4`);
  }
});

test("V4 prediction is prospective and outcomes join only later", () => {
  assert.match(observer, /s\.close_time < \$\{new Date\(closeMs\)\.toISOString\(\)\}/);
  assert.match(observer, /l\.graded_at < \$\{new Date\(takenMs\)\.toISOString\(\)\}/);
  assert.match(observer, /where clock_timestamp\(\) < \$\{new Date\(snap\.close_time\)\.toISOString\(\)\}/);
  assert.match(observer, /left join desk_ledger_research/i);
  assert.ok(!/^\s*winner\s+/mi.test(migration), "future outcome must not be stored in the V4 prediction table");
});

test("V4 migration enforces UP/DOWN only and one row per window", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(migration);
    await pg.query(`
      insert into desk_v4_forced
        (ticker, close_time, taken_at, secs_left, study, version, measurement_version,
         market_p, p_up, side, model_n, correction_logit, features, chair_lean)
      values
        ('KXBTC15M-TEST', '2026-09-18T19:00:00Z', '2026-09-18T18:52:35Z', 445,
         'FORCED_DIRECTION_V4', 1, 'test', 0.51, 0.54, 'UP', 300, 0.1, '{}', 'WAIT')
    `);
    await assert.rejects(
      pg.query(`
        insert into desk_v4_forced
          (ticker, close_time, taken_at, secs_left, study, version, measurement_version,
           market_p, p_up, side, model_n, correction_logit, features, chair_lean)
        values
          ('KXBTC15M-WAIT', '2026-09-18T19:15:00Z', '2026-09-18T19:07:35Z', 445,
           'FORCED_DIRECTION_V4', 1, 'test', 0.50, 0.50, 'WAIT', 300, 0, '{}', 'WAIT')
      `),
    );
    await assert.rejects(
      pg.query(`
        insert into desk_v4_forced
          (ticker, close_time, taken_at, secs_left, study, version, measurement_version,
           market_p, p_up, side, model_n, correction_logit, features, chair_lean)
        values
          ('KXBTC15M-LATE', '2026-09-18T19:30:00Z', '2026-09-18T19:22:45Z', 435,
           'FORCED_DIRECTION_V4', 1, 'test', 0.50, 0.50, 'UP', 300, 0, '{}', 'WAIT')
      `),
    );
  } finally {
    await pg.close();
  }
});

test("V4 remains aggregate-only on the public Lab surface", () => {
  assert.match(labPublic, /forcedV4Snapshot\(\)\.catch\(\(\) => null\)/);
  assert.match(labPublic, /forced_v4: ForcedV4Snapshot \| null/);
  assert.doesNotMatch(labPublic, /method:\s*"POST"/);
  assert.match(migration, /Authority: none/);
  assert.doesNotMatch(migration, /references\s+desk_/i);
});
