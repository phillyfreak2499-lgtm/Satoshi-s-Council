/**
 * Research factory — the real queue SQL on a real Postgres engine (PGLite),
 * with every migration in migrations/ applied.
 *
 * Proves: duplicate-job prevention, one-job-at-a-time, restart/resume from a
 * lapsed lease with the checkpoint intact, the resource governor pausing a job
 * without burning its retries, bounded retries, idempotent re-grading that
 * never touches the source receipts, and that heavy report work leaves the
 * event loop responsive. Also the wiring rails: env-gated default OFF, kicked
 * by healthz, writes only its own tables, no paid API, no production import.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

async function freshDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  const dir = new URL("migrations/", root).pathname;
  const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".sql")).map((e) => e.name).sort();
  for (const n of names) await db.exec(await readFile(join(dir, n), "utf8"));
  const run = async (text, params) => (await db.query(text, params)).rows;
  const sql = (strings, ...values) => { let text = strings[0]; for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`; return run(text, values); };
  sql.query = (text, params = []) => run(text, params);
  return { db, sql };
}

async function factory(t) {
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  return vite.ssrLoadModule("/src/lib/desk/research-factory.server.ts");
}

/** Jobs in the fixed-clock tests are due from the epoch, so they never depend on the machine's real clock. */
const EPOCH = 0;
const calm = async () => ({ rss_mb: 200, load_per_cpu: 0.1, event_loop_p99_ms: 5, db_waiting: null, db_in_use: null, db_ping_ms: null });
const pressure = async () => ({ rss_mb: 99_999, load_per_cpu: 0.1, event_loop_p99_ms: 5, db_waiting: null, db_in_use: null, db_ping_ms: null });
const jobsOf = (sql) => sql`select job_kind, job_key, status, attempts, checkpoint, guard_reason, error, lease_owner, rows_written, db_queries, cpu_ms, wall_ms from desk_research_jobs order by job_kind, job_key`;

test("duplicate jobs are impossible: the same (kind, key) enqueues once, however often the scheduler runs", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  assert.equal(await m.enqueue(sql, "window", "T|1"), true);
  assert.equal(await m.enqueue(sql, "window", "T|1"), false);
  await seedWindow(sql, "KXBTC15M-A", Date.parse("2026-09-28T15:15:00Z"));
  const now = Date.parse("2026-09-28T16:00:00Z");
  await m.enqueueDue(sql, now);
  await m.enqueueDue(sql, now);
  const rows = await jobsOf(sql);
  assert.equal(rows.filter((r) => r.job_kind === "window").length, 2, "T|1 plus the one settled window with receipts");
  assert.equal(rows.filter((r) => r.job_kind === "rollup").length, 1);
  assert.equal(rows.filter((r) => r.job_kind === "digest").length, 1);
});

test("derived-version replay gets new bounded jobs beside completed old jobs and never rewrites receipts", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const closeMs = Date.parse("2026-09-28T15:15:00Z");
  const now = Date.parse("2026-09-28T16:00:00Z");
  await seedWindow(sql, "KXBTC15M-A", closeMs);
  const oldKey = `KXBTC15M-A|${closeMs}`;
  await m.enqueue(sql, "window", oldKey, {}, EPOCH);
  await sql`update desk_research_jobs set status = 'complete', checkpoint = '{"facts":true,"integrity":true}'::jsonb where job_key = ${oldKey}`;
  const before = JSON.stringify(await sql`select * from desk_shadow_receipts order by arm, kind`);
  await m.enqueueDue(sql, now);
  await m.enqueueDue(sql, now);
  const windows = (await jobsOf(sql)).filter((r) => r.job_kind === "window");
  assert.equal(windows.length, 2, "the old completed job and one versioned replay job");
  assert.equal(windows.find((r) => r.job_key === oldKey).status, "complete");
  const next = windows.find((r) => r.job_key !== oldKey);
  assert.match(next.job_key, /\|f2a2$/);
  assert.deepEqual(next.checkpoint, {});
  const claimed = await m.claim(sql, "version-replay", now);
  assert.equal(claimed.job_key, next.job_key);
  assert.equal(await m.runJob(sql, claimed, "version-replay", { sampler: calm, now: () => now }), "complete");
  const facts = await sql`select distinct fact_version from desk_research_window_facts`;
  const audits = await sql`select distinct auditor_version from desk_research_integrity`;
  assert.deepEqual(facts.map((r) => r.fact_version), [2]);
  assert.deepEqual(audits.map((r) => r.auditor_version), [2]);
  assert.equal(JSON.stringify(await sql`select * from desk_shadow_receipts order by arm, kind`), before);
});

test("one job at a time: nothing is claimed while a live lease exists; a lapsed lease is reclaimed and resumes from its checkpoint; a completed job never runs again", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "A|1", {}, EPOCH);
  await m.enqueue(sql, "window", "B|2", {}, EPOCH);
  const t0 = Date.parse("2026-09-28T16:00:00Z");
  const first = await m.claim(sql, "proc-1", t0);
  assert.equal(first.job_key, "A|1");
  assert.equal(await m.claim(sql, "proc-2", t0 + 1_000), null, "a second process cannot claim while proc-1 holds a live lease");
  // proc-1 checkpoints, then dies without finishing.
  await sql`update desk_research_jobs set checkpoint = '{"facts": true}'::jsonb where job_key = 'A|1'`;
  const lapsed = t0 + 6 * 60_000;
  const again = await m.claim(sql, "proc-2", lapsed);
  assert.equal(again.job_key, "A|1", "the dead process's job is reclaimed first");
  assert.equal(again.attempts, 2);
  assert.deepEqual(again.checkpoint, { facts: true }, "and resumes from its checkpoint");
  const units = [];
  const handler = async (ctx) => { units.push(ctx.job.checkpoint); await ctx.unit(); await ctx.checkpoint({ ...ctx.job.checkpoint, integrity: true }); };
  assert.equal(await m.runJob(sql, again, "proc-2", { sampler: calm, handlers: { window: handler }, now: () => lapsed }), "complete");
  assert.deepEqual(units, [{ facts: true }]);
  const done = (await jobsOf(sql)).find((r) => r.job_key === "A|1");
  assert.equal(done.status, "complete");
  assert.deepEqual(done.checkpoint, { facts: true, integrity: true });
  assert.equal(done.lease_owner, null);
  // The next claim is the other job; the completed one is never offered again.
  const next = await m.claim(sql, "proc-2", lapsed + 1);
  assert.equal(next.job_key, "B|2");
  await m.runJob(sql, next, "proc-2", { sampler: calm, handlers: { window: async () => {} }, now: () => lapsed + 1 });
  assert.equal(await m.claim(sql, "proc-3", lapsed + 10 * 60 * 60_000), null, "nothing left: completed work is not duplicated after a restart");
});

test("the resource governor pauses a job under pressure, keeps its checkpoint and retry budget, and it resumes when pressure clears", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "P|1", {}, EPOCH);
  const t0 = Date.parse("2026-09-28T16:00:00Z");
  let sampler = calm;
  const seen = [];
  const handler = async (ctx) => {
    seen.push({ ...ctx.job.checkpoint });
    if (!ctx.job.checkpoint.step1) { await ctx.unit(); await ctx.checkpoint({ step1: true }); sampler = pressure; }
    await ctx.unit();
    await ctx.checkpoint({ ...ctx.job.checkpoint, step2: true });
  };
  const opts = () => ({ sampler: () => sampler(), handlers: { window: handler }, now: () => t0 });
  const job = await m.claim(sql, "p", t0);
  let pausedFor = [];
  assert.equal(await m.runJob(sql, job, "p", { ...opts(), onResourcePause: (reasons) => { pausedFor = reasons; } }), "skipped_resource_guard");
  assert.deepEqual(pausedFor, ["MEMORY"], "a mid-job governor pause is available to the runtime reporter");
  let row = (await jobsOf(sql))[0];
  assert.equal(row.status, "skipped_resource_guard");
  assert.equal(row.guard_reason, "MEMORY");
  assert.deepEqual(row.checkpoint, { step1: true }, "work done before the pause is kept");
  assert.equal(row.attempts, 0, "a pause does not burn a retry");
  assert.equal(await m.claim(sql, "p", t0 + 30_000), null, "it waits out the back-off");
  sampler = calm;
  const resumed = await m.claim(sql, "p", t0 + 61_000);
  assert.equal(await m.runJob(sql, resumed, "p", { ...opts(), now: () => t0 + 61_000 }), "complete");
  row = (await jobsOf(sql))[0];
  assert.deepEqual(row.checkpoint, { step1: true, step2: true });
  assert.deepEqual(seen, [{}, { step1: true }], "the second run started where the first paused");
  // The tick itself refuses to start work under pressure.
  const tick = await m.factoryTick({ sampler: pressure, now: () => t0 });
  assert.deepEqual(tick, { ran: 0, guard: { run: false, reasons: ["MEMORY"] } });
});

test("guarded rollups back off for fifteen minutes without delaying bounded window retries", async (t) => {
  const m = await factory(t);
  assert.equal(m.resourceGuardBackoffMs("window"), 60_000);
  assert.equal(m.resourceGuardBackoffMs("digest"), 60_000);
  assert.equal(m.resourceGuardBackoffMs("rollup"), 15 * 60_000);

  const { sql } = await freshDb();
  await m.enqueue(sql, "rollup", "2026-09-29T13|r2", {}, EPOCH);
  const job = await m.claim(sql, "p", EPOCH);
  assert.equal(await m.runJob(sql, job, "p", {
    sampler: pressure,
    handlers: { rollup: async (ctx) => { await ctx.unit(); } },
    now: () => EPOCH,
  }), "skipped_resource_guard");
  assert.equal(await m.claim(sql, "p", EPOCH + 14 * 60_000), null,
    "the expensive rollup is not re-read every minute while pressure persists");
  assert.ok(await m.claim(sql, "p", EPOCH + 15 * 60_000 + 1),
    "the rollup becomes eligible after the bounded backoff");
});

test("a governor pause logs bounded measurements and thresholds once per unchanged reason set", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const lines = [];
  const originalWarn = console.warn;
  console.warn = (line) => lines.push(String(line));
  t.after(() => { console.warn = originalWarn; });
  const sample = {
    rss_mb: 200.49,
    load_per_cpu: 0.98765,
    event_loop_p99_ms: 88.84,
    db_waiting: 1,
    db_in_use: 7,
    db_ping_ms: 301.26,
  };

  const env = { RESEARCH_FACTORY_MAX_RSS_MB: "1536" };
  const first = await m.factoryTick({ sql, sampler: async () => sample, env, now: () => EPOCH });
  const second = await m.factoryTick({ sql, sampler: async () => sample, env, now: () => EPOCH + 30_000 });

  assert.deepEqual(first.guard.reasons, ["SYSTEM_LOAD", "REQUEST_LATENCY", "DB_POOL_WAITING", "DB_POOL_BUSY", "DB_LATENCY"]);
  assert.deepEqual(second.guard, first.guard);
  assert.equal(lines.length, 1, "unchanged reasons do not turn low-precision samples into per-tick log spam");
  const payload = JSON.parse(lines[0].replace(/^\[research-factory\] /, ""));
  assert.deepEqual(payload.sample, {
    rss_mb: 200,
    load_per_cpu: 0.988,
    event_loop_p99_ms: 88.8,
    db_waiting: 1,
    db_in_use: 7,
    db_ping_ms: 301.3,
  });
  assert.deepEqual(payload.thresholds, {
    max_rss_mb: 1536,
    max_load_per_cpu: 0.7,
    max_event_loop_p99_ms: 80,
    max_db_waiting: 0,
    max_db_in_use: 6,
    max_db_ping_ms: 300,
  });
  assert.deepEqual(m.boundedResourceSample({ ...sample, load_per_cpu: Number.NaN }), { ...payload.sample, load_per_cpu: "INVALID" });
});

test("the CPU governor uses scoped process work rather than host load average", async (t) => {
  const m = await factory(t);
  assert.equal(m.processCpuPerCapacity(null, { at_ms: 1_000, used_us: 50_000 }, 2), Number.NaN);
  assert.equal(m.processCpuPerCapacity(
    { at_ms: 1_000, used_us: 50_000 },
    { at_ms: 31_000, used_us: 6_050_000 },
    2,
  ), 0.1, "six CPU-seconds over 30 wall-seconds on two CPUs is ten percent of capacity");
  assert.equal(Number.isNaN(m.processCpuPerCapacity(
    { at_ms: 31_000, used_us: 6_050_000 },
    { at_ms: 30_000, used_us: 6_100_000 },
    2,
  )), true, "backward clocks fail closed");
});

test("a warm-up CPU pause reports once again when a measured breach replaces it", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const lines = [];
  const originalWarn = console.warn;
  console.warn = (line) => lines.push(String(line));
  t.after(() => { console.warn = originalWarn; });
  const base = { rss_mb: 200, event_loop_p99_ms: 5, db_waiting: 0, db_in_use: 1, db_ping_ms: 10 };

  await m.factoryTick({ sql, sampler: async () => ({ ...base, load_per_cpu: Number.NaN }), now: () => EPOCH });
  await m.factoryTick({ sql, sampler: async () => ({ ...base, load_per_cpu: 0.9 }), now: () => EPOCH + 30_000 });
  await m.factoryTick({ sql, sampler: async () => ({ ...base, load_per_cpu: 0.91 }), now: () => EPOCH + 60_000 });

  assert.equal(lines.length, 2, "warm-up and first measured breach are distinct, later numeric drift stays deduped");
  assert.equal(JSON.parse(lines[0].replace(/^\[research-factory\] /, "")).sample.load_per_cpu, "INVALID");
  assert.equal(JSON.parse(lines[1].replace(/^\[research-factory\] /, "")).sample.load_per_cpu, 0.9);
});

test("a failing job is retried with back-off and stops at the attempt limit; the error is recorded", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "F|1", {}, EPOCH);
  let now = Date.parse("2026-09-28T16:00:00Z");
  const boom = { window: async () => { throw new Error("boom"); } };
  for (let i = 1; i <= 3; i += 1) {
    const job = await m.claim(sql, "f", now);
    assert.ok(job, `attempt ${i} is offered`);
    assert.equal(await m.runJob(sql, job, "f", { sampler: calm, handlers: boom, now: () => now }), "failed");
    now += 2 * 60 * 60_000;
  }
  assert.equal(await m.claim(sql, "f", now), null, "three attempts, then left failed for a human");
  const row = (await jobsOf(sql))[0];
  assert.equal(row.status, "failed");
  assert.equal(row.error, "boom");
  assert.equal(row.attempts, 3);
});

test("a tick with a failed job reports error rather than healthy progress", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "TICK-FAIL|1", {}, EPOCH);
  const lines = [];
  const originalError = console.error;
  console.error = (line) => lines.push(String(line));
  t.after(() => { console.error = originalError; });

  const result = await m.factoryTick({
    sql,
    sampler: calm,
    handlers: { window: async () => { throw new Error("bounded boom"); } },
    now: () => EPOCH,
  });

  assert.equal(result.ran, 1);
  assert.equal((await jobsOf(sql))[0].status, "failed");
  assert.equal(m.researchFactoryHealth().error, "bounded boom");
  assert.ok(lines.includes(m.researchFactoryLogLine("error", { code: "JOB_FAILED", failed: 1 })));
  assert.equal(lines.some((line) => line.includes("bounded boom")), false, "runtime logs do not expose the stored job error");
  assert.equal(lines.some((line) => line.includes('"status":"progress"')), false);
});

test("a later resource pause cannot hide an earlier failure in the same tick", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "A-FAIL|1", {}, EPOCH);
  await m.enqueue(sql, "window", "B-PAUSE|2", {}, EPOCH);
  let samples = 0;
  const lines = [];
  const originalError = console.error;
  console.error = (line) => lines.push(String(line));
  t.after(() => { console.error = originalError; });

  const result = await m.factoryTick({
    sql,
    sampler: async () => {
      samples += 1;
      return samples === 1 ? calm() : pressure();
    },
    handlers: {
      window: async (ctx) => {
        if (ctx.job.job_key === "A-FAIL|1") throw new Error("first job failed");
        await ctx.unit();
      },
    },
    now: () => EPOCH,
  });

  assert.equal(result.ran, 2);
  assert.deepEqual((await jobsOf(sql)).map((row) => row.status), ["failed", "skipped_resource_guard"]);
  assert.equal(m.researchFactoryHealth().error, "first job failed");
  assert.deepEqual(m.researchFactoryHealth().last_guard, { run: false, reasons: ["MEMORY"] });
  assert.ok(lines.includes(m.researchFactoryLogLine("error", {
    code: "JOB_FAILED",
    failed: 1,
    paused_reasons: ["MEMORY"],
    phase: "job",
  })));
  assert.equal(lines.some((line) => line.includes("first job failed")), false, "combined failure/pause logs remain research-data free");
  assert.equal(lines.some((line) => line.includes('"status":"progress"')), false);
});

// ---------------------------------------------------------------------------
// End to end on seeded research data.
// ---------------------------------------------------------------------------

const LOCKS = "MID_RECOVERY_LOCKS_V1_INACTIVE";
function recoveredPayload(arm, closeMs, { live = false, confirmed = true } = {}) {
  const card = live ? { seat: "DRIFT", card_id: "DRIFT.pullback_in_trend" } : { seat: "STREAK", card_id: "STREAK.continue_young" };
  const checks = ["risk_history", "daily_risk", "complete_window", "direction", "team", "supporters", "families", "opposition", "time", "feeds", "quote", "profit_reserve", "model_edge", "index_fresh", "index_edge"].map((id) => ({ id, pass: true }));
  return {
    version: LOCKS, experiment: LOCKS, arm, ticker: "KXBTC15M-A", close_time: closeMs, as_of: closeMs - 300_000, secs_left: 300, baseline: { side: null },
    candidates: [{ ...card, original_status: live ? "LIVE" : "SHADOW", calibrated_lean: "UP", calibrated_conf: 64, health: "LIVE", hypothesis: card.card_id, survived_fold: true, counted_as_support: true }],
    recovery: { released: [card.card_id], held_seats: [], evaluated_roster: [{ card_id: card.card_id, seat: card.seat, evaluated_lean: "UP", evaluated_conf: 64, evaluated_health: "LIVE", selected_skill_used: "SIT", selected_forced_sit: false }] },
    recovered: { side: "UP", lean: "UP", confidence: 64, eligible: true, families_ok: true, mode: "normal", supporters: [card.seat], families: ["book", "derivs"], checks: [...checks, { id: "confirmation", pass: confirmed }], chair_trace: { score: 0.7, bar: 0.6, vs_bar: 0.7, hard_fail: false, bar_breakdown: { sit_mass: 0.2 } } },
    confirmation: { confirmed, frames: 3 }, economics: { ask_cents: 85, spread_cents: 1, model_edge_cents: 5, index_margin_cents: 4, floor_ok: true, ceiling_ok: true, spread_ok: true, size_ok: true },
    simulated: { qualified: confirmed, booked: confirmed }, funnel_stage_index: 9,
  };
}

async function seedWindow(sql, ticker, closeMs, { liveBar = false } = {}) {
  const close = new Date(closeMs).toISOString();
  const decided = new Date(closeMs - 300_000).toISOString();
  await sql`insert into desk_ledger (ticker, close_time, source, winner, chair_lean) values (${ticker}, ${close}::timestamptz, 'kalshi-result', 'UP', 'WAIT')`;
  await sql`insert into desk_decision_snapshots (ticker, close_time, snapshot_kind, decision_at, chair_lean, regime_key, yes_ask, no_ask, atr, spot, strike)
    values (${ticker}, ${close}::timestamptz, 'OPENING', ${new Date(closeMs - 840_000).toISOString()}::timestamptz, 'WAIT', 'trend-quiet', 85, 16, 50, 80100, 80000)`;
  const rows = [
    ["CONTROL", "fill", recoveredPayload("CONTROL", closeMs)],
    ["BAR_NO_SITMASS", "fill", { ...recoveredPayload("BAR_NO_SITMASS", closeMs, { live: liveBar }), ticker }],
    ["COMBINED_DIAG", "fill", recoveredPayload("COMBINED_DIAG", closeMs)],
    ["NULL_FAV_80", "fill", { checkpoint: 450, experiment: LOCKS, arm: "NULL_FAV_80" }],
  ];
  for (const [arm, kind, payload] of rows) {
    const p = { ...payload, ticker };
    await sql`insert into desk_shadow_receipts (experiment, arm, ticker, close_time, kind, decided_at, side, ask_cents, fee_engine, fee_cents, payload, build_sha, recorded_at)
      values (${LOCKS}, ${arm}, ${ticker}, ${close}::timestamptz, ${kind}, ${decided}::timestamptz, 'UP', 85, 'KALSHI_TAKER_7PCT_CEIL_V1', 2, ${JSON.stringify(p)}::jsonb, 'abc1234', ${decided}::timestamptz)`;
  }
}

test("end to end: window jobs re-grade and audit without touching the receipts, re-running writes nothing new, and the rollup reports P2 and COMBINED_DIAG correctly", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const base = Date.parse("2026-09-28T15:15:00Z");
  for (let i = 0; i < 4; i += 1) await seedWindow(sql, `KXBTC15M-W${i}`, base + i * 900_000, { liveBar: i % 2 === 0 });
  const receiptsBefore = JSON.stringify(await sql`select * from desk_shadow_receipts order by ticker, arm, kind`);
  const now = base + 4 * 900_000 + 600_000;
  await m.enqueueDue(sql, now);
  let ran = 0;
  for (;;) {
    const job = await m.claim(sql, "e2e", now);
    if (!job) break;
    const status = await m.runJob(sql, job, "e2e", { sampler: calm, now: () => now });
    assert.notEqual(status, "failed", JSON.stringify((await jobsOf(sql)).filter((r) => r.error)));
    ran += 1;
  }
  assert.ok(ran >= 5, `windows + rollup ran (${ran})`);
  assert.equal(JSON.stringify(await sql`select * from desk_shadow_receipts order by ticker, arm, kind`), receiptsBefore, "source receipts are byte-identical");
  const facts = await sql`select experiment, arm, replay_quality, net_cents from desk_research_window_facts order by ticker, experiment, arm`;
  assert.equal(facts.length, 4 * 5, "four LOCKS arms + production per window");
  assert.ok(facts.filter((f) => f.experiment === LOCKS).every((f) => f.replay_quality === "EXACT"), JSON.stringify(facts.filter((f) => f.replay_quality !== "EXACT")));
  const notes = await sql`select arm, integrity_status, reason_codes from desk_research_integrity order by ticker, arm`;
  const bar = notes.filter((n) => n.arm === "BAR_NO_SITMASS");
  assert.deepEqual(bar.map((n) => n.integrity_status), ["SUSPECT", "CLEAN", "SUSPECT", "CLEAN"], "the P2 path is annotated, not deleted");
  assert.ok(bar[0].reason_codes.includes("P2_LIVE_CARD_NOT_SELECTED"));
  // Idempotent re-grading: running the handler again writes nothing.
  const factsN = (await sql`select count(*)::int as n from desk_research_window_facts`)[0].n;
  const notesN = (await sql`select count(*)::int as n from desk_research_integrity`)[0].n;
  let written = 0;
  await m.windowHandler({ sql, job: { job_kind: "window", job_key: `KXBTC15M-W0|${base}`, params: { ticker: "KXBTC15M-W0", close_ms: base }, checkpoint: {}, attempts: 1 }, nowMs: now, checkpoint: async () => {}, unit: async () => {}, scanned: () => {}, written: (n) => { written += n; } });
  assert.equal(written, 0);
  assert.equal((await sql`select count(*)::int as n from desk_research_window_facts`)[0].n, factsN);
  assert.equal((await sql`select count(*)::int as n from desk_research_integrity`)[0].n, notesN);
  // Reports.
  const report = async (kind) => (await sql`select payload from desk_research_reports where report_kind = ${kind} and report_key = 'latest'`)[0]?.payload;
  const life = await report("lifecycle");
  const combined = life.rows.find((r) => r.arm === "COMBINED_DIAG");
  assert.equal(combined.status, "DIAGNOSTIC_ONLY");
  assert.equal(combined.promotion_eligible, false);
  assert.ok(life.rows.every((r) => r.authority === "NONE"));
  assert.equal(life.rows.find((r) => r.arm === "BAR_NO_SITMASS").current_sample.suspect_fills, 2);
  assert.equal(life.rows.find((r) => r.arm === "BAR_NO_SITMASS").current_sample.clean_settled_fills, 2, "only the clean half counts");
  const safety = await report("evidence_safety");
  assert.equal(safety.rows.find((r) => r.arm === "BAR_NO_SITMASS").safe_to_use, "CLEAN_SUBSET_ONLY");
  assert.equal(safety.rows.find((r) => r.arm === "COMBINED_DIAG").safe_to_use, "NONE");
  const grade = await report("matched_grade");
  assert.equal(grade.experiments[0].matched_windows, 4);
  for (const k of ["choke_attribution", "pockets", "counterfactual_gates", "utilization"]) assert.ok(await report(k), k);
  const util = await report("utilization");
  assert.ok(util.jobs >= 4 && util.research_compute_utilization != null);
  const jobs = await jobsOf(sql);
  assert.ok(jobs.filter((j) => j.status === "complete").every((j) => j.db_queries > 0 && j.wall_ms > 0), "every completed job records its telemetry");
  for (const kind of ["window", "rollup"]) {
    const js = jobs.filter((j) => j.job_kind === kind && j.status === "complete");
    const avg = (k) => (js.reduce((a, j) => a + Number(j[k] ?? 0), 0) / Math.max(1, js.length)).toFixed(1);
    t.diagnostic(`${kind}: ${js.length} jobs, avg cpu ${avg("cpu_ms")} ms, avg wall ${avg("wall_ms")} ms, avg db queries ${avg("db_queries")}`);
  }
});

test("the public HTTP path stays responsive: a rollup over thousands of windows never blocks the event loop for long", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const base = Date.parse("2026-08-01T00:15:00Z");
  const N = 3_000;
  const arms = ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG", "NULL_FAV_80"];
  const facts = [];
  for (let i = 0; i < N; i += 1) for (const arm of arms) facts.push({ i, arm });
  // Bulk-insert synthetic facts and annotations directly (the rollup reads only these tables).
  await sql.query(`insert into desk_research_window_facts (ticker, close_time, experiment, arm, fact_version, replay_quality, observed, side, ask_cents, fee_cents, official_winner, funnel_stage, first_blocker, facts)
    select 'T' || g, to_timestamp(${base / 1000} + g * 900), '${LOCKS}', a, 2, 'EXACT', true,
      case when g % 3 = 0 then 'UP' end, case when g % 3 = 0 then 85 end, case when g % 3 = 0 then 2 end, case when g % 2 = 0 then 'UP' else 'DOWN' end,
      case when g % 3 = 0 then 'SIMULATED_BOOKED' else 'SUPPORTERS' end, case when g % 3 = 0 then null else 'FAMILIES' end,
      jsonb_build_object('candidate_count', 1, 'recorded_side', 'UP', 'checks', '[]'::jsonb, 'candidate_seats', jsonb_build_array('STREAK'), 'context', jsonb_build_object('regime', 'r' || (g % 4)))
    from generate_series(0, ${N - 1}) g, unnest(array['${arms.join("','")}']) a`);
  await sql.query(`insert into desk_research_integrity (experiment, arm, ticker, close_time, kind, auditor_version, integrity_status)
    select experiment, arm, ticker, close_time, 'fill', 2, 'CLEAN' from desk_research_window_facts`);
  await m.enqueue(sql, "rollup", "load-test");
  // The assertion: MAIN-THREAD CPU time spent between two consecutive yields (governor checks).
  // That is exactly what holds the event loop, and unlike a wall-clock probe it is inflated neither
  // by other processes competing for the machine (CI runs test files in parallel) nor by GC threads.
  const threadCpu = (prev) => (process.threadCpuUsage ? process.threadCpuUsage(prev) : process.cpuUsage(prev));
  let segments = 0, maxSegmentCpuMs = 0;
  const segmentMs = [];
  let lastCpu = null;
  const sampler = async () => {
    const c = threadCpu(lastCpu ?? undefined);
    const ms = (c.user + c.system) / 1000;
    maxSegmentCpuMs = Math.max(maxSegmentCpuMs, ms);
    segmentMs.push(ms);
    segments += 1;
    lastCpu = threadCpu();
    return calm();
  };
  let maxLag = 0;
  let last = performance.now();
  const probe = setInterval(() => { const n = performance.now(); maxLag = Math.max(maxLag, n - last - 5); last = n; }, 5);
  const job = await m.claim(sql, "load", Date.now());
  const started = performance.now();
  lastCpu = threadCpu();
  const status = await m.runJob(sql, job, "load", { sampler });
  const took = performance.now() - started;
  clearInterval(probe);
  assert.equal(status, "complete");
  assert.ok(segments >= 10, `the rollup yielded between units (${segments} governor checks)`);
  // p90 catches systematic blocking; the max bound tolerates one main-thread GC pause but still
  // fails the unsliced design this replaced (one 500+ ms read, ~200 ms multi-arm report builds).
  const p90 = [...segmentMs].sort((a, b) => a - b)[Math.floor(segmentMs.length * 0.9)];
  assert.ok(p90 < 120, `p90 synchronous segment ${p90.toFixed(0)} ms of main-thread CPU`);
  assert.ok(maxSegmentCpuMs < 400, `longest synchronous segment used ${maxSegmentCpuMs.toFixed(0)} ms of main-thread CPU`);
  t.diagnostic(`rollup of ${N * arms.length} facts: ${took.toFixed(0)} ms wall, ${segments} yields, p90 segment ${p90.toFixed(0)} ms, longest synchronous segment ${maxSegmentCpuMs.toFixed(0)} ms main-thread CPU, longest wall-clock stall ${maxLag.toFixed(0)} ms (includes machine contention)`);
});

// ---------------------------------------------------------------------------
// Rails.
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const rel = `${dir}${name}`;
    if (statSync(new URL(rel, root)).isDirectory()) walk(`${rel}/`, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

test("rails: default OFF on a literal flag, kicked by healthz, writes only its own tables, no paid API, and production imports none of it", async (t) => {
  const m = await factory(t);
  assert.equal(m.researchFactoryLogLine("paused", { reasons: ["MEMORY"] }), '[research-factory] {"status":"paused","reasons":["MEMORY"]}');
  assert.equal(m.researchFactoryLogLine("error", { code: "TICK_FAILED" }), '[research-factory] {"status":"error","code":"TICK_FAILED"}');
  for (const v of [undefined, "", "TRUE", "1", "yes"]) assert.equal(m.ensureResearchFactory({ RESEARCH_FACTORY_ENABLED: v }), "disabled", String(v));
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/research-factory\.server"\)\s*\.then\(\(m\) => m\.ensureResearchFactory\(\)\)\s*\.catch\(\(\) => console\.error\('\[research-factory\] \{"status":"error","code":"STARTUP_IMPORT_FAILED"\}'\)\);/);
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/research-factory-tape\.server"\)\s*\.then\(\(m\) => m\.ensureDecisionTape\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  const files = ["src/lib/desk/research-factory.ts", "src/lib/desk/research-factory-analysis.ts", "src/lib/desk/research-factory-reports.ts", "src/lib/desk/research-factory.server.ts",
    "src/lib/desk/research-factory-tape.ts", "src/lib/desk/research-factory-insight.ts", "src/lib/desk/research-factory-tape.server.ts",
    "src/lib/desk/book-depth.ts", "src/lib/desk/book-depth.server.ts", "src/lib/desk/trade-flow.ts", "src/lib/desk/trade-flow.server.ts",
    "src/lib/desk/wick-effort.ts", "src/lib/desk/wick-effort.server.ts"];
  for (const f of files) {
    const src = codeOf(f);
    const writes = [...src.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+(?:\w+\s+)?set|delete from\s+(\w+)/gi)].map((x) => x[1] || x[2] || x[3]);
    for (const w of writes) assert.match(w, /^desk_research_(jobs|window_facts|integrity|reports|decision_tape|book_depth|flow_minutes|flow_marks|wick_shadow)$/, `${f} writes ${w}`);
    assert.doesNotMatch(src, /openai|anthropic|api\.kalshi|noteCall\(|applyDeskOp\(|promoteToLive|setKnob|reviewSeats|saveSettings/i, `${f} reaches a paid API or production state`);
    if (f !== "src/lib/desk/trade-flow.server.ts") assert.doesNotMatch(src, /fetch\(/, `${f} fetches`);
  }
  // The flow collector's only network reads: public market-data hosts, each checked against the allowlist before any fetch.
  const flowSrc = codeOf("src/lib/desk/trade-flow.server.ts");
  const hosts = [...new Set([...flowSrc.matchAll(/https?:\/\/([^/"'`\s]+)/g)].map((x) => x[1]))].sort();
  assert.deepEqual(hosts, ["api.exchange.coinbase.com", "www.okx.com"]);
  assert.match(flowSrc, /if \(!FLOW_HOSTS\.includes\(new URL\(url\)\.host\)\) throw/);
  assert.doesNotMatch(flowSrc, /authorization|api[-_]?key|secret|method:\s*"(POST|PUT|DELETE)"/i, "unauthenticated GETs only");
  assert.doesNotMatch(codeOf("src/lib/desk/research-factory.server.ts"), /delete from|drop table|truncate/i, "never deletes research history");
  for (const f of walk("src/").concat(walk("server/"))) {
    if (f === "server/routes/healthz.get.ts" || f === "server/routes/research/factory.get.ts" || f === "server/routes/research/reports.get.ts" || f.startsWith("src/lib/desk/research-factory") || f.startsWith("src/lib/desk/book-depth") || f.startsWith("src/lib/desk/trade-flow") || f.startsWith("src/lib/desk/wick-effort")) continue;
    assert.ok(!read(f).includes("research-factory"), `${f} imports the research factory`);
  }
  for (const prod of ["chair.ts", "bots.ts", "server-engine.ts", "selective-entry.ts", "book-floor.ts", "gate-vector.ts", "floor-policy.ts", "call-recovery-candidate.ts"]) {
    assert.doesNotMatch(read(`src/lib/desk/${prod}`), /research-factory|desk_research_|book-depth|labBookDepth|trade-flow|wick-effort/, `${prod} is untouched by the factory and the collectors`);
  }
  assert.match(read("server/routes/research/factory.get.ts"), /adminKeyOk\(key\)\) return new Response\("not found", \{ status: 404 \}\)/);
  // The reports page: the same 404 guard, static HTML under a no-script CSP, and the key never passed to the renderer.
  const page = read("server/routes/research/reports.get.ts");
  assert.match(page, /adminKeyOk\(key\)\) return new Response\("not found", \{ status: 404 \}\)/);
  assert.match(page, /"content-security-policy": "default-src 'none'; style-src 'unsafe-inline';/);
  assert.match(page, /researchReportsPage\(\)/, "the renderer is called without the key");
  assert.doesNotMatch(codeOf("src/lib/desk/research-factory-page.ts"), /insert into|update \w+ set|delete from|fetch\(|process\.env/i, "the page renderer is pure");
  // The auditor's P2 boundary is the producer's capture policy, held as data: the two literals must stay equal.
  const policy = /export const CAPTURE_POLICY = "([A-Z0-9_]+)" as const;/.exec(read("src/lib/desk/bots.ts"))?.[1];
  assert.ok(policy, "bots.ts exports CAPTURE_POLICY");
  assert.match(read("src/lib/desk/research-factory-analysis.ts"), new RegExp(`export const P2_FIXED_POLICY = "${policy}";`));
  assert.match(read("src/lib/desk/shadow-lab-mid-recovery-locks.ts"), /capture_policy: frame\.capture_policy \?\? null/, "the LOCKS arm carries the producer's stamp");
  assert.match(read("src/lib/desk/shadow-lab-mid-recovery-locks.server.ts"), /capture_policy: a\.capture_policy,/, "and writes it into every receipt");
});

// ---------------------------------------------------------------------------
// The production decision tape.
// ---------------------------------------------------------------------------

function loader(deps = {}, env = {}) {
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
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, Promise, Error, structuredClone, setInterval: () => ({ unref() {} }), clearInterval: () => {}, globalThis: {}, console, process: { env: { ...env } } });
    return exports;
  }
  return load;
}
const TAPE = "src/lib/desk/research-factory-tape.server.ts";
const tapeClose = Date.parse("2026-09-28T15:15:00Z");
const tapeSnap = (secsLeft, extra = {}) => ({
  as_of: tapeClose - secsLeft * 1000, close_time: tapeClose, ticker: "KXBTC15M-TAPE", mins_left: secsLeft / 60, secs_left: secsLeft, demo: false,
  yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, no_bid_size: 40, yes_bid_size: 30, yes_mid: 84.5, edge_up: 5, edge_down: -9, lab_fair_yes: 92, lab_age_s: 1, quote_seq: 1, regime_key: "trend-quiet",
  obs: { receipt_ts: tapeClose - secsLeft * 1000, gap: "ok" }, health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE" }, ...extra,
});
const tapeChair = (lean = "WAIT", vs = 0.4) => ({
  lean, score: 0.5, vs_bar: vs, bar: 0.5, dir_mass: 0.2, sit_mass: 0.9, aggressiveness: 1.15, confidence: 60,
  bar_breakdown: { sit_mass: 0.16, pre_clamp: 0.5 }, gates: [{ id: "bar", label: "bar", pass: lean !== "WAIT", hard: true, value: "" }],
  quorum: { up: 2, down: 0, wait: 1 }, rows: [{ seat: "STREAK", lean: "UP", health: "LIVE", status: "LIVE", folded: false, weight: 0.1, forced_sit: false, conf: 64 }, { seat: "CHAIN", lean: "UP", health: "LIVE", status: "LIVE", folded: false, weight: 0.1, forced_sit: false, conf: 64 }],
});
const AUDIT_IDS = ["risk_history", "daily_risk", "complete_window", "direction", "team", "supporters", "families", "opposition", "time", "feeds", "quote", "profit_reserve", "model_edge", "index_fresh", "index_edge", "confirmation"];
/** A full production admission audit: directional frames pass everything but confirmation; WAIT frames leave side checks unevaluated. */
const tapeAudit = (lean) => ({ mode: "normal", positioned: false, eligible: false, checks: AUDIT_IDS.map((id) => ({ id, label: id,
  pass: id === "confirmation" ? (lean === "WAIT" ? null : false) : id === "direction" ? lean !== "WAIT" : lean === "WAIT" && ["team", "supporters", "families", "opposition", "quote", "profit_reserve", "model_edge", "index_edge"].includes(id) ? null : true })) });
const tapeFrame = (secsLeft, lean = "WAIT", vs = 0.4) => ({ snap: tapeSnap(secsLeft), chair: tapeChair(lean, vs), call_log: [], selective: { policy: "ENTRY_OWNER_ROLLBACK_V1", audit: tapeAudit(lean), daily: { tightened: false } } });

test("decision tape E1 paper: checkpoint receipts copy actual published outputs without changing decisions or sampling", async () => {
  const calls = [];
  const sql = async (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return [{ ok: 1 }]; };
  let frame = { ...tapeFrame(610), votes: [{ seat: "STRIKE", paper: [{ id: "STRIKE.itm_time", lean: "UP", confidence: 61, status: "SHADOW" }] }] };
  const pure = loader()("src/lib/desk/research-factory-tape.ts");
  const input = () => ({ snap: frame.snap, chair: frame.chair, audit: frame.selective.audit, daily: frame.selective.daily, call_log: frame.call_log });
  assert.equal(JSON.stringify(pure.classifyTape({ ...input(), votes: frame.votes })), JSON.stringify(pure.classifyTape({ ...input(), votes: frame.votes.map((v) => ({ ...v, paper: [] })) })), "published papers cannot alter classification bytes");
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { RENDER_GIT_COMMIT: "paper-observation-build" })(TAPE);
  const before = JSON.stringify(frame);
  await mod.decisionTapeTick(frame.snap.as_of);
  assert.equal(JSON.stringify(frame), before);
  assert.equal(JSON.parse(calls[0].values[11]).e1_paper, undefined, "change-only record has no papers");
  frame = { ...frame, snap: tapeSnap(598) };
  const rec = await mod.decisionTapeTick(frame.snap.as_of);
  const row = calls[1];
  const payload = JSON.parse(row.values[11]);
  assert.equal(row.values[4], 600);
  assert.equal(row.values[0], frame.snap.ticker);
  assert.equal(row.values[1], new Date(frame.snap.close_time).toISOString());
  assert.equal(row.values[2], new Date(frame.snap.as_of).toISOString());
  assert.equal(row.values[12], "paper-observation-build");
  assert.deepEqual(payload.e1_paper.outputs, [{ kind: "PAPER_EVALUATED", card_id: "STRIKE.itm_time", seat: "STRIKE", lean: "UP", conf: 61, status: "SHADOW" }]);
  assert.equal(payload.e1_paper.authority, "NONE");
  assert.equal(payload.e1_paper.qualification, "UNKNOWN");
  assert.equal(payload.e1_paper.missing.length, 5);
  delete payload.e1_paper; delete payload.seats;
  assert.equal(JSON.stringify(payload), JSON.stringify(rec), "supplemental field cannot alter decision payload");
  frame = { ...frame, snap: tapeSnap(590), votes: [{ seat: "STRIKE", paper: [{ id: "STRIKE.itm_time", lean: "DOWN", confidence: 99, status: "LIVE" }] }] };
  await mod.decisionTapeTick(frame.snap.as_of);
  assert.equal(calls.length, 2, "paper changes alone cannot trigger inserts");
  assert.equal(pure.MAX_EVENTS_PER_WINDOW, 80);
  assert.equal(pure.CHECKPOINTS.length, 7);
});

test("decision tape E1 paper: missing source, wrong owner/card, malformed and duplicate receipts stay explicitly unavailable", () => {
  const { observeE1Paper } = loader()("src/lib/desk/research-factory-tape.ts");
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.equal(observeE1Paper(undefined).missing.length, 6);
  assert.ok(observeE1Paper(undefined).missing.every((r) => r.reason === "PAPER_SOURCE_MISSING"));
  const empty = observeE1Paper([{ seat: "STRIKE", paper: [] }]);
  assert.equal(empty.missing.find((r) => r.card_id === "STRIKE.itm_time").reason, "CARD_NOT_PRESENT");
  const selected = observeE1Paper([{ seat: "STRIKE", skill_used: "STRIKE.itm_time", paper: [] }]);
  assert.equal(selected.missing.find((r) => r.card_id === "STRIKE.itm_time").reason, "ACTIVE_SELECTION_NOT_IN_PAPER", "selected output is separate and never synthesized into papers");
  const down = observeE1Paper([{ seat: "STRIKE", skill_used: "SIT", health: "DOWN", paper: [] }]);
  assert.equal(down.outputs.length, 0);
  assert.equal(down.qualification, "UNKNOWN", "feed-down empty papers cannot establish a qualifying read");
  const wrong = observeE1Paper([{ seat: "CHAIN", paper: [{ id: "STRIKE.itm_time", lean: "UP", confidence: 60, status: "LIVE" }, { id: "CHAIN.unknown", lean: "UP", confidence: 60, status: "LIVE" }] }]);
  assert.equal(wrong.outputs.length, 0);
  const receipt = { id: "STRIKE.itm_time", lean: "UP", confidence: 60, status: "BENCH" };
  for (const bad of [{ lean: "ADD" }, { confidence: NaN }, { confidence: 101 }, { status: "SIT" }]) {
    const result = observeE1Paper([{ seat: "STRIKE", paper: [{ ...receipt, ...bad }] }]);
    assert.equal(result.outputs.length, 0);
    assert.equal(result.missing.find((r) => r.card_id === receipt.id).reason, "MALFORMED_RECEIPT");
  }
  const duplicate = observeE1Paper([{ seat: "STRIKE", paper: [receipt, receipt] }]);
  assert.equal(duplicate.outputs.length, 0);
  assert.equal(duplicate.missing.find((r) => r.card_id === receipt.id).reason, "DUPLICATE_RECEIPT");
  assert.equal(plain(observeE1Paper([{ seat: "STRIKE", paper: [receipt] }])).outputs[0].status, "BENCH", "bench/exploit-rejected output is observed without promotion");
});

test("decision tape: env-gated on a literal flag; records checkpoints and changes only; marks the window open at boot partial; never mutates the frame", async () => {
  const off = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } })(TAPE);
  for (const v of [undefined, "TRUE", "1", "yes"]) assert.equal(off.ensureDecisionTape({ RESEARCH_DECISION_TAPE_ENABLED: v }), "disabled", String(v));
  const { sql, calls } = (() => { const calls = []; const sql = async (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return [{ ok: 1 }]; }; return { sql, calls }; })();
  let frame = tapeFrame(610);
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } })(TAPE);
  assert.equal(mod.ensureDecisionTape({ RESEARCH_DECISION_TAPE_ENABLED: "true" }, tapeClose - 611_000), "started", "the session starts inside this window");
  const inserts = () => calls.filter((c) => /^\s*insert into desk_research_decision_tape/.test(c.text)).map((c) => ({ secs: c.values[3], checkpoint: c.values[4], label: c.values[6], partial: c.values[10], record: JSON.parse(c.values[11]) }));
  const before = JSON.stringify(frame);
  await mod.decisionTapeTick(tapeClose - 610_000);             // first frame of the window: a change
  assert.equal(JSON.stringify(frame), before, "the published frame is never mutated");
  await mod.decisionTapeTick(tapeClose - 610_000);             // the same frame again: nothing
  frame = tapeFrame(598); await mod.decisionTapeTick(tapeClose - 598_000); // T-10 checkpoint, same state: recorded as a brief
  frame = tapeFrame(590); await mod.decisionTapeTick(tapeClose - 590_000); // same state, no checkpoint: not recorded
  frame = tapeFrame(500, "UP", 0.6); await mod.decisionTapeTick(tapeClose - 500_000); // the Chair turns directional: a change
  const rows = inserts();
  assert.deepEqual(rows.map((r) => [r.secs, r.checkpoint, r.label]), [[610, null, "DIRECTION_BELOW_BAR"], [598, 600, "DIRECTION_BELOW_BAR"], [500, null, "CONFIRMATION_INCOMPLETE"]]);
  assert.ok(rows.every((r) => r.record.raw.policy === frame.selective.policy), "the actual production entry policy survives the observer adapter and durable payload");
  assert.ok(rows.every((r) => r.partial === true), "this window was already open when the observer started");
  assert.ok(rows.find((r) => r.checkpoint === 600).record.seats?.length === 2, "seat reads ride on checkpoint briefs");
  assert.equal(rows.find((r) => r.checkpoint == null).record.seats, undefined, "change events stay compact");
  assert.equal(rows[1].record.conditions[0].metric, "vs_bar_minus_bar");
  assert.ok(calls.every((c) => /^\s*insert into desk_research_decision_tape/.test(c.text)), "writes only its own table");
  assert.equal(mod.decisionTapeHealth().production_authority, "NONE");
});

async function seedTape(m, sql, ticker, closeMs, events) {
  for (const [secsLeft, lean, vs, checkpoint] of events) {
    const f = tapeFrame(secsLeft, lean, vs);
    const rec = m.classifyTape({ snap: { ...f.snap, ticker, close_time: closeMs, as_of: closeMs - secsLeft * 1000 }, chair: f.chair, audit: f.selective.audit, daily: f.selective.daily, call_log: [] });
    await sql`insert into desk_research_decision_tape (ticker, close_time, as_of, secs_left, checkpoint_secs, state, label, stage, primary_blocker, blockers, partial_window, record, build_sha)
      values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, ${new Date(closeMs - secsLeft * 1000).toISOString()}::timestamptz, ${secsLeft}, ${checkpoint}, ${rec.state}, ${rec.label}, ${rec.stage},
        ${rec.primary_blocker}, array(select jsonb_array_elements_text(${JSON.stringify(rec.blockers)}::jsonb)), false, ${JSON.stringify(rec)}::jsonb, 'abc1234')`;
  }
}

test("tape end to end: window jobs grade each settled window's tape; the rollup writes every tape and insight report", async (t) => {
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const m = await vite.ssrLoadModule("/src/lib/desk/research-factory.server.ts");
  const tapeMod = await vite.ssrLoadModule("/src/lib/desk/research-factory-tape.ts");
  const { sql } = await freshDb();
  const base = Date.parse("2026-09-28T15:15:00Z");
  for (let i = 0; i < 3; i += 1) {
    const ticker = `KXBTC15M-TAPE${i}`, closeMs = base + i * 900_000;
    await sql`insert into desk_ledger (ticker, close_time, source, winner, chair_lean) values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, 'kalshi-result', 'UP', 'WAIT')`;
    await seedTape(tapeMod, sql, ticker, closeMs, [[600, "WAIT", 0.4, 600], [450, "WAIT", 0.45, 450], [400, "UP", 0.6, null], [300, "UP", 0.6, 300]]);
  }
  const now = base + 3 * 900_000 + 600_000;
  await m.enqueueDue(sql, now);
  for (;;) {
    const job = await m.claim(sql, "tape", now);
    if (!job) break;
    assert.notEqual(await m.runJob(sql, job, "tape", { sampler: calm, now: () => now }), "failed", JSON.stringify((await jobsOf(sql)).filter((r) => r.error)));
  }
  const facts = await sql`select experiment, arm, replay_quality, facts from desk_research_window_facts where experiment = 'PRODUCTION_TAPE' order by ticker`;
  assert.equal(facts.length, 3, "one graded tape timeline per settled window");
  assert.equal(facts[0].facts.timeline.became_directional, true);
  assert.equal(facts[0].facts.timeline.briefs.find((b) => b.checkpoint === 600).next_blocker, "CONFIRMATION_INCOMPLETE");
  const report = async (kind) => (await sql`select payload from desk_research_reports where report_kind = ${kind} and report_key = 'latest'`)[0]?.payload;
  for (const k of ["abstention", "transitions", "brief_accuracy", "survival", "stage_unlocks", "signal_value", "research_summary"]) assert.ok(await report(k), k);
  const tr = await report("transitions");
  assert.equal(tr.rolling[tr.rolling.length - 1].windows, 3);
  assert.deepEqual(tr.rolling[0].matrix.map((x) => [x.from, x.to, x.count]), [["DIRECTION_BELOW_BAR", "CONFIRMATION_INCOMPLETE", 3]]);
  const summary = await report("research_summary");
  assert.deepEqual(summary.authority, { production_authority: "NONE", automatic_changes: false });
  const grade = await report("matched_grade");
  assert.equal(grade.experiments.some((e) => e.experiment.startsWith("PRODUCTION")), false, "the tape is never graded as an experiment");
});

// ---------------------------------------------------------------------------
// Kalshi order-book depth collector.
// ---------------------------------------------------------------------------

const DEPTH = "src/lib/desk/book-depth.server.ts";

test("depth collector: env-gated on a literal flag; one snapshot per fixed clock per window; a missing book is recorded as missing; writes only its own table", async () => {
  const off = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } })(DEPTH);
  for (const v of [undefined, "TRUE", "1", "yes"]) assert.equal(off.ensureBookDepth({ RESEARCH_BOOK_DEPTH_ENABLED: v }), "disabled", String(v));
  const calls = [];
  const sql = async (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return [{ ok: 1 }]; };
  const close = Date.parse("2026-09-28T15:15:00Z");
  let book = { ticker: "KXBTC15M-DEPTH", view: { bids: [{ price: 84, size: 100 }], asks: [{ price: 85, size: 40 }] }, ok: true, stale: false, gaps: 0, flips: 0, snap_t: close - 700_000, upd_t: close - 602_000, level_count: 2, trusted: true };
  const frame = { snap: { ticker: "KXBTC15M-DEPTH", close_time: close, as_of: close - 601_000, demo: false, yes_bid: 84, yes_ask: 85, no_bid: 15, no_ask: 16, yes_mid: 84.5, quote_seq: 3 } };
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame }, "./lab.server": { labBookDepth: (t) => (t === book?.ticker ? structuredClone(book) : null) } })(DEPTH);
  const inserts = () => calls.filter((c) => /^\s*insert into desk_research_book_depth/.test(c.text)).map((c) => ({ clock: c.values[2], clean: c.values[5], quality: JSON.parse(c.values[6]), features: c.values[7] == null ? null : JSON.parse(c.values[7]) }));
  await mod.bookDepthTick(close - 700_000);                    // T-11:40: no clock
  assert.equal(inserts().length, 0);
  await mod.bookDepthTick(close - 600_000);                    // T-10:00
  await mod.bookDepthTick(close - 598_000);                    // still T-10 grace: already taken
  frame.snap.as_of = close - 300_500; book = { ...book, upd_t: close - 301_000 };
  await mod.bookDepthTick(close - 300_000);                    // T-5:00
  book = null;
  frame.snap.as_of = close - 180_500;
  await mod.bookDepthTick(close - 180_000);                    // T-3:00 with no book
  const rows = inserts();
  assert.deepEqual(rows.map((r) => [r.clock, r.clean]), [[600, true], [300, true], [180, false]]);
  assert.deepEqual(rows[2].quality.flags, ["BOOK_MISSING"]);
  assert.equal(rows[2].features, null);
  assert.equal(rows[1].features.bid_added, 0, "flow is measured against this window's previous snapshot");
  assert.ok(calls.every((c) => /^\s*insert into desk_research_book_depth/.test(c.text)), "writes only its own table");
  assert.equal(mod.bookDepthHealth().decision_use, "NONE");
  assert.equal(mod.bookDepthHealth().book_missing, 1);
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/book-depth\.server"\)\s*\.then\(\(m\) => m\.ensureBookDepth\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  // The Lab accessor returns copies and never touches a book.
  assert.match(read("src/lib/desk/lab.server.ts"), /export function labBookDepth\(ticker: string\)[\s\S]*?view: yesView\(b\)/);
});

test("book_depth report: the rollup reports collection quality and holds the H0 until its minimum clean sample", async (t) => {
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const m = await vite.ssrLoadModule("/src/lib/desk/research-factory.server.ts");
  const d = await vite.ssrLoadModule("/src/lib/desk/book-depth.ts");
  const { sql } = await freshDb();
  const base = Date.parse("2026-09-28T15:15:00Z");
  for (let i = 0; i < 4; i += 1) {
    const closeMs = base + i * 900_000, ticker = `KXBTC15M-BD${i}`;
    await sql`insert into desk_ledger (ticker, close_time, source, winner, chair_lean) values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, 'kalshi-result', 'UP', 'WAIT')`;
    for (const clock of [600, 300, 180, 60]) {
      if (i === 3 && clock === 180) continue; // one missed clock: coverage must show it
      const shot = d.depthSnapshot(clock, { ticker, as_of: closeMs - clock * 1000, close_time: closeMs, yes_bid: 84, yes_ask: 85, no_bid: 15, no_ask: 16, yes_mid: 84.5, quote_seq: 1 },
        i === 2 ? null : { ticker, view: { bids: [{ price: 84, size: 100 }], asks: [{ price: 85, size: 40 }] }, ok: true, stale: false, gaps: 0, flips: 0, snap_t: 0, upd_t: closeMs - clock * 1000 - 500, level_count: 2, trusted: true }, null);
      await sql`insert into desk_research_book_depth (ticker, close_time, clock_secs, as_of, secs_left, clean, quality, features, levels, market)
        values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, ${clock}, ${new Date(closeMs - clock * 1000).toISOString()}::timestamptz, ${clock}, ${shot.quality.clean},
          ${JSON.stringify(shot.quality)}::jsonb, ${shot.features == null ? null : JSON.stringify(shot.features)}::jsonb, ${shot.levels == null ? null : JSON.stringify(shot.levels)}::jsonb, ${JSON.stringify(shot.market)}::jsonb)`;
    }
  }
  await m.enqueue(sql, "rollup", "depth");
  const job = await m.claim(sql, "depth", Date.now());
  assert.equal(await m.runJob(sql, job, "depth", { sampler: calm }), "complete", JSON.stringify(await jobsOf(sql)));
  const rep = (await sql`select payload from desk_research_reports where report_kind = 'book_depth' and report_key = 'latest'`)[0].payload;
  const c180 = rep.quality.by_clock.find((c) => c.clock === 180);
  assert.equal(rep.quality.settled_windows_in_period, 4);
  assert.equal(c180.snapshots, 3);
  assert.equal(c180.coverage_pct, 75);
  assert.equal(c180.clean, 2, "window 2 had no book");
  assert.deepEqual(c180.flags, [{ flag: "BOOK_MISSING", n: 1 }]);
  assert.equal(rep.h0.verdict, "INSUFFICIENT_SAMPLE");
  assert.equal(rep.decision_use, "NONE");
});

// ---------------------------------------------------------------------------
// Spot/perp signed trade-flow collector.
// ---------------------------------------------------------------------------

const FLOW = "src/lib/desk/trade-flow.server.ts";

function flowFixture(ctVal = "0.01") {
  const calls = [];
  const sql = async (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return [{ ok: 1 }]; };
  const at = (hms) => Date.parse(`2026-09-28T15:${hms}Z`);
  const cb = (id, hms, makerSide, size) => ({ trade_id: id, time: new Date(at(hms)).toISOString(), price: "60000", size, side: makerSide });
  const pages = { cbNewest: [], cbOlder: {}, okx: [{ instId: "BTC-USDT-SWAP", tradeId: "7", ts: String(at("10:00")), px: "60000", sz: "5", side: "buy" }] };
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    if (url.includes("/public/instruments")) return { code: "0", data: [{ instId: "BTC-USDT-SWAP", ctVal, ctValCcy: "BTC" }] };
    if (url.includes("okx.com/api/v5/market/trades")) return { code: "0", data: pages.okx };
    const after = /after=(\d+)/.exec(url);
    if (url.includes("coinbase")) return after ? pages.cbOlder[after[1]] ?? [] : pages.cbNewest;
    throw new Error(`unexpected ${url}`);
  };
  const close = Date.parse("2026-09-28T15:15:00Z");
  const frame = { snap: { ticker: "KXBTC15M-FLOW", close_time: close, as_of: at("11:59"), demo: false, yes_bid: 84, yes_ask: 85, no_bid: 15, no_ask: 16, yes_mid: 84.5 } };
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } })(FLOW);
  const minutes = () => calls.filter((c) => /^\s*insert into desk_research_flow_minutes/.test(c.text)).map((c) => ({ venue: c.values[0], minute: c.values[1], complete: c.values[3], flags: JSON.parse(c.values[4]), n_buy: c.values[5], n_sell: c.values[6], buy_base: c.values[7], sell_base: c.values[8] }));
  const marks = () => calls.filter((c) => /^\s*insert into desk_research_flow_marks/.test(c.text)).map((c) => ({ clock: c.values[2], age: c.values[4], yes_mid: c.values[9] }));
  return { calls, get, pages, urls, cb, at, mod, minutes, marks };
}

test("trade-flow collector: env-gated on a literal flag; aggressor sides as frozen; pages back to close a break instead of guessing; marks the price at fixed clocks; writes only its own tables", async () => {
  const off = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } })(FLOW);
  for (const v of [undefined, "", "TRUE", "1", "yes"]) assert.equal(off.ensureTradeFlow({ RESEARCH_TRADE_FLOW_ENABLED: v }), "disabled", String(v));
  const f = flowFixture();
  f.pages.cbNewest = [f.cb(101, "11:40", "buy", "1"), f.cb(100, "11:10", "sell", "1")];
  await f.mod.tradeFlowTick(f.at("12:00"), f.get);                      // first poll; T-3:00 of the 15:15 window
  assert.deepEqual(f.marks(), [{ clock: 180, age: 1000, yes_mid: 84.5 }]);
  await f.mod.tradeFlowTick(f.at("12:01"), f.get);
  assert.equal(f.marks().length, 1, "one mark per clock per window");
  f.pages.cbNewest = [f.cb(103, "12:50", "buy", "0.1"), f.cb(102, "12:10", "sell", "0.4"), ...f.pages.cbNewest];
  await f.mod.tradeFlowTick(f.at("13:15"), f.get);
  const m1 = f.minutes().filter((r) => r.venue === "COINBASE_SPOT");
  assert.deepEqual(m1, [{ venue: "COINBASE_SPOT", minute: "2026-09-28T15:12:00.000Z", complete: true, flags: [], n_buy: 1, n_sell: 1, buy_base: 0.4, sell_base: 0.1 }],
    "15:11 was only partly seen and is never written; a maker 'sell' is an aggressive BUY");
  // The newest page no longer reaches trade 103: the collector pages back instead of assuming nothing happened.
  f.pages.cbNewest = [f.cb(301, "14:05", "sell", "2"), f.cb(300, "13:30", "sell", "1")];
  f.pages.cbOlder["300"] = [f.cb(105, "13:20", "buy", "0.5"), f.cb(104, "13:05", "sell", "0.5"), f.cb(103, "12:50", "buy", "0.1")];
  await f.mod.tradeFlowTick(f.at("14:15"), f.get);
  assert.ok(f.urls.some((u) => u.endsWith("after=300")), "requested the page before the oldest fetched trade");
  const m2 = f.minutes().filter((r) => r.venue === "COINBASE_SPOT").at(-1);
  assert.deepEqual([m2.minute, m2.complete, m2.n_buy, m2.n_sell, m2.buy_base, m2.sell_base], ["2026-09-28T15:13:00.000Z", true, 2, 1, 1.5, 0.5], "the break was closed, so the minute is complete");
  // A break the bounded backfill cannot close is a GAP, never filled in.
  f.pages.cbNewest = [f.cb(900, "15:40", "sell", "1")];
  await f.mod.tradeFlowTick(f.at("16:15"), f.get);
  const gapped = f.minutes().filter((r) => r.venue === "COINBASE_SPOT" && r.minute >= "2026-09-28T15:14");
  assert.ok(gapped.length >= 1 && gapped.every((r) => !r.complete && r.flags.includes("GAP")), JSON.stringify(gapped));
  assert.equal(f.mod.tradeFlowHealth().venues.COINBASE_SPOT.gaps, 1);
  assert.ok(f.minutes().some((r) => r.venue === "OKX_PERP" && r.complete), "the perp venue is collected separately");
  assert.ok(f.calls.every((c) => /^\s*insert into desk_research_flow_(minutes|marks)/.test(c.text)), "writes only its own tables");
  assert.equal(f.mod.tradeFlowHealth().decision_use, "NONE");
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/trade-flow\.server"\)\s*\.then\(\(m\) => m\.ensureTradeFlow\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  // A changed perp contract halts that venue: nothing is written under a definition that no longer holds.
  const h = flowFixture("0.001");
  h.pages.cbNewest = [h.cb(1, "11:40", "buy", "1")];
  await h.mod.tradeFlowTick(h.at("12:00"), h.get);
  await h.mod.tradeFlowTick(h.at("14:00"), h.get);
  assert.match(h.mod.tradeFlowHealth().venues.OKX_PERP.halted, /CONTRACT_SPEC_MISMATCH/);
  assert.equal(h.minutes().filter((r) => r.venue === "OKX_PERP").length, 0);
  assert.ok(!h.urls.some((u) => u.includes("okx.com/api/v5/market")), "a halted venue is never polled");
});

test("trade_flow report: the rollup reports collection quality per venue and clock, and holds the H0 until its minimum clean sample", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const base = Date.parse("2026-09-28T15:15:00Z");
  for (let i = 0; i < 3; i += 1) {
    const closeMs = base + i * 900_000, ticker = `KXBTC15M-TF${i}`;
    await sql`insert into desk_ledger (ticker, close_time, source, winner, chair_lean) values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, 'kalshi-result', 'UP', 'WAIT')`;
    await sql`insert into desk_research_flow_marks (ticker, close_time, clock_secs, as_of, quote_age_ms, yes_bid, yes_ask, no_bid, no_ask, yes_mid)
      values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, 180, ${new Date(closeMs - 180_000).toISOString()}::timestamptz, 500, 84, 85, 15, 16, 84.5)`;
    for (let k = 1; k <= 5; k += 1) {
      const minute = new Date(closeMs - 180_000 - k * 60_000).toISOString();
      const complete = !(i === 2 && k === 3); // one GAP minute breaks window 2's span
      await sql`insert into desk_research_flow_minutes (venue, minute, def_version, complete, flags, n_buy, n_sell, buy_base, sell_base, buy_quote, sell_quote)
        values ('COINBASE_SPOT', ${minute}::timestamptz, 1, ${complete}, ${complete ? [] : ["GAP"]}, 3, 1, 3, 1, 180000, 60000)`;
    }
  }
  await m.enqueue(sql, "rollup", "flow");
  const job = await m.claim(sql, "flow", Date.now());
  assert.equal(await m.runJob(sql, job, "flow", { sampler: calm }), "complete", JSON.stringify(await jobsOf(sql)));
  const rep = (await sql`select payload from desk_research_reports where report_kind = 'trade_flow' and report_key = 'latest'`)[0].payload;
  const spot = rep.quality.venues.find((v) => v.venue === "COINBASE_SPOT");
  assert.equal(spot.minutes_recorded, 15);
  assert.deepEqual(spot.flags, [{ flag: "GAP", n: 1 }]);
  const c180 = rep.quality.by_clock.find((c) => c.clock === 180);
  assert.deepEqual([c180.settled_windows, c180.marks, c180.fresh_marks, c180.complete_spot_5m, c180.complete_perp_5m], [3, 3, 3, 2, 0]);
  assert.equal(rep.h0.verdict, "INSUFFICIENT_SAMPLE");
  assert.equal(rep.h0.clean_observations, 2);
  assert.equal(rep.decision_use, "NONE");
});

// ---------------------------------------------------------------------------
// Formalized WICK in shadow.
// ---------------------------------------------------------------------------

const WICK_SHADOW = "src/lib/desk/wick-effort.server.ts";

/** 30 flat bars, a run up, then a quiet up bar on half volume and a bar with no new high: NO_DEMAND. */
function noDemandCandles(endMs) {
  const bars = [];
  let p = 1000;
  for (let i = 0; i < 30; i += 1) bars.push({ o: p, c: p, h: p + 3, l: p - 3, v: 100 });
  for (let i = 0; i < 5; i += 1) { bars.push({ o: p, c: p + 3, h: p + 4.5, l: p - 1.5, v: 100 }); p += 3; }
  bars.push({ o: p, c: p + 0.5, h: p + 1.5, l: p - 1, v: 50 }, { o: p + 0.5, c: p, h: p + 1.4, l: p - 0.5, v: 80 });
  const t0 = endMs - bars.length * 60_000;
  return bars.map((b, i) => ({ t: t0 + i * 60_000, open: b.o, close: b.c, high: b.h, low: b.l, volume: b.v, closed: true, receipt_ts: 0, source: "binance" }));
}

test("wick shadow: env-gated on a literal flag; one row per fixed clock per window; copies WICK's same-instant output; writes only its own table and never touches the seat", async () => {
  const off = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } })(WICK_SHADOW);
  for (const v of [undefined, "", "TRUE", "1", "yes"]) assert.equal(off.ensureWickShadow({ RESEARCH_WICK_SHADOW_ENABLED: v }), "disabled", String(v));
  const calls = [];
  const sql = async (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return [{ ok: 1 }]; };
  const close = Date.parse("2026-09-28T15:15:00Z");
  const frame = {
    snap: { ticker: "KXBTC15M-WICK", close_time: close, as_of: close - 181_000, demo: false, yes_bid: 84, yes_ask: 85, no_bid: 15, no_ask: 16, yes_mid: 84.5, candles_1m: noDemandCandles(close - 185_000) },
    chair: { rows: [{ seat: "WICK", lean: "UP", status: "LIVE", conf: 61, folded: false }, { seat: "STREAK", lean: "UP", status: "LIVE", conf: 64, folded: false }] },
  };
  const before = JSON.stringify(frame);
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } })(WICK_SHADOW);
  const inserts = () => calls.filter((c) => /^\s*insert into desk_research_wick_shadow/.test(c.text)).map((c) => ({ clock: c.values[2], clean: c.values[5], quality: JSON.parse(c.values[6]), label: c.values[7], stance: c.values[8], wick: JSON.parse(c.values[10]), market: JSON.parse(c.values[11]) }));
  await mod.wickShadowTick(close - 240_000);                     // T-4:00: no clock
  assert.equal(inserts().length, 0);
  await mod.wickShadowTick(close - 180_000);                     // T-3:00
  await mod.wickShadowTick(close - 178_000);                     // same clock, already taken
  const rows = inserts();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].clock, rows[0].clean, rows[0].label, rows[0].stance], [180, true, "NO_DEMAND", "DOWN"], JSON.stringify(rows[0].quality));
  assert.deepEqual(rows[0].wick, { lean: "UP", status: "LIVE", conf: 61, folded: false }, "WICK's live read is copied beside the predicate's, for comparison only");
  assert.equal(rows[0].market.quote_age_ms, 1000);
  assert.equal(JSON.stringify(frame), before, "the published frame is never mutated");
  // An old engine quote is flagged, not trusted.
  frame.snap.as_of = close - 90_000;
  await mod.wickShadowTick(close - 60_000);                      // T-1:00 with a 30 s old quote
  const last = inserts().at(-1);
  assert.equal(last.clock, 60);
  assert.equal(last.clean, false);
  assert.ok(last.quality.flags.includes("ENGINE_QUOTE_OLD"));
  assert.ok(calls.every((c) => /^\s*insert into desk_research_wick_shadow/.test(c.text)), "writes only its own table");
  assert.equal(mod.wickShadowHealth().decision_use, "NONE");
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/wick-effort\.server"\)\s*\.then\(\(m\) => m\.ensureWickShadow\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  for (const f of ["src/lib/desk/wick-effort.ts", WICK_SHADOW]) {
    assert.doesNotMatch(codeOf(f), /from "\.\/(bots|learner|skills|patterns|chair)(\.ts)?"|rememberPatterns|pattern_book/, `${f} never reaches the WICK seat or its learner`);
  }
});

test("wick_shadow report: the rollup reports collection quality and the WICK comparison, and holds the H0 until its minimum clean sample", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const base = Date.parse("2026-09-28T15:15:00Z");
  for (let i = 0; i < 3; i += 1) {
    const closeMs = base + i * 900_000, ticker = `KXBTC15M-WS${i}`;
    await sql`insert into desk_ledger (ticker, close_time, source, winner, chair_lean) values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, 'kalshi-result', 'UP', 'WAIT')`;
    const clean = i !== 2;
    await sql`insert into desk_research_wick_shadow (ticker, close_time, clock_secs, as_of, def_version, clean, quality, label, stance, features, wick, market)
      values (${ticker}, ${new Date(closeMs).toISOString()}::timestamptz, 180, ${new Date(closeMs - 181_000).toISOString()}::timestamptz, 1, ${clean},
        ${JSON.stringify({ clean, flags: clean ? [] : ["BARS_STALE"] })}::jsonb, ${i === 0 ? "NO_SUPPLY" : "NONE"}, ${i === 0 ? "UP" : null}, null,
        ${JSON.stringify({ lean: "UP", status: "LIVE", conf: 60, folded: false })}::jsonb,
        ${JSON.stringify({ yes_bid: 84, yes_ask: 85, no_bid: 15, no_ask: 16, yes_mid: 84.5, quote_age_ms: 500 })}::jsonb)`;
  }
  await m.enqueue(sql, "rollup", "wick", {}, EPOCH);
  const job = await m.claim(sql, "wick", Date.now());
  assert.equal(await m.runJob(sql, job, "wick", { sampler: calm }), "complete", JSON.stringify(await jobsOf(sql)));
  const rep = (await sql`select payload from desk_research_reports where report_kind = 'wick_shadow' and report_key = 'latest'`)[0].payload;
  const c180 = rep.quality.by_clock.find((c) => c.clock === 180);
  assert.deepEqual([c180.rows, c180.coverage_pct, c180.clean, c180.fire_rate_pct], [3, 100, 2, 50]);
  assert.deepEqual(c180.flags, [{ flag: "BARS_STALE", n: 1 }]);
  assert.equal(rep.h0.verdict, "INSUFFICIENT_SAMPLE");
  assert.equal(rep.h0.clean_observations, 2);
  assert.equal(rep.h0.versus_wick.both_speak, 1);
  assert.equal(rep.h0.versus_wick.agree.right, 1);
  assert.equal(rep.decision_use, "NONE");
});

test("reports page: renders the stored reports from real SQL, read only", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const put = (kind, key, payload) => sql`insert into desk_research_reports (report_kind, report_key, report_version, payload) values (${kind}, ${key}, 2, ${JSON.stringify(payload)}::jsonb)`;
  await put("lifecycle", "latest", { rows: [{ experiment: "MID_RECOVERY_LOCKS_V2_INACTIVE", arm: "CONTROL", status: "INSUFFICIENT_SAMPLE", promotion_eligible: false, current_sample: { observed_windows: 3, fills: 0, clean_settled_fills: 0, suspect_fills: 0, invalid_fills: 0 }, current_result: {}, matched_null_fav: {} }] });
  await put("wick_shadow", "latest", { h0: { verdict: "INSUFFICIENT_SAMPLE", clean_observations: 2, fires: 1, h0: { id: "WICK_EFFORT_RESULT_H0_V1", min_clean_observations: 300 } } });
  await put("daily_digest", "2026-09-26", { day: "2026-09-26" });
  await put("daily_digest", "2026-09-27", { day: "2026-09-27" });
  await m.enqueue(sql, "window", "W|1", {}, EPOCH);
  const before = JSON.stringify(await sql`select * from desk_research_reports order by report_kind, report_key`) + JSON.stringify(await jobsOf(sql));
  const html = await m.researchReportsPage(sql, Date.parse("2026-09-28T17:30:00Z"));
  assert.equal(JSON.stringify(await sql`select * from desk_research_reports order by report_kind, report_key`) + JSON.stringify(await jobsOf(sql)), before, "rendering writes nothing");
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes("generated 2026-09-28T17:30:00.000Z"));
  assert.ok(html.includes("MID_RECOVERY_LOCKS_V2_INACTIVE"));
  assert.ok(html.includes("2 / 300 · 1 fires"));
  assert.ok(html.includes("Latest daily digest (2026-09-27)"), "the newest digest");
  assert.ok(html.includes("window") && html.includes("queued"), "job counts come from the queue");
  assert.equal(/<script/i.test(html), false);
});

test("current factory API/page never fall back to archived pooled reports before rebuild", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  const payload = JSON.stringify({ marker: "LEGACY_POOLED_ECONOMICS_MUST_NOT_RENDER", rows: [] });
  await sql`insert into desk_research_reports (report_kind, report_key, report_version, payload) values ('lifecycle', 'latest', 1, ${payload}::jsonb)`;
  await sql`insert into desk_research_reports (report_kind, report_key, report_version, payload) values ('daily_digest', '2026-09-28', 1, ${payload}::jsonb)`;
  const current = await m.researchFactoryReport("lifecycle", "latest", sql);
  assert.deepEqual(current.reports, []);
  assert.equal(current.report_state, "PENDING_CURRENT_VERSION_REBUILD");
  const html = await m.researchReportsPage(sql, Date.parse("2026-09-29T01:30:00Z"));
  assert.doesNotMatch(html, /LEGACY_POOLED_ECONOMICS_MUST_NOT_RENDER/);
  assert.match(html, /pending rebuild/);
  assert.equal((await sql`select count(*)::int as n from desk_research_reports where report_version = 1`)[0].n, 2, "archived reports are preserved");
});
