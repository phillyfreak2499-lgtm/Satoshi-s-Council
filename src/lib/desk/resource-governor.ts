/** Shared, pure pressure gate for background research work. */
export type ResourceSample = {
  rss_mb: number;
  load_per_cpu: number;
  event_loop_p99_ms: number;
  db_waiting: number | null;
  db_in_use: number | null;
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

export function thresholdsFromEnv(env: Record<string, string | undefined>, memoryLimitMb: number | null): GovernorThresholds {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return env[k] != null && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d;
  };
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
