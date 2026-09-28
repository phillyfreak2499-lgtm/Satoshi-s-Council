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

test("one job at a time: nothing is claimed while a live lease exists; a lapsed lease is reclaimed and resumes from its checkpoint; a completed job never runs again", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "A|1");
  await m.enqueue(sql, "window", "B|2");
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
  await m.enqueue(sql, "window", "P|1");
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
  assert.equal(await m.runJob(sql, job, "p", opts()), "skipped_resource_guard");
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

test("a failing job is retried with back-off and stops at the attempt limit; the error is recorded", async (t) => {
  const m = await factory(t);
  const { sql } = await freshDb();
  await m.enqueue(sql, "window", "F|1");
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
    select 'T' || g, to_timestamp(${base / 1000} + g * 900), '${LOCKS}', a, 1, 'EXACT', true,
      case when g % 3 = 0 then 'UP' end, case when g % 3 = 0 then 85 end, case when g % 3 = 0 then 2 end, case when g % 2 = 0 then 'UP' else 'DOWN' end,
      case when g % 3 = 0 then 'SIMULATED_BOOKED' else 'SUPPORTERS' end, case when g % 3 = 0 then null else 'FAMILIES' end,
      jsonb_build_object('candidate_count', 1, 'recorded_side', 'UP', 'checks', '[]'::jsonb, 'candidate_seats', jsonb_build_array('STREAK'), 'context', jsonb_build_object('regime', 'r' || (g % 4)))
    from generate_series(0, ${N - 1}) g, unnest(array['${arms.join("','")}']) a`);
  await sql.query(`insert into desk_research_integrity (experiment, arm, ticker, close_time, kind, auditor_version, integrity_status)
    select experiment, arm, ticker, close_time, 'fill', 1, 'CLEAN' from desk_research_window_facts`);
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
  for (const v of [undefined, "", "TRUE", "1", "yes"]) assert.equal(m.ensureResearchFactory({ RESEARCH_FACTORY_ENABLED: v }), "disabled", String(v));
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/research-factory\.server"\)\s*\.then\(\(m\) => m\.ensureResearchFactory\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  const files = ["src/lib/desk/research-factory.ts", "src/lib/desk/research-factory-analysis.ts", "src/lib/desk/research-factory-reports.ts", "src/lib/desk/research-factory.server.ts"];
  for (const f of files) {
    const src = codeOf(f);
    const writes = [...src.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+(?:\w+\s+)?set|delete from\s+(\w+)/gi)].map((x) => x[1] || x[2] || x[3]);
    for (const w of writes) assert.match(w, /^desk_research_(jobs|window_facts|integrity|reports)$/, `${f} writes ${w}`);
    assert.doesNotMatch(src, /openai|anthropic|fetch\(|api\.kalshi|noteCall\(|applyDeskOp\(|promoteToLive|setKnob|reviewSeats|saveSettings/i, `${f} reaches a paid API or production state`);
  }
  assert.doesNotMatch(codeOf("src/lib/desk/research-factory.server.ts"), /delete from|drop table|truncate/i, "never deletes research history");
  for (const f of walk("src/").concat(walk("server/"))) {
    if (f === "server/routes/healthz.get.ts" || f === "server/routes/research/factory.get.ts" || f.startsWith("src/lib/desk/research-factory")) continue;
    assert.ok(!read(f).includes("research-factory"), `${f} imports the research factory`);
  }
  for (const prod of ["chair.ts", "bots.ts", "server-engine.ts", "selective-entry.ts", "book-floor.ts", "gate-vector.ts", "floor-policy.ts", "call-recovery-candidate.ts"]) {
    assert.doesNotMatch(read(`src/lib/desk/${prod}`), /research-factory|desk_research_/, `${prod} is untouched by the factory`);
  }
  assert.match(read("server/routes/research/factory.get.ts"), /adminKeyOk\(key\)\) return new Response\("not found", \{ status: 404 \}\)/);
});
