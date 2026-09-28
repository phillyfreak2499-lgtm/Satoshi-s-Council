/**
 * RESEARCH FACTORY — the pure core (no clock, no database, no process state).
 *
 * A background, resource-governed research queue that makes every settled
 * 15-minute window more informative. Research only: production authority NONE.
 * It reads stored research records and writes only its own tables; it never
 * changes a Chair threshold, the floor, booking, the learner, a seat, or any
 * experiment's recorded receipts. It calls no paid API and no model.
 *
 * This file holds what must be deterministic and testable in isolation: the
 * job vocabulary, the resource governor's decision, and the statistics every
 * report uses. The scheduler, database I/O and sampling live in
 * research-factory.server.ts.
 */
import { neededWinRatePct } from "./fee-engine.ts";
import { maxDrawdown } from "./promotion-gates.ts";

export const RESEARCH_FACTORY = Object.freeze({
  id: "RESEARCH_FACTORY_V1",
  production_authority: "NONE",
  env_flag: "RESEARCH_FACTORY_ENABLED",
  /** At most one job runs at a time, in this process and (by lease) across processes. */
  max_concurrent_jobs: 1,
  /** Versions of the derived rows; a new version writes new rows beside the old ones. */
  fact_version: 1,
  auditor_version: 1,
  report_version: 1,
} as const);

/**
 * The research experiments the factory knows by name. Held here as data so the
 * factory never imports (or loads) a recorder module; a unit test pins each
 * value to the recorder's own frozen constant.
 */
export const KNOWN_EXPERIMENTS = Object.freeze({
  mid_recovery_v1: Object.freeze({ id: "MID_RECOVERY_V1_INACTIVE", version: 1 }),
  mid_recovery_locks_v1: Object.freeze({ id: "MID_RECOVERY_LOCKS_V1_INACTIVE", version: 1 }),
  mid_recovery_locks_v2: Object.freeze({ id: "MID_RECOVERY_LOCKS_V2_INACTIVE", version: 1 }),
  /** The recorders' entry band starts 180 s before the close: nothing is decided later. */
  decision_cutoff_secs: 180,
} as const);

export const JOB_STATUSES = ["queued", "running", "complete", "failed", "skipped_resource_guard"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * The job kinds. `window` re-grades one settled window (replay facts + integrity
 * annotations); `rollup` recomputes the cross-window reports; `digest` writes
 * the day's research digest. New kinds register a handler in the server module.
 */
export const JOB_KINDS = ["window", "rollup", "digest"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Retry policy: a failed job is retried with backoff up to this many attempts, then left failed. */
export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 5 * 60_000;
export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

// ---------------------------------------------------------------------------
// Resource governor.
// ---------------------------------------------------------------------------

export type ResourceSample = {
  rss_mb: number;
  /** 1-minute load average divided by available CPUs. */
  load_per_cpu: number;
  /** p99 event-loop delay over the last sample window: the direct cause of request latency in one Node process. */
  event_loop_p99_ms: number;
  /** Clients waiting for a pooled DB connection (null on the embedded fallback). */
  db_waiting: number | null;
  /** Pool connections in use (null on the embedded fallback). */
  db_in_use: number | null;
  /** Round trip of a trivial query, ms (null when not measured). */
  db_ping_ms: number | null;
};

export type GovernorThresholds = {
  max_rss_mb: number;
  max_load_per_cpu: number;
  max_event_loop_p99_ms: number;
  max_db_waiting: number;
  max_db_in_use: number;
  max_db_ping_ms: number;
};

export const DEFAULT_THRESHOLDS: GovernorThresholds = Object.freeze({
  max_rss_mb: 1_400,
  max_load_per_cpu: 0.7,
  max_event_loop_p99_ms: 80,
  max_db_waiting: 0,
  max_db_in_use: 6,
  max_db_ping_ms: 300,
});

/** Read thresholds from the environment; anything absent or non-numeric keeps its default. */
export function thresholdsFromEnv(env: Record<string, string | undefined>, memoryLimitMb: number | null): GovernorThresholds {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return env[k] != null && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d;
  };
  // Default memory ceiling: 60% of the container limit when known, else the fixed default.
  const memDefault = memoryLimitMb != null && memoryLimitMb > 0 ? Math.round(memoryLimitMb * 0.6) : DEFAULT_THRESHOLDS.max_rss_mb;
  return {
    max_rss_mb: num("RESEARCH_FACTORY_MAX_RSS_MB", memDefault),
    max_load_per_cpu: num("RESEARCH_FACTORY_MAX_LOAD_PER_CPU", DEFAULT_THRESHOLDS.max_load_per_cpu),
    max_event_loop_p99_ms: num("RESEARCH_FACTORY_MAX_EVENT_LOOP_P99_MS", DEFAULT_THRESHOLDS.max_event_loop_p99_ms),
    max_db_waiting: num("RESEARCH_FACTORY_MAX_DB_WAITING", DEFAULT_THRESHOLDS.max_db_waiting),
    max_db_in_use: num("RESEARCH_FACTORY_MAX_DB_IN_USE", DEFAULT_THRESHOLDS.max_db_in_use),
    max_db_ping_ms: num("RESEARCH_FACTORY_MAX_DB_PING_MS", DEFAULT_THRESHOLDS.max_db_ping_ms),
  };
}

export type GovernorDecision = { run: boolean; reasons: string[] };

/**
 * Production traffic always wins: any one pressure signal over its threshold
 * pauses research. A missing signal is not treated as pressure (the embedded
 * database has no pool), but a non-finite reading of a present signal is.
 */
export function governorDecision(s: ResourceSample, t: GovernorThresholds): GovernorDecision {
  const reasons: string[] = [];
  const bad = (x: number) => !Number.isFinite(x);
  if (bad(s.rss_mb) || s.rss_mb > t.max_rss_mb) reasons.push("MEMORY");
  if (bad(s.load_per_cpu) || s.load_per_cpu > t.max_load_per_cpu) reasons.push("SYSTEM_LOAD");
  if (bad(s.event_loop_p99_ms) || s.event_loop_p99_ms > t.max_event_loop_p99_ms) reasons.push("REQUEST_LATENCY");
  if (s.db_waiting != null && (bad(s.db_waiting) || s.db_waiting > t.max_db_waiting)) reasons.push("DB_POOL_WAITING");
  if (s.db_in_use != null && (bad(s.db_in_use) || s.db_in_use > t.max_db_in_use)) reasons.push("DB_POOL_BUSY");
  if (s.db_ping_ms != null && (bad(s.db_ping_ms) || s.db_ping_ms > t.max_db_ping_ms)) reasons.push("DB_LATENCY");
  return { run: reasons.length === 0, reasons };
}

/**
 * research_compute_utilization: research CPU time as a share of the capacity
 * the service has over the same wall period (cpus x wall). CPU time is a
 * process-wide estimate taken around each job, so it is an upper bound.
 */
export function computeUtilization(researchCpuMs: number, wallMs: number, cpus: number): number | null {
  if (!(wallMs > 0) || !(cpus > 0) || !Number.isFinite(researchCpuMs)) return null;
  return Math.round((Math.max(0, researchCpuMs) / (wallMs * cpus)) * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Statistics. Every report uses these and nothing else.
// ---------------------------------------------------------------------------

export const round = (x: number | null, d = 1): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Wilson score interval for k successes in n trials, in percent. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { lo: Math.round(Math.max(0, centre - half) * 1000) / 10, hi: Math.round(Math.min(1, centre + half) * 1000) / 10 };
}

/** Brier score of probabilities p (0-1) against outcomes y (0/1). */
export function brier(ps: readonly number[], ys: readonly (0 | 1)[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  return Math.round((ps.reduce((a, p, i) => a + (p - ys[i]!) ** 2, 0) / ps.length) * 1e4) / 1e4;
}

/** Mean log loss, probabilities clipped to [1e-6, 1 - 1e-6]. */
export function logLoss(ps: readonly number[], ys: readonly (0 | 1)[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  const e = 1e-6;
  const v = ps.reduce((a, p, i) => { const q = Math.min(1 - e, Math.max(e, p)); return a - (ys[i] ? Math.log(q) : Math.log(1 - q)); }, 0) / ps.length;
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Expected calibration error over equal-width bins. Only reported when every
 * populated bin holds at least `minPerBin` observations — otherwise it would be
 * noise dressed as a number.
 */
export function ece(ps: readonly number[], ys: readonly (0 | 1)[], bins = 5, minPerBin = 10): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  const groups = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  ps.forEach((p, i) => { const b = Math.min(bins - 1, Math.max(0, Math.floor(p * bins))); const g = groups[b]!; g.n += 1; g.p += p; g.y += ys[i]!; });
  const populated = groups.filter((g) => g.n > 0);
  if (populated.some((g) => g.n < minPerBin)) return null;
  const v = populated.reduce((a, g) => a + (g.n / ps.length) * Math.abs(g.p / g.n - g.y / g.n), 0);
  return Math.round(v * 1e4) / 1e4;
}

function logGamma(x: number): number {
  // Lanczos approximation.
  const c = [76.18009172947146, -86.50532941664311, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) { y += 1; ser += ci / y; }
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * ser) / x);
}

/** One-sided exact binomial P(X >= k | n, p): how surprising k wins are if the true win rate were p. */
export function binomialUpperP(k: number, n: number, p: number): number | null {
  if (!(n > 0) || k < 0 || k > n || !(p > 0 && p < 1)) return null;
  let total = 0;
  for (let i = k; i <= n; i += 1) total += Math.exp(logGamma(n + 1) - logGamma(i + 1) - logGamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, Math.max(0, total));
}

/** Benjamini-Hochberg: which p-values survive at false-discovery rate q. Returns a boolean per input, in input order. */
export function benjaminiHochberg(ps: readonly (number | null)[], q = 0.1): boolean[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p != null).sort((a, b) => a.p - b.p);
  const m = idx.length;
  let cut = -1;
  idx.forEach((x, rank) => { if (x.p <= ((rank + 1) / m) * q) cut = rank; });
  const pass = new Array<boolean>(ps.length).fill(false);
  for (let r = 0; r <= cut; r += 1) pass[idx[r]!.i] = true;
  return pass;
}

/** One population of simulated or real fills, graded the same way everywhere. */
export type Fill = { side: "UP" | "DOWN"; ask_cents: number; fee_cents: number; winner: "UP" | "DOWN" | null; close_ms: number };

export type FillStats = {
  fills: number;
  settled: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  win_rate_ci95: { lo: number; hi: number } | null;
  avg_entry_cents: number | null;
  breakeven_win_rate_pct: number | null;
  net_cents: number | null;
  cents_per_fill: number | null;
  max_drawdown_cents: number | null;
  /** The market-implied probability (ask/100) is the only genuine probability a fill carries. */
  brier_market: number | null;
  log_loss_market: number | null;
  ece_market: number | null;
};

export function netOf(f: Fill): number | null {
  if (f.winner == null) return null;
  return f.side === f.winner ? 100 - f.ask_cents - f.fee_cents : -f.ask_cents - f.fee_cents;
}

export function fillStats(fills: readonly Fill[]): FillStats {
  const sorted = [...fills].sort((a, b) => a.close_ms - b.close_ms);
  const settled = sorted.filter((f) => f.winner != null);
  const wins = settled.filter((f) => f.side === f.winner).length;
  const nets = settled.map((f) => netOf(f)!);
  const ps = settled.map((f) => f.ask_cents / 100);
  const ys = settled.map((f) => (f.side === f.winner ? 1 : 0) as 0 | 1);
  const asks = sorted.map((f) => f.ask_cents);
  return {
    fills: sorted.length, settled: settled.length, wins, losses: settled.length - wins,
    win_rate_pct: settled.length ? round((wins / settled.length) * 100) : null,
    win_rate_ci95: wilson(wins, settled.length),
    avg_entry_cents: round(mean(asks)),
    breakeven_win_rate_pct: asks.length ? round(neededWinRatePct(asks)) : null,
    net_cents: nets.length ? round(sum(nets)) : null,
    cents_per_fill: round(mean(nets)),
    max_drawdown_cents: nets.length ? maxDrawdown(nets) : null,
    brier_market: brier(ps, ys), log_loss_market: logLoss(ps, ys), ece_market: ece(ps, ys),
  };
}
