/**
 * RESEARCH FACTORY — scheduler, governor and job runner (server only).
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureResearchFactory`; it
 * returns "disabled" unless RESEARCH_FACTORY_ENABLED=true (the literal string).
 *
 * PRODUCTION WINS. Before every job, and between every unit of work inside a
 * job, the governor samples memory, load, event-loop delay (the direct cause of
 * request latency in this single Node process) and DB pool pressure; any one
 * over its threshold pauses research. A paused job is checkpointed and marked
 * `skipped_resource_guard`; it resumes on a later tick. Work runs in small
 * units separated by `setImmediate`, so no single unit holds the event loop,
 * and the timer is unref'd so it can never keep the process alive.
 *
 * ONE JOB AT A TIME. A process-local busy flag plus a DB lease claimed under an
 * advisory lock: a second process (a deploy overlap) cannot claim while a live
 * lease exists. A job whose process died is reclaimed when its lease lapses and
 * resumes from its checkpoint. Completed jobs are never re-run: the job's
 * primary key is (kind, key) and every derived write is insert-once.
 *
 * WRITES. Only desk_research_jobs, desk_research_window_facts,
 * desk_research_integrity and desk_research_reports. It reads receipts, the
 * research ledger view and decision snapshots; it never updates them.
 */
import { availableParallelism, loadavg } from "node:os";
import { readFileSync } from "node:fs";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { dbPoolStats, getSql, type Sql } from "@/lib/db";
import {
  JOB_KINDS, LEASE_MS, MAX_ATTEMPTS, RESEARCH_FACTORY, governorDecision, retryDelayMs, thresholdsFromEnv,
  type GovernorDecision, type JobKind, type ResourceSample,
} from "./research-factory.ts";
import {
  auditWindow, isDiagnosticOnly, windowFacts,
  type Annotation, type CardCounters, type IntegrityStatus, type LedgerRow, type OpeningRow, type ReceiptRow, type WindowFact, type WindowInput,
} from "./research-factory-analysis.ts";
import { gradeWindow, tapeIdentityQuality, type TapeEvent, type TapeRecord } from "./research-factory-tape.ts";
import { collectionQuality, depthH0, type SettledDepth } from "./book-depth.ts";
import { flowH0, flowQuality, indexMinutes, type FlowMark, type FlowVenue, type FlowWindow, type StoredMinute } from "./trade-flow.ts";
import { wickShadowH0, wickShadowQuality, type ShadowRow } from "./wick-effort.ts";
import { renderResearchPage, type StoredReport } from "./research-factory-page.ts";
import {
  abstentionReport, briefAccuracy, researchSummary, signalValueReport, stageUnlocks, survivalReport, transitionReport,
  type TapeWindow,
} from "./research-factory-insight.ts";
import {
  LIFECYCLE_REGISTRY, assembleGrade, cohortCoverage, isProductionAny, chokeAttribution, counterfactualGates, dailyDigest, evidenceSafety, gradeArmOn, lifecycle, lifecycleRow, matchedSets, pocketScan, utilization,
  type GradedFact, type JobTelemetry,
} from "./research-factory-reports.ts";

/** The deploy's commit, the same source the shadow-lab receipt writer stamps. */
const runningBuildSha = (): string => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

export const TICK_MS = 30_000;
/** The enqueue scan joins the ledger to receipts; it runs at most this often, not every tick. */
export const ENQUEUE_EVERY_MS = 5 * 60_000;
/** Longest a tick may keep claiming jobs before it yields the tick back. */
export const TICK_BUDGET_MS = 8_000;
/** Settled windows older than this are not enqueued by the scheduler (the backlog is bounded). */
export const LOOKBACK_DAYS = 45;

export function researchFactoryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[RESEARCH_FACTORY.env_flag] === "true";
}

// ---------------------------------------------------------------------------
// Resource sampling.
// ---------------------------------------------------------------------------

/** The container's memory limit (cgroup v2, then v1), or null. */
export function containerMemoryLimitMb(read: (p: string) => string = (p) => readFileSync(p, "utf8")): number | null {
  for (const p of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const v = Number(read(p).trim());
      if (Number.isFinite(v) && v > 0 && v < 2 ** 50) return Math.round(v / 1_048_576);
    } catch { /* not this cgroup version */ }
  }
  return null;
}

type State = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  owner: string;
  eld: IntervalHistogram | null;
  lastGuard: GovernorDecision | null;
  lastSample: ResourceSample | null;
  lastTickAt: number | null;
  lastEnqueueAt: number;
  lastError: string | null;
  completed: number;
  paused: number;
  lastReportedStatus: string | null;
};
const g = globalThis as typeof globalThis & { __researchFactory__?: State };
const state = (): State => g.__researchFactory__ ??= {
  timer: null, busy: false, owner: `pid-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, eld: null, lastGuard: null, lastSample: null, lastTickAt: null, lastEnqueueAt: 0, lastError: null, completed: 0, paused: 0, lastReportedStatus: null,
};

type RuntimeStatus = "disabled" | "started" | "running" | "paused" | "error" | "progress";

/**
 * Render-visible, credential-free scheduler status. Keep this deliberately
 * small: no environment values, job payloads, report contents or credentials.
 */
export function researchFactoryLogLine(status: RuntimeStatus, details: Record<string, unknown> = {}): string {
  return `[research-factory] ${JSON.stringify({ status, ...details })}`;
}

function reportRuntime(status: RuntimeStatus, details: Record<string, unknown> = {}, dedupe = true): void {
  const st = state();
  const line = researchFactoryLogLine(status, details);
  if (dedupe && st.lastReportedStatus === line) return;
  st.lastReportedStatus = line;
  if (status === "error") console.error(line);
  else if (status === "paused") console.warn(line);
  else console.info(line);
}

export type Sampler = () => Promise<ResourceSample>;

async function defaultSample(sql: Sql | null): Promise<ResourceSample> {
  const st = state();
  const eld = st.eld;
  const p99 = eld ? eld.percentile(99) / 1e6 : 0;
  eld?.reset();
  const pool = dbPoolStats();
  let ping: number | null = null;
  if (sql) { const t = performance.now(); await sql`select 1`; ping = performance.now() - t; }
  return {
    rss_mb: process.memoryUsage().rss / 1_048_576,
    load_per_cpu: loadavg()[0]! / Math.max(1, availableParallelism()),
    event_loop_p99_ms: p99,
    db_waiting: pool ? pool.waiting : null,
    db_in_use: pool ? pool.total - pool.idle : null,
    db_ping_ms: ping,
  };
}

// ---------------------------------------------------------------------------
// Instrumented SQL: every query the factory runs is counted and timed.
// ---------------------------------------------------------------------------

export type Meter = { queries: number; ms: number };
export function meteredSql(sql: Sql, meter: Meter): Sql {
  const timed = async <T>(run: () => Promise<T>) => { const t = performance.now(); try { return await run(); } finally { meter.queries += 1; meter.ms += performance.now() - t; } };
  const tag = (<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => timed(() => sql<T>(strings, ...values))) as Sql;
  tag.query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => timed(() => sql.query<T>(text, params));
  return tag;
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// Queue.
// ---------------------------------------------------------------------------

export type JobRow = { job_kind: JobKind; job_key: string; status: string; attempts: number; params: Record<string, unknown>; checkpoint: Record<string, unknown> };
const PRIORITY: Record<JobKind, number> = { window: 10, rollup: 50, digest: 60 };

export async function enqueue(sql: Sql, kind: JobKind, key: string, params: Record<string, unknown> = {}, notBeforeMs?: number): Promise<boolean> {
  const rows = await sql<{ job_key: string }>`
    insert into desk_research_jobs (job_kind, job_key, priority, params, not_before)
    values (${kind}, ${key}, ${PRIORITY[kind]}, ${JSON.stringify(params)}::jsonb, ${new Date(notBeforeMs ?? Date.now()).toISOString()}::timestamptz)
    on conflict (job_kind, job_key) do nothing returning job_key`;
  return rows.length > 0;
}

/** Enqueue every settled window with research receipts, plus this hour's rollup and yesterday's digest, all due from `nowMs`. Idempotent. */
export async function enqueueDue(sql: Sql, nowMs: number): Promise<number> {
  const revision = `f${RESEARCH_FACTORY.fact_version}a${RESEARCH_FACTORY.auditor_version}`;
  const rows = await sql<{ n: number }>`
    with due as (
      insert into desk_research_jobs (job_kind, job_key, priority, params, not_before)
      select 'window', l.ticker || '|' || ((extract(epoch from l.close_time) * 1000)::bigint)::text || '|' || ${revision}, ${PRIORITY.window},
        jsonb_build_object('ticker', l.ticker, 'close_ms', (extract(epoch from l.close_time) * 1000)::bigint), ${new Date(nowMs).toISOString()}::timestamptz
      from desk_ledger_research l
      where l.close_time > ${new Date(nowMs - LOOKBACK_DAYS * 86_400_000).toISOString()}::timestamptz
        and l.close_time < ${new Date(nowMs - 120_000).toISOString()}::timestamptz
        and (exists (select 1 from desk_shadow_receipts r where r.ticker = l.ticker and r.close_time = l.close_time)
          or exists (select 1 from desk_research_decision_tape t where t.ticker = l.ticker and t.close_time = l.close_time))
      on conflict (job_kind, job_key) do nothing
      returning 1)
    select count(*)::int as n from due`;
  let n = Number(rows[0]?.n ?? 0);
  if (await enqueue(sql, "rollup", `${new Date(nowMs).toISOString().slice(0, 13)}|r${RESEARCH_FACTORY.report_version}`, {}, nowMs)) n += 1;
  const day = chicagoDay(nowMs - 86_400_000);
  if (await enqueue(sql, "digest", `${day}|r${RESEARCH_FACTORY.report_version}`, { day }, nowMs)) n += 1;
  return n;
}

export function chicagoDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** The instant a Chicago calendar day starts (05:00Z in CDT, 06:00Z in CST), or NaN. */
export function chicagoMidnight(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return NaN;
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false });
  for (const h of [5, 6]) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h);
    if (chicagoDay(t) === day && Number(hour.format(new Date(t))) % 24 === 0) return t;
  }
  return NaN;
}

/**
 * Claim the next runnable job, or nothing. Global concurrency is one: the
 * advisory lock serializes claims, and no job is claimed while another holds a
 * live lease. A lapsed lease (its process died) is reclaimable; a completed job
 * never is; a failed job is retried with backoff until MAX_ATTEMPTS.
 */
export async function claim(sql: Sql, owner: string, nowMs: number): Promise<JobRow | null> {
  const now = new Date(nowMs).toISOString();
  const rows = await sql<JobRow>`
    update desk_research_jobs j
    set status = 'running', lease_owner = ${owner}, lease_until = ${new Date(nowMs + LEASE_MS).toISOString()}::timestamptz,
        attempts = j.attempts + 1, started_at = ${now}::timestamptz, updated_at = ${now}::timestamptz, error = null, guard_reason = null, build_sha = ${runningBuildSha()}
    where (j.job_kind, j.job_key) = (
      select c.job_kind, c.job_key from desk_research_jobs c
      where pg_try_advisory_xact_lock(hashtext('desk_research_factory_claim'))
        and not exists (select 1 from desk_research_jobs r where r.status = 'running' and r.lease_until >= ${now}::timestamptz)
        and ((c.status in ('queued', 'skipped_resource_guard') and c.not_before <= ${now}::timestamptz)
          or (c.status = 'running' and c.lease_until < ${now}::timestamptz)
          or (c.status = 'failed' and c.attempts < ${MAX_ATTEMPTS} and c.not_before <= ${now}::timestamptz))
      order by c.priority, c.not_before, c.job_key
      limit 1
      for update skip locked)
    returning j.job_kind, j.job_key, j.status, j.attempts, j.params, j.checkpoint`;
  return rows[0] ?? null;
}

type Telemetry = { wall_ms: number; cpu_ms: number; peak_rss_mb: number; db_queries: number; db_ms: number; rows_scanned: number; rows_written: number };

/** Close out a run. `atMs` is the runner's clock, the same one claims and leases use. */
async function finish(sql: Sql, job: JobRow, owner: string, status: "complete" | "failed" | "skipped_resource_guard" | "queued", t: Telemetry, extra: { error?: string; guard?: string; checkpoint?: Record<string, unknown>; not_before_ms?: number }, atMs: number): Promise<void> {
  await sql`
    update desk_research_jobs
    set status = ${status}, lease_owner = null, lease_until = null, finished_at = ${new Date(atMs).toISOString()}::timestamptz, updated_at = now(),
        wall_ms = ${t.wall_ms}, cpu_ms = ${t.cpu_ms}, peak_rss_mb = ${t.peak_rss_mb}, db_queries = ${t.db_queries}, db_ms = ${t.db_ms},
        rows_scanned = ${t.rows_scanned}, rows_written = ${t.rows_written}, error = ${extra.error ?? null}, guard_reason = ${extra.guard ?? null},
        checkpoint = ${JSON.stringify(extra.checkpoint ?? job.checkpoint ?? {})}::jsonb,
        not_before = ${new Date(extra.not_before_ms ?? atMs).toISOString()}::timestamptz,
        attempts = case when ${status} = 'skipped_resource_guard' or ${status} = 'queued' then greatest(0, attempts - 1) else attempts end
    where job_kind = ${job.job_kind} and job_key = ${job.job_key} and lease_owner = ${owner}`;
}

// ---------------------------------------------------------------------------
// Job handlers.
// ---------------------------------------------------------------------------

export class ResourceGuardPause extends Error { constructor(readonly reasons: string[]) { super(`resource guard: ${reasons.join(",")}`); } }
export class Defer extends Error { constructor(readonly ms: number, why: string) { super(why); } }

export type JobContext = {
  sql: Sql;
  job: JobRow;
  nowMs: number;
  /** Persist progress so a pause or restart resumes here. */
  checkpoint: (c: Record<string, unknown>) => Promise<void>;
  /** Call between units of work: yields the event loop and throws ResourceGuardPause under pressure. */
  unit: () => Promise<void>;
  scanned: (n: number) => void;
  written: (n: number) => void;
};
export type Handler = (ctx: JobContext) => Promise<void>;

const ms = (x: unknown) => (x == null ? null : Number(x));

async function readWindow(sql: Sql, ticker: string, closeMs: number): Promise<WindowInput> {
  const close = new Date(closeMs).toISOString();
  const receipts = await sql<Record<string, unknown>>`
    select experiment, arm, ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, kind,
      (extract(epoch from decided_at) * 1000)::bigint as decided_ms, (extract(epoch from recorded_at) * 1000)::bigint as recorded_ms,
      side, ask_cents, fee_cents, official_winner, net_cents, build_sha, payload
    from desk_shadow_receipts where ticker = ${ticker} and close_time = ${close}::timestamptz
    order by experiment, arm, decided_at`;
  const ledger = await sql<Record<string, unknown>>`
    select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, winner, chair_lean, entry_cents, entry_fee_cents, entry_lean, entry_build_sha, skill_score_audit
    from desk_ledger_research where ticker = ${ticker} and close_time = ${close}::timestamptz limit 1`;
  const opening = await sql<Record<string, unknown>>`
    select regime_key, atr, yes_ask, no_ask, spot, strike, (extract(epoch from decision_at) * 1000)::bigint as decision_ms
    from desk_decision_snapshots where ticker = ${ticker} and close_time = ${close}::timestamptz and snapshot_kind = 'OPENING'
      and decision_at < ${close}::timestamptz limit 1`;
  const l = ledger[0];
  const audit = (l?.skill_score_audit ?? null) as { skills?: Array<{ id: string; status_at_input: string; before: { n: number | null; hits: number | null } | null }> } | null;
  const counters: CardCounters[] = (audit?.skills ?? []).map((s) => ({ id: s.id, status_at_input: s.status_at_input, n: s.before?.n ?? null, hits: s.before?.hits ?? null }));
  const o = opening[0];
  return {
    ticker, close_ms: closeMs,
    receipts: receipts.map((r) => ({
      experiment: String(r.experiment), arm: String(r.arm), ticker: String(r.ticker), close_ms: Number(r.close_ms), kind: r.kind as ReceiptRow["kind"],
      decided_ms: Number(r.decided_ms), recorded_ms: Number(r.recorded_ms), side: (r.side as ReceiptRow["side"]) ?? null,
      ask_cents: ms(r.ask_cents), fee_cents: ms(r.fee_cents), official_winner: (r.official_winner as ReceiptRow["official_winner"]) ?? null,
      net_cents: ms(r.net_cents), build_sha: String(r.build_sha ?? ""), payload: (r.payload as Record<string, unknown>) ?? null,
    })),
    ledger: l && (l.winner === "UP" || l.winner === "DOWN") ? {
      ticker: String(l.ticker), close_ms: Number(l.close_ms), winner: l.winner, chair_lean: String(l.chair_lean), entry_cents: ms(l.entry_cents),
      entry_fee_cents: ms(l.entry_fee_cents), entry_lean: l.entry_lean === "UP" || l.entry_lean === "DOWN" ? l.entry_lean : null, entry_build_sha: (l.entry_build_sha as string | null) ?? null,
    } satisfies LedgerRow : null,
    opening: o ? { regime_key: String(o.regime_key ?? ""), atr: ms(o.atr), yes_ask: ms(o.yes_ask), no_ask: ms(o.no_ask), spot: ms(o.spot), strike: ms(o.strike), decision_ms: Number(o.decision_ms) } satisfies OpeningRow : null,
    counters,
  };
}

/** Depth snapshots read back for the report: bounded to the most recent windows. */
export const DEPTH_HORIZON_WINDOWS = 3_000;

/** Settled depth snapshots (newest windows first, bounded) and the settled windows in the collection period. */
export async function readDepth(sql: Sql, between: () => Promise<void> = yieldToLoop): Promise<{ rows: SettledDepth[]; settled_windows: number }> {
  const keys = await sql<{ close_time: string }>`
    select distinct close_time::text as close_time from desk_research_book_depth order by close_time desc limit ${DEPTH_HORIZON_WINDOWS}`;
  if (!keys.length) return { rows: [], settled_windows: 0 };
  const oldest = keys[keys.length - 1]!.close_time;
  const rows: SettledDepth[] = [];
  let after: [string, string, number] = ["1970-01-01T00:00:00Z", "", -1];
  for (;;) {
    const page = await sql<Record<string, unknown>>`
      select d.ticker, (extract(epoch from d.close_time) * 1000)::bigint as close_ms, d.close_time::text as close_key, d.clock_secs, (extract(epoch from d.as_of) * 1000)::bigint as as_of_ms,
        d.secs_left, d.quality, d.features, d.levels, d.market, l.winner
      from desk_research_book_depth d join desk_ledger_research l on l.ticker = d.ticker and l.close_time = d.close_time
      where d.close_time >= ${oldest}::timestamptz
        and (d.close_time, d.ticker, d.clock_secs) > (${after[0]}::timestamptz, ${after[1]}, ${after[2]})
      order by d.close_time, d.ticker, d.clock_secs
      limit ${READ_PAGE}`;
    for (const r of page) rows.push({
      ticker: String(r.ticker), close_ms: Number(r.close_ms), clock: Number(r.clock_secs), as_of: Number(r.as_of_ms), secs_left: Number(r.secs_left),
      quality: r.quality as SettledDepth["quality"], features: (r.features as SettledDepth["features"]) ?? null, levels: (r.levels as SettledDepth["levels"]) ?? null,
      market: r.market as SettledDepth["market"], winner: r.winner === "UP" || r.winner === "DOWN" ? r.winner : null,
    });
    if (page.length < READ_PAGE) break;
    const last = page[page.length - 1]!;
    after = [String(last.close_key), String(last.ticker), Number(last.clock_secs)];
    await between();
  }
  const settled = await sql<{ n: number }>`select count(*)::int as n from desk_ledger_research where close_time >= ${oldest}::timestamptz`;
  return { rows, settled_windows: Number(settled[0]?.n ?? 0) };
}

/** Trade-flow windows read back for the report: bounded to the most recent marked windows. */
export const FLOW_HORIZON_WINDOWS = 2_000;

/** Settled windows with their price marks, and every stored flow minute that can feed them (keyset paged). */
export async function readFlow(sql: Sql, between: () => Promise<void> = yieldToLoop): Promise<{ windows: FlowWindow[]; minutes: StoredMinute[] }> {
  const keys = await sql<{ close_time: string }>`
    select distinct close_time::text as close_time from desk_research_flow_marks order by close_time desc limit ${FLOW_HORIZON_WINDOWS}`;
  if (!keys.length) return { windows: [], minutes: [] };
  const oldest = keys[keys.length - 1]!.close_time;
  const settled = await sql<{ ticker: string; close_ms: number; winner: string | null }>`
    select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, winner from desk_ledger_research
    where close_time >= ${oldest}::timestamptz and winner in ('UP', 'DOWN')`;
  const windows = new Map<string, FlowWindow>();
  for (const r of settled) windows.set(`${r.ticker}|${Number(r.close_ms)}`, { ticker: r.ticker, close_ms: Number(r.close_ms), winner: r.winner === "UP" ? "UP" : "DOWN", marks: {} });
  const n = (x: unknown) => (x == null ? null : Number(x));
  let after: [string, string, number] = ["1970-01-01T00:00:00Z", "", -1];
  for (;;) {
    const page = await sql<Record<string, unknown>>`
      select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, close_time::text as close_key, clock_secs, quote_age_ms, yes_bid, yes_ask, no_bid, no_ask, yes_mid
      from desk_research_flow_marks
      where close_time >= ${oldest}::timestamptz and (close_time, ticker, clock_secs) > (${after[0]}::timestamptz, ${after[1]}, ${after[2]})
      order by close_time, ticker, clock_secs limit ${READ_PAGE}`;
    for (const r of page) {
      const w = windows.get(`${String(r.ticker)}|${Number(r.close_ms)}`);
      if (w) w.marks[Number(r.clock_secs)] = { yes_bid: n(r.yes_bid), yes_ask: n(r.yes_ask), no_bid: n(r.no_bid), no_ask: n(r.no_ask), yes_mid: n(r.yes_mid), quote_age_ms: n(r.quote_age_ms) } satisfies FlowMark;
    }
    if (page.length < READ_PAGE) break;
    const last = page[page.length - 1]!;
    after = [String(last.close_key), String(last.ticker), Number(last.clock_secs)];
    await between();
  }
  const minutes: StoredMinute[] = [];
  let from: [string, string] = ["", "1970-01-01T00:00:00Z"];
  for (;;) {
    const page = await sql<Record<string, unknown>>`
      select venue, minute::text as minute_key, (extract(epoch from minute) * 1000)::bigint as minute_ms, complete, flags, buy_base, sell_base, n_buy + n_sell as n
      from desk_research_flow_minutes
      where minute >= ${oldest}::timestamptz - interval '15 minutes' and (venue, minute) > (${from[0]}, ${from[1]}::timestamptz)
      order by venue, minute limit ${READ_PAGE}`;
    for (const r of page) minutes.push({ venue: String(r.venue) as FlowVenue, minute_ms: Number(r.minute_ms), complete: r.complete === true, flags: (r.flags as string[]) ?? [], buy_base: Number(r.buy_base), sell_base: Number(r.sell_base), n: Number(r.n) });
    if (page.length < READ_PAGE) break;
    const last = page[page.length - 1]!;
    from = [String(last.venue), String(last.minute_key)];
    await between();
  }
  return { windows: [...windows.values()].sort((a, b) => a.close_ms - b.close_ms), minutes };
}

/** Settled formalized-WICK shadow rows (newest windows first, bounded) and the settled windows in the period. */
export async function readWickShadow(sql: Sql, between: () => Promise<void> = yieldToLoop): Promise<{ rows: ShadowRow[]; settled_windows: number }> {
  const keys = await sql<{ close_time: string }>`
    select distinct close_time::text as close_time from desk_research_wick_shadow order by close_time desc limit ${DEPTH_HORIZON_WINDOWS}`;
  if (!keys.length) return { rows: [], settled_windows: 0 };
  const oldest = keys[keys.length - 1]!.close_time;
  const rows: ShadowRow[] = [];
  let after: [string, string, number] = ["1970-01-01T00:00:00Z", "", -1];
  for (;;) {
    const page = await sql<Record<string, unknown>>`
      select w.ticker, (extract(epoch from w.close_time) * 1000)::bigint as close_ms, w.close_time::text as close_key, w.clock_secs, w.clean, w.quality, w.label, w.stance, w.wick, w.market, l.winner
      from desk_research_wick_shadow w join desk_ledger_research l on l.ticker = w.ticker and l.close_time = w.close_time
      where w.close_time >= ${oldest}::timestamptz
        and (w.close_time, w.ticker, w.clock_secs) > (${after[0]}::timestamptz, ${after[1]}, ${after[2]})
      order by w.close_time, w.ticker, w.clock_secs
      limit ${READ_PAGE}`;
    for (const r of page) rows.push({
      ticker: String(r.ticker), close_ms: Number(r.close_ms), clock: Number(r.clock_secs), clean: r.clean === true,
      flags: ((r.quality as { flags?: string[] } | null)?.flags) ?? [], label: String(r.label) as ShadowRow["label"],
      stance: r.stance === "UP" || r.stance === "DOWN" ? r.stance : null, wick: (r.wick as ShadowRow["wick"]) ?? null,
      market: r.market as ShadowRow["market"], winner: r.winner === "UP" || r.winner === "DOWN" ? r.winner : null,
    });
    if (page.length < READ_PAGE) break;
    const last = page[page.length - 1]!;
    after = [String(last.close_key), String(last.ticker), Number(last.clock_secs)];
    await between();
  }
  const settled = await sql<{ n: number }>`select count(*)::int as n from desk_ledger_research where close_time >= ${oldest}::timestamptz`;
  return { rows, settled_windows: Number(settled[0]?.n ?? 0) };
}

/** Tape rows for one window, oldest first. */
async function readTape(sql: Sql, ticker: string, closeMs: number): Promise<TapeEvent[]> {
  const rows = await sql<Record<string, unknown>>`
    select checkpoint_secs, partial_window, build_sha, record from desk_research_decision_tape
    where ticker = ${ticker} and close_time = ${new Date(closeMs).toISOString()}::timestamptz order by as_of asc`;
  return rows.map(tapeEventOf);
}
const tapeEventOf = (r: Record<string, unknown>): TapeEvent => ({
  ...(r.record as TapeRecord), checkpoint: r.checkpoint_secs == null ? null : Number(r.checkpoint_secs), partial_window: r.partial_window === true, build_sha: String(r.build_sha ?? ""),
});

/** The tape reports read at most this many recent settled windows: bounded memory however long the tape runs. */
export const TAPE_HORIZON_WINDOWS = 720;

/** Recent settled windows with tape, graded, newest first; read in pages with `between()` after each. */
export async function readTapeWindows(sql: Sql, between: () => Promise<void> = yieldToLoop): Promise<TapeWindow[]> {
  const keys = await sql<{ ticker: string; close_ms: number; winner: string | null }>`
    select t.ticker, (extract(epoch from t.close_time) * 1000)::bigint as close_ms, max(l.winner) as winner
    from desk_research_decision_tape t join desk_ledger_research l on l.ticker = t.ticker and l.close_time = t.close_time
    group by t.ticker, t.close_time order by t.close_time desc limit ${TAPE_HORIZON_WINDOWS}`;
  const out: TapeWindow[] = [];
  for (let i = 0; i < keys.length; i += 40) {
    const page = keys.slice(i, i + 40);
    const rows = await sql<Record<string, unknown>>`
      select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, checkpoint_secs, partial_window, build_sha, record
      from desk_research_decision_tape
      where (ticker, close_time) in (select k.ticker, k.close_time from jsonb_to_recordset(${JSON.stringify(page.map((k) => ({ ticker: k.ticker, close_time: new Date(Number(k.close_ms)).toISOString() })))}::jsonb) as k(ticker text, close_time timestamptz))
      order by as_of asc`;
    for (const k of page) {
      const events = rows.filter((r) => r.ticker === k.ticker && Number(r.close_ms) === Number(k.close_ms)).map(tapeEventOf);
      const winner = k.winner === "UP" || k.winner === "DOWN" ? k.winner : null;
      out.push({ ticker: k.ticker, close_ms: Number(k.close_ms), events, timeline: gradeWindow(events, winner) });
    }
    await between();
  }
  return out;
}

async function writeFacts(sql: Sql, facts: readonly WindowFact[]): Promise<number> {
  let n = 0;
  for (const f of facts) {
    const rows = await sql<{ ok: number }>`
      insert into desk_research_window_facts (ticker, close_time, experiment, arm, fact_version, replay_quality, quality_reasons, experiment_version, source_build_sha,
        decided_at, observed, terminal_kind, side, ask_cents, fee_cents, official_winner, net_cents, production_lean, production_booked, funnel_stage, first_blocker, blockers, facts, build_sha)
      values (${f.ticker}, ${new Date(f.close_ms).toISOString()}::timestamptz, ${f.experiment}, ${f.arm}, ${f.fact_version}, ${f.replay_quality},
        array(select jsonb_array_elements_text(${JSON.stringify(f.quality_reasons)}::jsonb)), ${f.experiment_version}, ${f.source_build_sha},
        ${f.decided_ms == null ? null : new Date(f.decided_ms).toISOString()}::timestamptz, ${f.observed}, ${f.terminal_kind}, ${f.side}, ${f.ask_cents}, ${f.fee_cents},
        ${f.official_winner}, ${f.net_cents}, ${f.production_lean}, ${f.production_booked}, ${f.funnel_stage}, ${f.first_blocker},
        array(select jsonb_array_elements_text(${JSON.stringify(f.blockers)}::jsonb)), ${JSON.stringify(f.facts)}::jsonb, ${runningBuildSha()})
      on conflict (ticker, close_time, experiment, arm, fact_version) do nothing returning 1 as ok`;
    n += rows.length;
  }
  return n;
}

async function writeAnnotations(sql: Sql, notes: readonly Annotation[]): Promise<number> {
  let n = 0;
  for (const a of notes) {
    const rows = await sql<{ ok: number }>`
      insert into desk_research_integrity (experiment, arm, ticker, close_time, kind, auditor_version, integrity_status, reason_codes, details, build_sha)
      values (${a.experiment}, ${a.arm}, ${a.ticker}, ${new Date(a.close_ms).toISOString()}::timestamptz, ${a.kind}, ${a.auditor_version}, ${a.integrity_status},
        array(select jsonb_array_elements_text(${JSON.stringify(a.reason_codes)}::jsonb)), ${JSON.stringify(a.details)}::jsonb, ${runningBuildSha()})
      on conflict (experiment, arm, ticker, close_time, kind, auditor_version) do nothing returning 1 as ok`;
    n += rows.length;
  }
  return n;
}

/** Phase 2 + 3 for one settled window. Re-running it writes nothing new. */
export const windowHandler: Handler = async (ctx) => {
  const ticker = String(ctx.job.params.ticker ?? ctx.job.job_key.split("|")[0]);
  const closeMs = Number(ctx.job.params.close_ms ?? ctx.job.job_key.split("|")[1]);
  if (!ticker || !Number.isFinite(closeMs)) throw new Error(`bad window key ${ctx.job.job_key}`);
  const input = await readWindow(ctx.sql, ticker, closeMs);
  ctx.scanned(input.receipts.length + (input.ledger ? 1 : 0) + (input.opening ? 1 : 0));
  if (!input.ledger && ctx.nowMs - closeMs < 6 * 3_600_000) throw new Defer(10 * 60_000, "official settlement not yet recorded");
  await ctx.unit();
  if (ctx.job.checkpoint.facts !== true) {
    ctx.written(await writeFacts(ctx.sql, windowFacts(input)));
    await ctx.checkpoint({ ...ctx.job.checkpoint, facts: true });
  }
  await ctx.unit();
  if (ctx.job.checkpoint.integrity !== true) {
    ctx.written(await writeAnnotations(ctx.sql, auditWindow(input)));
    await ctx.checkpoint({ ...ctx.job.checkpoint, integrity: true });
  }
  await ctx.unit();
  if (ctx.job.checkpoint.tape !== true) {
    const events = await readTape(ctx.sql, ticker, closeMs);
    ctx.scanned(events.length);
    if (events.length && input.ledger) {
      const timeline = gradeWindow(events, input.ledger.winner);
      const identityReasons = timeline.identity_exclusion_reasons;
      const replayQuality = timeline.identity_excluded_events > 0 ? "UNAVAILABLE" : timeline.partial_window ? "PARTIAL" : "EXACT";
      const reportableEvents = events.filter((e) => tapeIdentityQuality(e.ticker, e.close_ms).reportable);
      const fact: WindowFact = {
        ticker, close_ms: closeMs, experiment: "PRODUCTION_TAPE", arm: "DECISION_TAPE", fact_version: RESEARCH_FACTORY.fact_version,
        replay_quality: replayQuality, quality_reasons: [...identityReasons, ...(timeline.partial_window ? ["PARTIAL_WINDOW"] : [])],
        experiment_version: null, source_build_sha: [...new Set(events.map((e) => e.build_sha))].sort().join(",") || null, decided_ms: reportableEvents[0]?.as_of ?? null,
        observed: reportableEvents.length > 0, terminal_kind: timeline.terminal_label, side: null, ask_cents: null, fee_cents: null, official_winner: input.ledger.winner, net_cents: null,
        production_lean: input.ledger.chair_lean, production_booked: input.ledger.entry_cents != null,
        funnel_stage: null, first_blocker: null, blockers: [...new Set(reportableEvents.flatMap((e) => e.blockers))],
        facts: { source: "desk_research_decision_tape", recorded_not_rederived: true, timeline },
      };
      ctx.written(await writeFacts(ctx.sql, [fact]));
    }
    await ctx.checkpoint({ ...ctx.job.checkpoint, tape: true });
  }
};

/** Rows per page when reading derived research back: bounds each query and each synchronous parse. */
export const READ_PAGE = 500;

/**
 * Everything the cross-window reports need, as graded facts. Read in keyset
 * pages with `between()` called after each page, so a large history is never
 * one long query or one long synchronous parse.
 */
export async function readGraded(sql: Sql, between: () => Promise<void> = yieldToLoop): Promise<{ graded: GradedFact[]; integrity: Array<{ experiment: string; arm: string; close_ms: number; status: IntegrityStatus; codes: string[] }> }> {
  const rows: Record<string, unknown>[] = [];
  let after: [string, string, string, string] = ["1970-01-01T00:00:00Z", "", "", ""];
  for (;;) {
    const page = await sql<Record<string, unknown>>`
      select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, close_time::text as close_key, experiment, arm, fact_version, replay_quality, quality_reasons, experiment_version, source_build_sha,
        (extract(epoch from decided_at) * 1000)::bigint as decided_ms, observed, terminal_kind, side, ask_cents, fee_cents, official_winner, net_cents,
        production_lean, production_booked, funnel_stage, first_blocker, blockers, facts
      from desk_research_window_facts
      where fact_version = ${RESEARCH_FACTORY.fact_version}
        and (close_time, ticker, experiment, arm) > (${after[0]}::timestamptz, ${after[1]}, ${after[2]}, ${after[3]})
      order by close_time, ticker, experiment, arm
      limit ${READ_PAGE}`;
    rows.push(...page);
    if (page.length < READ_PAGE) break;
    const last = page[page.length - 1]!;
    after = [String(last.close_key), String(last.ticker), String(last.experiment), String(last.arm)];
    await between();
  }
  const notes: Record<string, unknown>[] = [];
  let afterNote: [string, string, string, string, string] = ["1970-01-01T00:00:00Z", "", "", "", ""];
  for (;;) {
    const page = await sql<Record<string, unknown>>`
      select experiment, arm, (extract(epoch from close_time) * 1000)::bigint as close_ms, close_time::text as close_key, ticker, kind, integrity_status, reason_codes
      from desk_research_integrity
      where auditor_version = ${RESEARCH_FACTORY.auditor_version}
        and (close_time, ticker, experiment, arm, kind) > (${afterNote[0]}::timestamptz, ${afterNote[1]}, ${afterNote[2]}, ${afterNote[3]}, ${afterNote[4]})
      order by close_time, ticker, experiment, arm, kind
      limit ${READ_PAGE}`;
    notes.push(...page);
    if (page.length < READ_PAGE) break;
    const last = page[page.length - 1]!;
    afterNote = [String(last.close_key), String(last.ticker), String(last.experiment), String(last.arm), String(last.kind)];
    await between();
  }
  const byKey = new Map<string, IntegrityStatus[]>();
  const integrity = notes.map((n) => {
    const k = `${n.ticker}|${n.close_ms}|${n.experiment}|${n.arm}`;
    byKey.set(k, [...(byKey.get(k) ?? []), n.integrity_status as IntegrityStatus]);
    return { experiment: String(n.experiment), arm: String(n.arm), close_ms: Number(n.close_ms), status: n.integrity_status as IntegrityStatus, codes: (n.reason_codes as string[]) ?? [] };
  });
  const arrayOf = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : typeof x === "string" ? x.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : []);
  const graded: GradedFact[] = rows.map((r) => ({
    ticker: String(r.ticker), close_ms: Number(r.close_ms), experiment: String(r.experiment), arm: String(r.arm), fact_version: Number(r.fact_version),
    replay_quality: r.replay_quality as WindowFact["replay_quality"], quality_reasons: arrayOf(r.quality_reasons), experiment_version: ms(r.experiment_version),
    source_build_sha: (r.source_build_sha as string | null) ?? null, decided_ms: ms(r.decided_ms), observed: r.observed === true, terminal_kind: (r.terminal_kind as string | null) ?? null,
    side: (r.side as WindowFact["side"]) ?? null, ask_cents: ms(r.ask_cents), fee_cents: ms(r.fee_cents), official_winner: (r.official_winner as WindowFact["official_winner"]) ?? null,
    net_cents: ms(r.net_cents), production_lean: (r.production_lean as string | null) ?? null, production_booked: (r.production_booked as boolean | null) ?? null,
    funnel_stage: (r.funnel_stage as WindowFact["funnel_stage"]) ?? null, first_blocker: (r.first_blocker as WindowFact["first_blocker"]) ?? null,
    blockers: arrayOf(r.blockers), facts: (r.facts as Record<string, unknown>) ?? {},
    integrity: byKey.get(`${r.ticker}|${r.close_ms}|${r.experiment}|${r.arm}`) ?? [],
  }));
  return { graded, integrity };
}

async function upsertReport(sql: Sql, kind: string, key: string, payload: unknown): Promise<number> {
  const rows = await sql<{ ok: number }>`
    insert into desk_research_reports (report_kind, report_key, report_version, payload, build_sha)
    values (${kind}, ${key}, ${RESEARCH_FACTORY.report_version}, ${JSON.stringify(payload)}::jsonb, ${runningBuildSha()})
    on conflict (report_kind, report_key, report_version) do update set payload = excluded.payload, build_sha = excluded.build_sha, created_at = now()
    returning 1 as ok`;
  return rows.length;
}

async function readJobTelemetry(sql: Sql, sinceMs: number): Promise<JobTelemetry[]> {
  const rows = await sql<Record<string, unknown>>`
    select job_kind, status, (extract(epoch from finished_at) * 1000)::bigint as finished_ms, wall_ms, cpu_ms, peak_rss_mb, db_queries, db_ms, rows_scanned, rows_written, guard_reason
    from desk_research_jobs where finished_at >= ${new Date(sinceMs).toISOString()}::timestamptz`;
  return rows.map((r) => ({ job_kind: String(r.job_kind), status: String(r.status), finished_ms: ms(r.finished_ms), wall_ms: ms(r.wall_ms), cpu_ms: ms(r.cpu_ms), peak_rss_mb: ms(r.peak_rss_mb), db_queries: ms(r.db_queries), db_ms: ms(r.db_ms), rows_scanned: ms(r.rows_scanned), rows_written: ms(r.rows_written), guard_reason: (r.guard_reason as string | null) ?? null }));
}

const RECOVERED_ARMS: ReadonlyArray<[string, string]> = LIFECYCLE_REGISTRY.filter((s) => s.arm !== "NULL_FAV_80").map((s) => [s.experiment, s.arm]);

/** Phases 4-8 and 10, recomputed from stored facts; each report is one unit and one checkpoint. */
export const rollupHandler: Handler = async (ctx) => {
  const { graded, integrity } = await readGraded(ctx.sql, ctx.unit);
  ctx.scanned(graded.length + integrity.length);
  const done = new Set((ctx.job.checkpoint.done as string[] | undefined) ?? []);
  const step = async (name: string, build: () => Promise<unknown>) => {
    if (done.has(name)) return;
    await ctx.unit();
    ctx.written(await upsertReport(ctx.sql, name, "latest", await build()));
    done.add(name);
    await ctx.checkpoint({ ...ctx.job.checkpoint, done: [...done] });
  };
  /** One unit per item: the governor is consulted and the event loop yielded between arms. */
  const each = async <T, R>(items: readonly T[], f: (x: T) => R): Promise<R[]> => {
    const out: R[] = [];
    for (const x of items) { await ctx.unit(); out.push(f(x)); }
    return out;
  };
  const experiments = [...new Set(graded.filter((f) => !isProductionAny(f)).map((f) => f.experiment))].sort();
  const tested = RECOVERED_ARMS.filter(([e, a]) => !isDiagnosticOnly(e, a));
  await step("v2_cohort_coverage", async () => cohortCoverage(graded));
  // One arm per governed unit: the matched sets are built once per experiment, then each arm is graded on them.
  await step("matched_grade", async () => {
    const out = [];
    for (const e of experiments) {
      await ctx.unit();
      const sets = matchedSets(graded, e);
      out.push(assembleGrade(sets, await each(sets.keys, (k) => gradeArmOn(sets, k))));
    }
    return { experiments: out };
  });
  await step("evidence_safety", async () => evidenceSafety(graded, integrity.map((i) => ({ experiment: i.experiment, arm: i.arm, status: i.status, codes: i.codes }))));
  await step("choke_attribution", async () => ({ arms: await each(RECOVERED_ARMS, ([e, a]) => chokeAttribution(graded, e, a)) }));
  await step("pockets", async () => ({ arms: await each(tested, ([e, a]) => pocketScan(graded, e, a)) }));
  await step("counterfactual_gates", async () => ({ arms: await each(tested, ([e, a]) => ({ experiment: e, arm: a, changes: counterfactualGates(graded, e, a) })), rule: "One gate change at a time. COMBINED changes are never tested here." }));
  await step("lifecycle", async () => ({ rows: await each(LIFECYCLE_REGISTRY, (spec) => lifecycleRow(graded, spec)), authority: { production_authority: "NONE", auto_promotion: false } }));
  // Production decision tape and the insight reports built on it.
  const tape = await readTapeWindows(ctx.sql, ctx.unit);
  ctx.scanned(tape.reduce((a, w) => a + w.events.length, 0));
  await step("abstention", async () => abstentionReport(tape));
  await step("transitions", async () => transitionReport(tape));
  await step("brief_accuracy", async () => briefAccuracy(tape));
  await step("survival", async () => survivalReport(tape));
  await step("stage_unlocks", async () => ({ experiments: await each(experiments, (e) => stageUnlocks(graded, e)) }));
  await step("signal_value", async () => signalValueReport(tape));
  await step("research_summary", async () => {
    const pockets = await each(tested, ([e, a]) => pocketScan(graded, e, a));
    const promising = pockets.flatMap((p) => p.pockets.filter((x) => x.label === "PROMISING").map((x) => ({ experiment: p.experiment, arm: p.arm, dimension: x.dimension, value: x.value })));
    const flags = lifecycle(graded).filter((l) => l.flag_for_human_review).map((l) => ({ experiment: l.experiment, arm: l.arm }));
    await ctx.unit();
    return researchSummary({ transitions: transitionReport(tape), abstention: abstentionReport(tape), survival: survivalReport(tape), signals: signalValueReport(tape), pockets_promising: promising, lifecycle_flags: flags });
  });
  // Order-book depth: collection quality first; the pre-registered H0 runs only at its minimum clean sample.
  await step("book_depth", async () => {
    const depth = await readDepth(ctx.sql, ctx.unit);
    ctx.scanned(depth.rows.length);
    return { quality: collectionQuality(depth.rows, depth.settled_windows), h0: depthH0(depth.rows), decision_use: "NONE" };
  });
  // Spot and perp signed flow: collection quality first; the pre-registered H0 runs only at its minimum clean sample.
  await step("trade_flow", async () => {
    const flow = await readFlow(ctx.sql, ctx.unit);
    ctx.scanned(flow.minutes.length);
    const idx = indexMinutes(flow.minutes);
    await ctx.unit();
    const quality = flowQuality(flow.minutes, flow.windows, idx);
    await ctx.unit();
    return { quality, h0: flowH0(flow.windows, idx), decision_use: "NONE" };
  });
  // Formalized WICK in shadow: collection quality first; the pre-registered H0 runs only at its minimum clean sample.
  await step("wick_shadow", async () => {
    const shadow = await readWickShadow(ctx.sql, ctx.unit);
    ctx.scanned(shadow.rows.length);
    return { quality: wickShadowQuality(shadow.rows, shadow.settled_windows), h0: wickShadowH0(shadow.rows), decision_use: "NONE" };
  });
  const since = ctx.nowMs - 86_400_000;
  const jobs = await readJobTelemetry(ctx.sql, since);
  await step("utilization", async () => utilization(jobs, since, ctx.nowMs, availableParallelism()));
};

/** Phase 9: the day's digest (America/Chicago day). */
export const digestHandler: Handler = async (ctx) => {
  const day = String(ctx.job.params.day ?? ctx.job.job_key);
  const start = chicagoMidnight(day);
  if (!Number.isFinite(start)) throw new Error(`bad digest key ${day}`);
  const next = new Date(start + 26 * 3_600_000);
  const end = chicagoMidnight(chicagoDay(next.getTime()));
  if (ctx.nowMs < end) throw new Defer(end - ctx.nowMs + 60_000, "day not over");
  const { graded, integrity } = await readGraded(ctx.sql, ctx.unit);
  ctx.scanned(graded.length + integrity.length);
  await ctx.unit();
  const jobs = await readJobTelemetry(ctx.sql, start);
  const report = dailyDigest(graded, start, end, integrity.filter((i) => i.close_ms >= start && i.close_ms < end), {
    lifecycle: lifecycle(graded),
    choke: RECOVERED_ARMS.map(([e, a]) => chokeAttribution(graded, e, a)),
    utilization: utilization(jobs, start, end, availableParallelism()),
  });
  ctx.written(await upsertReport(ctx.sql, "daily_digest", day, report));
};

export const HANDLERS: Record<JobKind, Handler> = { window: windowHandler, rollup: rollupHandler, digest: digestHandler };

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

export type RunOptions = {
  sql?: Sql;
  sampler?: Sampler;
  handlers?: Partial<Record<JobKind, Handler>>;
  now?: () => number;
  env?: Record<string, string | undefined>;
  onResourcePause?: (reasons: string[]) => void;
  onJobError?: (message: string) => void;
};

/**
 * Run one claimed job to an outcome. Returns the status it ended in. A
 * resource-guard pause keeps the checkpoint and leaves the job resumable.
 */
export async function runJob(rawSql: Sql, job: JobRow, owner: string, opts: RunOptions = {}): Promise<string> {
  const now = opts.now ?? Date.now;
  const meter: Meter = { queries: 0, ms: 0 };
  const sql = meteredSql(rawSql, meter);
  const thresholds = thresholdsFromEnv(opts.env ?? process.env, containerMemoryLimitMb());
  const sampler = opts.sampler ?? (() => defaultSample(rawSql));
  const t0 = performance.now();
  // Main-thread CPU where the runtime exposes it (it excludes GC helper threads); process CPU otherwise.
  const cpuNow = (prev?: NodeJS.CpuUsage) => (typeof process.threadCpuUsage === "function" ? process.threadCpuUsage(prev) : process.cpuUsage(prev));
  const cpu0 = cpuNow();
  let peak = process.memoryUsage().rss / 1_048_576;
  let scanned = 0, written = 0;
  let checkpoint = { ...(job.checkpoint ?? {}) };
  const telemetry = (): Telemetry => {
    const c = cpuNow(cpu0);
    return { wall_ms: performance.now() - t0, cpu_ms: (c.user + c.system) / 1000, peak_rss_mb: peak, db_queries: meter.queries, db_ms: meter.ms, rows_scanned: scanned, rows_written: written };
  };
  const ctx: JobContext = {
    sql, job: { ...job, checkpoint }, nowMs: now(),
    checkpoint: async (c) => {
      checkpoint = { ...c };
      ctx.job.checkpoint = checkpoint;
      await sql`update desk_research_jobs set checkpoint = ${JSON.stringify(checkpoint)}::jsonb, updated_at = now() where job_kind = ${job.job_kind} and job_key = ${job.job_key} and lease_owner = ${owner}`;
    },
    unit: async () => {
      await yieldToLoop();
      peak = Math.max(peak, process.memoryUsage().rss / 1_048_576);
      const d = governorDecision(await sampler(), thresholds);
      if (!d.run) throw new ResourceGuardPause(d.reasons);
    },
    scanned: (n) => { scanned += n; },
    written: (n) => { written += n; },
  };
  const handler = opts.handlers?.[job.job_kind] ?? HANDLERS[job.job_kind];
  try {
    if (!handler || !(JOB_KINDS as readonly string[]).includes(job.job_kind)) throw new Error(`unknown job kind ${job.job_kind}`);
    await handler(ctx);
    await finish(rawSql, job, owner, "complete", telemetry(), { checkpoint }, now());
    return "complete";
  } catch (error) {
    if (error instanceof ResourceGuardPause) {
      opts.onResourcePause?.(error.reasons);
      await finish(rawSql, job, owner, "skipped_resource_guard", telemetry(), { guard: error.reasons.join(","), checkpoint, not_before_ms: now() + 60_000 }, now());
      return "skipped_resource_guard";
    }
    if (error instanceof Defer) {
      await finish(rawSql, job, owner, "queued", telemetry(), { error: error.message, checkpoint, not_before_ms: now() + error.ms }, now());
      return "queued";
    }
    const message = error instanceof Error ? error.message : String(error);
    const boundedMessage = message.slice(0, 2000);
    opts.onJobError?.(boundedMessage);
    await finish(rawSql, job, owner, "failed", telemetry(), { error: boundedMessage, checkpoint, not_before_ms: now() + retryDelayMs(job.attempts) }, now());
    return "failed";
  }
}

/** One scheduler tick: governor first, then enqueue, then run jobs one at a time within the tick budget. */
export async function factoryTick(opts: RunOptions = {}): Promise<{ ran: number; guard: GovernorDecision | null }> {
  const st = state();
  if (st.busy) return { ran: 0, guard: null };
  st.busy = true;
  const now = opts.now ?? Date.now;
  st.lastTickAt = now();
  let ran = 0;
  let enqueued = 0;
  let midJobPause: string[] | null = null;
  let failed = 0;
  let lastJobError: string | null = null;
  try {
    const sql = opts.sql ?? await getSql();
    const sampler = opts.sampler ?? (() => defaultSample(sql));
    const thresholds = thresholdsFromEnv(opts.env ?? process.env, containerMemoryLimitMb());
    const sample = await sampler();
    const guard = governorDecision(sample, thresholds);
    st.lastSample = sample;
    st.lastGuard = guard;
    if (!guard.run) {
      st.paused += 1;
      reportRuntime("paused", { reasons: guard.reasons });
      return { ran: 0, guard };
    }
    if (now() - st.lastEnqueueAt >= ENQUEUE_EVERY_MS) {
      enqueued = await enqueueDue(sql, now());
      st.lastEnqueueAt = now();
    }
    const started = performance.now();
    while (performance.now() - started < TICK_BUDGET_MS) {
      const job = await claim(sql, st.owner, now());
      if (!job) break;
      const status = await runJob(sql, job, st.owner, {
        ...opts,
        onResourcePause: (reasons) => {
          midJobPause = reasons;
          opts.onResourcePause?.(reasons);
        },
        onJobError: (message) => {
          lastJobError = message;
          opts.onJobError?.(message);
        },
      });
      ran += 1;
      if (status === "complete") st.completed += 1;
      if (status === "failed") failed += 1;
      if (status === "skipped_resource_guard") { st.paused += 1; break; }
      await yieldToLoop();
    }
    if (midJobPause) {
      st.lastError = null;
      st.lastGuard = { run: false, reasons: midJobPause };
      reportRuntime("paused", { reasons: midJobPause, phase: "job" });
    } else if (failed > 0) {
      st.lastError = lastJobError ?? `${failed} research job(s) failed`;
      reportRuntime("error", { message: st.lastError, failed });
    } else {
      st.lastError = null;
      if (ran > 0 || enqueued > 0) reportRuntime("progress", { enqueued, ran }, false);
      else reportRuntime("running", { enqueued: 0, ran: 0 });
    }
    return { ran, guard };
  } catch (error) {
    st.lastError = error instanceof Error ? error.message : String(error);
    reportRuntime("error", { message: st.lastError });
    return { ran, guard: st.lastGuard };
  } finally {
    st.busy = false;
  }
}

/** Env-gated, default OFF. */
export function ensureResearchFactory(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!researchFactoryEnabled(env)) {
    reportRuntime("disabled");
    return "disabled";
  }
  const st = state();
  if (st.timer) return "already";
  st.eld = monitorEventLoopDelay({ resolution: 20 });
  st.eld.enable();
  st.timer = setInterval(() => void factoryTick(), TICK_MS);
  st.timer.unref?.();
  reportRuntime("started", { tick_ms: TICK_MS, enqueue_every_ms: ENQUEUE_EVERY_MS, max_concurrent_jobs: RESEARCH_FACTORY.max_concurrent_jobs });
  // Do not leave a newly enabled factory opaque for the first interval. The
  // same busy flag and governor used by scheduled ticks keep this bounded.
  void factoryTick();
  return "started";
}

export function researchFactoryHealth() {
  const st = g.__researchFactory__;
  return {
    factory: RESEARCH_FACTORY.id, production_authority: RESEARCH_FACTORY.production_authority, env_flag: RESEARCH_FACTORY.env_flag,
    enabled: researchFactoryEnabled(), running: !!st?.timer, busy: !!st?.busy, last_tick_at: st?.lastTickAt ? new Date(st.lastTickAt).toISOString() : null,
    last_sample: st?.lastSample ?? null, last_guard: st?.lastGuard ?? null, completed: st?.completed ?? 0, paused: st?.paused ?? 0, error: st?.lastError ?? null,
    thresholds: thresholdsFromEnv(process.env, containerMemoryLimitMb()), container_memory_limit_mb: containerMemoryLimitMb(),
  };
}

export async function researchFactoryReport(kind?: string, key = "latest", sqlIn?: Sql) {
  const sql = sqlIn ?? await getSql();
  const jobs = await sql<{ job_kind: string; status: string; n: number }>`select job_kind, status, count(*)::int as n from desk_research_jobs group by 1, 2 order by 1, 2`;
  const failures = await sql<Record<string, unknown>>`select job_kind, job_key, attempts, error, updated_at from desk_research_jobs where status = 'failed' order by updated_at desc limit 10`;
  const reports = kind
    ? await sql<Record<string, unknown>>`select report_kind, report_key, report_version, payload, build_sha, created_at from desk_research_reports where report_kind = ${kind} and report_key = ${key} and report_version = ${RESEARCH_FACTORY.report_version} limit 1`
    : await sql<Record<string, unknown>>`select report_kind, report_key, report_version, created_at from desk_research_reports where report_version = ${RESEARCH_FACTORY.report_version} order by created_at desc limit 50`;
  const { decisionTapeHealth } = await import("./research-factory-tape.server.ts");
  const { bookDepthHealth } = await import("./book-depth.server.ts");
  const { tradeFlowHealth } = await import("./trade-flow.server.ts");
  const { wickShadowHealth } = await import("./wick-effort.server.ts");
  return { health: researchFactoryHealth(), decision_tape: decisionTapeHealth(), book_depth: bookDepthHealth(), trade_flow: tradeFlowHealth(), wick_shadow: wickShadowHealth(), jobs, recent_failures: failures, reports, report_version: RESEARCH_FACTORY.report_version, report_state: reports.length ? "CURRENT_VERSION_AVAILABLE" : "PENDING_CURRENT_VERSION_REBUILD",
    rebuild_scope: { fact_version: RESEARCH_FACTORY.fact_version, auditor_version: RESEARCH_FACTORY.auditor_version, report_version: RESEARCH_FACTORY.report_version, lookback_days: LOOKBACK_DAYS,
      note: "Current reports cover the current derived versions and may be partial while governed replay jobs remain pending. Automatic replay covers the last 45 days; earlier derived versions and older history remain archived, not included as current all-time evidence." },
    authority: { production_authority: "NONE", auto_promotion: false, paid_apis: "none" } };
}

/** The admin reports page: the overview plus the latest version of every report and the newest daily digest, rendered as static HTML. */
export async function researchReportsPage(sqlIn?: Sql, nowMs: number = Date.now()): Promise<string> {
  const sql = sqlIn ?? await getSql();
  const overview = await researchFactoryReport(undefined, "latest", sql);
  const latest = await sql<StoredReport>`
    select distinct on (report_kind) report_kind, report_key, report_version, payload, build_sha, created_at::text as created_at
    from desk_research_reports where report_key = 'latest' and report_version = ${RESEARCH_FACTORY.report_version} order by report_kind, report_version desc`;
  const digest = await sql<StoredReport>`
    select report_kind, report_key, report_version, payload, build_sha, created_at::text as created_at
    from desk_research_reports where report_kind = 'daily_digest' and report_version = ${RESEARCH_FACTORY.report_version} order by report_key desc, report_version desc limit 1`;
  const { reports: _list, ...rest } = overview;
  void _list;
  return renderResearchPage({ generated_at: new Date(nowMs).toISOString(), overview: rest, latest, digest: digest[0] ?? null });
}
