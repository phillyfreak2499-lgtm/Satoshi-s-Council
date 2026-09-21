/**
 * Hour Research storage, against a real database.
 *
 * The properties under test are properties of the SQL — which columns move
 * together, which conflict clause admits a write — and no amount of reading the
 * TypeScript around the statements can establish them. So this applies every
 * migration to PGLite (the same engine the local fallback uses) and runs the
 * EXACT statements the observer ships, imported from `hour-research-sql.ts`.
 *
 * What it proves:
 *   - a later WAIT checkpoint replaces the whole snapshot, never the clock alone;
 *   - `model_version` and `build_sha` move WITH that snapshot, so a deploy
 *     landing mid-hour can never leave a row naming the model that did not
 *     produce its numbers;
 *   - `authority` does not move, because it is immutable at "none";
 *   - a duplicate tick at the same checkpoint writes nothing;
 *   - an out-of-order earlier checkpoint writes nothing;
 *   - a directional candidate locks the hour against every later WAIT;
 *   - a graded hour is never rewritten;
 *   - a repeated rung insert cannot double-count.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "migrations");

/** The shipped statements, loaded from source so a drift between them and the writer fails here. */
const { HOUR_SHADOW_UPSERT, HOUR_SHADOW_COLUMNS, hourPredictionsInsert, HOUR_PREDICTION_COLUMNS } =
  await import("../src/lib/desk/hour-research-sql.ts");

async function db() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const names = (await readdir(MIGRATIONS, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
  for (const n of names) await pg.exec(await readFile(join(MIGRATIONS, n), "utf8"));
  return pg;
}

const CLOSE = "2026-09-18T19:00:00.000Z";
const EVENT = "KXBTCD-26SEP1815";

/**
 * One whole shadow snapshot. Every frozen field is derived from `checkpoint`, so
 * a row that mixes two checkpoints is immediately visible as an inconsistency
 * rather than something a reader has to reason about.
 */
function waitRow(checkpoint, over = {}) {
  const k = checkpoint;
  return {
    close_time: CLOSE,
    event_ticker: EVENT,
    checkpoint: k,
    decision: "WAIT",
    wait_reason: `reason_${k}`,
    ticker: null,
    strike: null,
    side: null,
    ask: null,
    fee: null,
    p_model: null,
    p_market: null,
    edge_cents: null,
    uncertainty: null,
    as_of: new Date(Date.parse(CLOSE) - k * 60_000).toISOString(),
    secs_left: k * 60,
    expected_settlement: 100_000 + k,
    expected_source: "cfbenchmarks-brti",
    sigma_horizon: 0.001 * k,
    brti_value: 100_000 + k,
    spot: 99_990 + k,
    brti_spot_basis: 10 + k,
    sigma_hour: 0.004,
    ladder_rungs: 100 + k,
    ladder_complete: true,
    ladder_inversions: k,
    stored_rungs: 90 + k,
    features: JSON.stringify({ checkpoint: k, brti: 100_000 + k }),
    explanation: `explanation at ${k}`,
    model_version: "hour-research-v1.0.0",
    authority: "none",
    build_sha: "",
    ...over,
  };
}

function callRow(checkpoint) {
  return waitRow(checkpoint, {
    decision: "YES",
    wait_reason: null,
    ticker: "KXBTCD-26SEP1815-T99000",
    strike: 99_000,
    side: "YES",
    ask: 40,
    fee: 2,
    p_model: 0.7,
    p_market: 0.4,
    edge_cents: 28,
    uncertainty: 0.05,
  });
}

const bind = (row) => HOUR_SHADOW_COLUMNS.map((c) => row[c]);
const upsert = (pg, row) => pg.query(HOUR_SHADOW_UPSERT, bind(row));
const only = async (pg) => (await pg.query("select * from desk_hour_shadow")).rows;

/** Every frozen field on the row must belong to exactly one checkpoint. */
function assertSelfConsistent(row, checkpoint) {
  const want = waitRow(checkpoint);
  for (const col of [
    "checkpoint", "wait_reason", "secs_left", "expected_settlement", "sigma_horizon",
    "brti_value", "spot", "brti_spot_basis", "ladder_rungs", "ladder_inversions",
    "stored_rungs", "explanation",
  ]) {
    assert.equal(
      String(row[col]),
      String(want[col]),
      `${col} must come from checkpoint ${checkpoint}, not an earlier one`,
    );
  }
  assert.equal(
    new Date(row.as_of).toISOString(),
    want.as_of,
    "the decision clock must belong to the same checkpoint as the features",
  );
  assert.deepEqual(
    typeof row.features === "string" ? JSON.parse(row.features) : row.features,
    { checkpoint, brti: 100_000 + checkpoint },
    "the frozen feature snapshot must move with the clock",
  );
}

test("a later WAIT replaces the WHOLE snapshot, never the clock alone", async () => {
  const pg = await db();
  await upsert(pg, waitRow(45));
  let rows = await only(pg);
  assert.equal(rows.length, 1, "one row per hour");
  assertSelfConsistent(rows[0], 45);

  // The regression: the old upsert moved checkpoint/as_of/secs_left/explanation
  // and left expected_settlement, brti, spot, sigma and features at 45.
  await upsert(pg, waitRow(30));
  rows = await only(pg);
  assert.equal(rows.length, 1, "still one row per hour");
  assertSelfConsistent(rows[0], 30);

  await upsert(pg, waitRow(5));
  rows = await only(pg);
  assert.equal(rows.length, 1);
  assertSelfConsistent(rows[0], 5);
});

test("a duplicate tick at the same checkpoint writes nothing", async () => {
  const pg = await db();
  await upsert(pg, waitRow(30));
  // A second tick inside the same capture window, carrying different numbers:
  // the stored checkpoint must not move, and neither must its snapshot.
  await upsert(pg, waitRow(30, { expected_settlement: 1, brti_value: 1, explanation: "second tick" }));
  const rows = await only(pg);
  assert.equal(rows.length, 1);
  assertSelfConsistent(rows[0], 30);
  assert.equal(rows[0].explanation, "explanation at 30", "the first capture stands");
});

test("an out-of-order earlier checkpoint never overwrites a later one", async () => {
  const pg = await db();
  await upsert(pg, waitRow(15));
  // Checkpoints count down, so 30 is EARLIER in time than 15. A late-arriving
  // 30-minute write must not roll the row backwards.
  await upsert(pg, waitRow(30));
  const rows = await only(pg);
  assert.equal(rows.length, 1);
  assertSelfConsistent(rows[0], 15);
});

test("a directional candidate locks the hour against every later WAIT", async () => {
  const pg = await db();
  await upsert(pg, waitRow(45));
  await upsert(pg, callRow(30));
  let rows = await only(pg);
  assert.equal(rows[0].decision, "YES");
  assert.equal(Number(rows[0].checkpoint), 30);

  // Every later checkpoint, WAIT or otherwise, leaves the call untouched: one
  // candidate per hour is the whole point of the single-row design.
  for (const k of [20, 15, 10, 5]) await upsert(pg, waitRow(k));
  rows = await only(pg);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, "YES", "the locked call survives");
  assert.equal(Number(rows[0].checkpoint), 30);
  assert.equal(Number(rows[0].ask), 40);
});

test("a graded hour is never rewritten", async () => {
  const pg = await db();
  await upsert(pg, waitRow(45));
  await pg.query("update desk_hour_shadow set graded_at = now(), official_value = 99999 where close_time = $1", [CLOSE]);
  await upsert(pg, waitRow(5));
  const rows = await only(pg);
  assert.equal(Number(rows[0].checkpoint), 45, "settled history stands");
  assertSelfConsistent(rows[0], 45);
  assert.equal(Number(rows[0].official_value), 99999);
});

test("a graded WAIT keeps a null result and still carries a completion stamp", async () => {
  const pg = await db();
  await upsert(pg, waitRow(10));
  // Exactly what the grader does to a sit: stamp completion, settle nothing.
  await pg.query(
    "update desk_hour_shadow set result = null, official_value = $2, settle_cents = null, ev_cents = null, graded_at = now() where close_time = $1 and graded_at is null",
    [CLOSE, 99_800],
  );
  const [row] = await only(pg);
  assert.equal(row.result, null, "a sit has no strike to settle against");
  assert.ok(row.graded_at != null, "and is still a completed hour");
  assert.equal(row.decision, "WAIT");
  // The shape constraint still holds: a WAIT carries a reason and no fill.
  assert.equal(row.side, null);
  assert.equal(row.ask, null);
  assert.ok(row.wait_reason);
});

// ---------------------------------------------------------------------------
// The version travels with the snapshot it describes
// ---------------------------------------------------------------------------

test("the upsert replaces model_version with the snapshot, and never the immutable authority", () => {
  // Read off the shipped statement itself, so a change to the excluded set that
  // re-pins the version is caught here rather than in production six hours later.
  assert.ok(
    HOUR_SHADOW_UPSERT.includes("model_version = excluded.model_version"),
    "model_version moves with the rest of the frozen snapshot",
  );
  assert.ok(HOUR_SHADOW_UPSERT.includes("build_sha = excluded.build_sha"), "as build_sha already did");
  assert.ok(
    !HOUR_SHADOW_UPSERT.includes("authority = excluded.authority"),
    "authority is immutable: a later tick can never promote an hour",
  );
  assert.ok(!HOUR_SHADOW_UPSERT.includes("close_time = excluded.close_time"), "the conflict key is not replaced");
  assert.ok(!HOUR_SHADOW_UPSERT.includes("event_ticker = excluded.event_ticker"), "nor the hour's identity");
  // And the outcome columns are not in the statement at all.
  for (const col of ["result", "official_value", "settle_cents", "ev_cents", "graded_at"]) {
    assert.ok(!HOUR_SHADOW_UPSERT.includes(`${col} = excluded.${col}`), `${col} is appended by grading, never upserted`);
  }
});

test("a later WAIT checkpoint carries its own model version and build, not the first one's", async () => {
  const pg = await db();
  // A deploy lands mid-hour: the 30-minute capture ran on v1 from build A, and
  // the 15-minute capture runs on v2 from build B.
  await upsert(pg, waitRow(30, { model_version: "hour-research-v1.0.0", build_sha: "aaaaaaa" }));
  let [row] = await only(pg);
  assert.equal(row.model_version, "hour-research-v1.0.0");
  assert.equal(row.build_sha, "aaaaaaa");

  await upsert(pg, waitRow(15, { model_version: "hour-research-v2.0.0", build_sha: "bbbbbbb" }));
  [row] = await only(pg);
  assert.equal(Number(row.checkpoint), 15, "the later checkpoint won");
  assert.equal(row.model_version, "hour-research-v2.0.0", "and named the model that produced its numbers");
  assert.equal(row.build_sha, "bbbbbbb", "and the build that ran it");
  assert.equal(row.authority, "none", "authority is untouched and still none");
  // Every other frozen field belongs to 15 as well: the version did not travel
  // alone any more than the clock did.
  assertSelfConsistent(row, 15);
});

test("version replacement respects the same three guards as the rest of the snapshot", async () => {
  // A duplicate tick at the same checkpoint changes nothing, version included.
  const dup = await db();
  await upsert(dup, waitRow(30, { model_version: "v1", build_sha: "aaaaaaa" }));
  await upsert(dup, waitRow(30, { model_version: "v2", build_sha: "bbbbbbb", explanation: "second tick" }));
  let [row] = await only(dup);
  assert.equal(row.model_version, "v1", "the first capture's version stands");
  assert.equal(row.build_sha, "aaaaaaa");
  assert.equal(row.explanation, "explanation at 30");

  // An out-of-order earlier checkpoint cannot roll the version backwards either.
  const back = await db();
  await upsert(back, waitRow(15, { model_version: "v2", build_sha: "bbbbbbb" }));
  await upsert(back, waitRow(30, { model_version: "v1", build_sha: "aaaaaaa" }));
  [row] = await only(back);
  assert.equal(Number(row.checkpoint), 15);
  assert.equal(row.model_version, "v2", "the later checkpoint's version survives");
  assert.equal(row.build_sha, "bbbbbbb");

  // A directional candidate locks the hour: its version is frozen with it.
  const locked = await db();
  await upsert(locked, callRow(30));
  await upsert(locked, waitRow(5, { model_version: "v9", build_sha: "ccccccc" }));
  [row] = await only(locked);
  assert.equal(row.decision, "YES", "the call stands");
  assert.equal(Number(row.checkpoint), 30);
  assert.equal(row.model_version, "hour-research-v1.0.0", "and keeps the version that made it");

  // A graded hour is history: nothing about it moves, version included.
  const graded = await db();
  await upsert(graded, waitRow(45, { model_version: "v1", build_sha: "aaaaaaa" }));
  await graded.query("update desk_hour_shadow set graded_at = now() where close_time = $1", [CLOSE]);
  await upsert(graded, waitRow(5, { model_version: "v2", build_sha: "bbbbbbb" }));
  [row] = await only(graded);
  assert.equal(Number(row.checkpoint), 45, "settled history stands");
  assert.equal(row.model_version, "v1");
  assert.equal(row.build_sha, "aaaaaaa");
});

test("the ladder insert stores every rung it is given and cannot double-count", async () => {
  const pg = await db();
  const rungs = Array.from({ length: 60 }, (_, i) => 98_000 + i * 100);
  const params = [];
  for (const strike of rungs) {
    params.push(
      EVENT, CLOSE, 30, `KXBTCD-26SEP1815-T${strike}`, strike, "2026-09-18T18:30:00.000Z", 1800,
      0.5, 0.02, 0.1, 10, 0.48, 0.5,
      40, 58, 2, 2, 1.2, -1.2, "YES", 1.2,
      strike === 99_000, "hour-research-v1.0.0", "",
    );
  }
  assert.equal(params.length, rungs.length * HOUR_PREDICTION_COLUMNS.length);
  await pg.query(hourPredictionsInsert(rungs.length), params);
  let n = (await pg.query("select count(*)::int as n from desk_hour_predictions")).rows[0].n;
  assert.equal(Number(n), 60, "every priced rung is stored, not a 41-rung band");

  // A restart that re-reaches the same checkpoint writes nothing.
  await pg.query(hourPredictionsInsert(rungs.length), params);
  n = (await pg.query("select count(*)::int as n from desk_hour_predictions")).rows[0].n;
  assert.equal(Number(n), 60, "a repeated capture cannot double-count");

  const sel = (await pg.query("select count(*)::int as n from desk_hour_predictions where is_selected")).rows[0].n;
  assert.equal(Number(sel), 1, "exactly one rung is marked as the model's choice");
});
