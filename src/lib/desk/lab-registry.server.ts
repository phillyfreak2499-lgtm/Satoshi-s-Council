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

const TTL_MS = 60_000;

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

const msExpr = (v: number | string | null | undefined): string | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
};

export async function labRegistrySnapshot(): Promise<PublicLabRegistrySnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const db = await getSql();
  const stats = await db<StatRow>`
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
    select 'astra-director', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_astra_director
    union all
    select 'policy-exit', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_policy_fills
    union all
    select 'seat-timing', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_replay
    union all
    select 'call-quality', count(*)::int,
      max(extract(epoch from recorded_at) * 1000)::bigint
      from desk_call_quality
    union all
    select 'tape2', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_replay
      where jsonb_typeof(cols -> 'imb') = 'array'
        and exists (
          select 1 from jsonb_array_elements(cols -> 'imb') as value
          where value <> 'null'::jsonb
        )
    union all
    select 'vel2', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_replay
      where jsonb_typeof(cols -> 'resid') = 'array'
        and exists (
          select 1 from jsonb_array_elements(cols -> 'resid') as value
          where value <> 'null'::jsonb
        )
    union all
    select 'strike2', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_replay
    union all
    select 'whale2', count(*)::int,
      max(extract(epoch from t) * 1000)::bigint
      from desk_absorption
    union all
    select 'absorption', count(*)::int,
      max(extract(epoch from t) * 1000)::bigint
      from desk_absorption
    union all
    select 'path-parity', count(*)::int,
      max(extract(epoch from sampled_at) * 1000)::bigint
      from desk_path_parity
    union all
    select 'decision-snapshots', count(*)::int,
      max(extract(epoch from receipt_at) * 1000)::bigint
      from desk_decision_snapshots
    union all
    select 'higher-context', count(*)::int,
      max(extract(epoch from receipt_at) * 1000)::bigint
      from desk_decision_snapshots where higher_context is not null
    union all
    select 'null-horizon', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_replay
    union all
    select 'index-settlement-fair', count(*)::int,
      max(extract(epoch from created_at) * 1000)::bigint
      from desk_replay
      where jsonb_typeof(cols -> 'fair') = 'array'
        and exists (
          select 1 from jsonb_array_elements(cols -> 'fair') as value
          where value <> 'null'::jsonb
        )
    union all
    select 'lag-events', count(*)::int,
      max(extract(epoch from t) * 1000)::bigint
      from desk_lag_events
    union all
    select 'basis-minutes', count(*)::int,
      max(extract(epoch from minute) * 1000)::bigint
      from desk_basis_minutes
    union all
    select 'hourly-book', count(*)::int,
      max(extract(epoch from recorded_at) * 1000)::bigint
      from desk_hour_ledger
  `;

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
