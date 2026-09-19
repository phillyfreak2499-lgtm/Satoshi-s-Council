/**
 * Read-only whole-Lab freshness snapshot.
 *
 * One aggregate query answers whether each durable collector is still producing
 * evidence. Manual and event-driven studies are deliberately not called stale
 * just because no timer fired.
 */
import { getSql } from "@/lib/db";
import {
  LAB_RESEARCH_REGISTRY,
  labStudyHealth,
  type LabStudyHealth,
  type LabStudySpec,
} from "./lab-registry";

const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

type StatRow = {
  id: string;
  n: number | string;
  last_ms: number | string | null;
};

export type PublicLabRegistryRow = LabStudySpec & {
  sample_n: number;
  last_evidence_at: string | null;
  health: LabStudyHealth;
};

export type PublicLabRegistrySnapshot = {
  at: string;
  rows: PublicLabRegistryRow[];
  tally: Record<LabStudyHealth, number>;
  authority: { changes_nothing: true };
};

let cache: { at: number; value: PublicLabRegistrySnapshot } | null = null;

type RegistryObserver = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  lastError: string | null;
  lastAttemptAt: number;
};

const g = globalThis as typeof globalThis & { __labRegistryObserver__?: RegistryObserver };
function registryObserver(): RegistryObserver {
  return (g.__labRegistryObserver__ ??= {
    timer: null,
    inFlight: false,
    lastError: null,
    lastAttemptAt: 0,
  });
}

const msExpr = (v: number | string | null | undefined): string | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
};

async function computeLabRegistrySnapshot(): Promise<PublicLabRegistrySnapshot> {
  const db = await getSql();
  const core = await db<StatRow>`
    with replay_stats as materialized (
      select
        count(*)::int as n,
        max(extract(epoch from created_at) * 1000)::bigint as last_ms,
        count(*) filter (
          where jsonb_typeof(cols -> 'imb') = 'array'
            and exists (
              select 1 from jsonb_array_elements(cols -> 'imb') as value
              where value <> 'null'::jsonb
            )
        )::int as tape_n,
        max(extract(epoch from created_at) * 1000) filter (
          where jsonb_typeof(cols -> 'imb') = 'array'
            and exists (
              select 1 from jsonb_array_elements(cols -> 'imb') as value
              where value <> 'null'::jsonb
            )
        )::bigint as tape_last_ms,
        count(*) filter (
          where jsonb_typeof(cols -> 'resid') = 'array'
            and exists (
              select 1 from jsonb_array_elements(cols -> 'resid') as value
              where value <> 'null'::jsonb
            )
        )::int as vel_n,
        max(extract(epoch from created_at) * 1000) filter (
          where jsonb_typeof(cols -> 'resid') = 'array'
            and exists (
              select 1 from jsonb_array_elements(cols -> 'resid') as value
              where value <> 'null'::jsonb
            )
        )::bigint as vel_last_ms,
        count(*) filter (
          where jsonb_typeof(cols -> 'fair') = 'array'
            and exists (
              select 1 from jsonb_array_elements(cols -> 'fair') as value
              where value <> 'null'::jsonb
            )
        )::int as fair_n,
        max(extract(epoch from created_at) * 1000) filter (
          where jsonb_typeof(cols -> 'fair') = 'array'
            and exists (
              select 1 from jsonb_array_elements(cols -> 'fair') as value
              where value <> 'null'::jsonb
            )
        )::bigint as fair_last_ms
      from desk_replay
    ),
    decision_stats as materialized (
      select
        count(*)::int as n,
        max(extract(epoch from receipt_at) * 1000)::bigint as last_ms,
        count(*) filter (where higher_context is not null)::int as higher_n,
        max(extract(epoch from receipt_at) * 1000) filter (where higher_context is not null)::bigint as higher_last_ms
      from desk_decision_snapshots
    )
    select 'chair-v2' as id, count(*)::int as n,
      max(extract(epoch from taken_at) * 1000)::bigint as last_ms
      from desk_samples
    union all
    select 'chair-v3', count(*)::int,
      max(extract(epoch from taken_at) * 1000)::bigint
      from desk_v3_samples
    union all
    select 'taker-v1', count(*)::int,
      max(extract(epoch from sampled_at) * 1000)::bigint
      from desk_taker
    union all
    select 'forced-v4', count(*)::int,
      max(extract(epoch from taken_at) * 1000)::bigint
      from desk_v4_forced
    union all
    select 'openai-shadow-v1', count(*)::int,
      max(extract(epoch from taken_at) * 1000)::bigint
      from desk_openai_shadow
    union all
    select 'openai-blind-v1', count(*)::int,
      max(extract(epoch from taken_at) * 1000)::bigint
      from desk_openai_blind
    union all
    select 'openai-luna-v1', count(*)::int,
      max(extract(epoch from taken_at) * 1000)::bigint
      from desk_openai_luna
    union all
    select 'astra-director', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_astra_director
    union all
    select 'policy-exit', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_policy_fills
    union all
    select 'seat-timing', n, last_ms from replay_stats
    union all
    select 'call-quality', count(*)::int,
      max(extract(epoch from recorded_at) * 1000)::bigint
      from desk_call_quality
    union all
    select 'chair-ablation', count(*)::int,
      max(extract(epoch from recorded_at) * 1000)::bigint
      from desk_chair_ablation
    union all
    select 'tape2', tape_n, tape_last_ms from replay_stats
    union all
    select 'vel2', vel_n, vel_last_ms from replay_stats
    union all
    select 'strike2', n, last_ms from replay_stats
    union all
    select 'decision-snapshots', n, last_ms from decision_stats
    union all
    select 'higher-context', higher_n, higher_last_ms from decision_stats
    union all
    select 'null-horizon', n, last_ms from replay_stats
    union all
    select 'index-settlement-fair', fair_n, fair_last_ms from replay_stats
    union all
    select 'hourly-book', count(*)::int,
      max(extract(epoch from recorded_at) * 1000)::bigint
      from desk_hour_ledger
  `;

  // Keep the largest ledgers in separate statements. Production enforces a
  // 15-second statement timeout; each query below is comfortably below it,
  // while one giant UNION of every exact count can cross the limit.
  const absorption = await db<StatRow>`
    with a as (
      select count(*)::int as n,
             max(extract(epoch from close_time) * 1000)::bigint as last_ms
        from desk_absorption
    )
    select 'whale2' as id, n, last_ms from a
    union all
    select 'absorption', n, last_ms from a
  `;

  const large = await db<StatRow>`
    select 'path-parity' as id, count(*)::int as n,
      max(extract(epoch from sampled_at) * 1000)::bigint as last_ms
      from desk_path_parity
    union all
    select 'lag-events', count(*)::int,
      max(extract(epoch from t) * 1000)::bigint
      from desk_lag_events
    union all
    select 'basis-minutes', count(*)::int,
      max(extract(epoch from minute) * 1000)::bigint
      from desk_basis_minutes
  `;

  const stats = [...core, ...absorption, ...large];

  const now = Date.now();
  const byId = new Map(stats.map((row) => [row.id, row]));
  const rows = LAB_RESEARCH_REGISTRY.map((spec): PublicLabRegistryRow => {
    const stat = byId.get(spec.id);
    const sampleN = Math.max(0, Number(stat?.n ?? 0) || 0);
    const lastEvidenceAt = msExpr(stat?.last_ms);
    return {
      ...spec,
      sample_n: sampleN,
      last_evidence_at: lastEvidenceAt,
      health: labStudyHealth(spec, sampleN, lastEvidenceAt, now),
    };
  });

  const tally: Record<LabStudyHealth, number> = {
    collecting: 0,
    stale: 0,
    manual: 0,
    "event-driven": 0,
    "no-sample": 0,
  };
  for (const row of rows) tally[row.health] += 1;

  const value: PublicLabRegistrySnapshot = {
    at: new Date(now).toISOString(),
    rows,
    tally,
    authority: { changes_nothing: true },
  };
  cache = { at: now, value };
  return value;
}

export async function refreshLabRegistrySnapshot(): Promise<void> {
  const st = registryObserver();
  const now = Date.now();
  if (st.inFlight) return;
  if (st.lastAttemptAt && now - st.lastAttemptAt < RETRY_MS) return;
  st.inFlight = true;
  st.lastAttemptAt = now;
  try {
    await computeLabRegistrySnapshot();
    st.lastError = null;
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.inFlight = false;
  }
}

export function ensureLabRegistryObserver(): void {
  const st = registryObserver();
  if (st.timer) return;
  st.timer = setInterval(() => void refreshLabRegistrySnapshot(), REFRESH_MS);
  void refreshLabRegistrySnapshot();
}

/**
 * Request-path reader: never performs the expensive lifecycle scan itself.
 * It serves the most recent successful warm-cache snapshot and lets the
 * background observer refresh it independently.
 */
export async function labRegistrySnapshot(): Promise<PublicLabRegistrySnapshot> {
  if (cache) return cache.value;
  void refreshLabRegistrySnapshot();
  throw new Error("Lab registry snapshot is warming");
}
