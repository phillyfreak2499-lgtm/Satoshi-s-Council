/**
 * Whole-Lab lifecycle/freshness audit.
 *
 * This is intentionally separate from the individual research scorecards. A
 * study can be scientifically well-designed and still be operationally dead.
 * Here we answer: what is it for, should it be writing, when did it last write,
 * who reads it, and what closes the experiment?
 *
 * Important boundary: protected one-way measurements keep their own dedicated
 * readers. This aggregate never reaches around those rails just to count rows.
 */
import { getSql } from "@/lib/db";
import { LAB_INVENTORY, validateLabInventory, type LabInventoryItem } from "./lab-inventory";

type StorageStat = { storage: string; n: number; latest: string | null };
export type LabAuditHealth =
  | "FRESH"
  | "STALE"
  | "EMPTY"
  | "EVENT_DRIVEN"
  | "DERIVED"
  | "ON_DEMAND"
  | "PROCESS_LOCAL";

function ageSeconds(latest: string | null, now: number): number | null {
  if (!latest) return null;
  const t = Date.parse(latest);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

function healthOf(item: LabInventoryItem, stat: StorageStat | null, now: number): LabAuditHealth {
  if (item.writer_kind === "derived") return "DERIVED";
  if (item.writer_kind === "on-demand") return "ON_DEMAND";
  if (item.storage == null) return "PROCESS_LOCAL";
  if (item.writer_kind === "event-driven") return "EVENT_DRIVEN";
  if (!stat || Number(stat.n) <= 0 || !stat.latest) return "EMPTY";
  const age = ageSeconds(stat.latest, now);
  if (item.freshness_sla_s != null && age != null && age > item.freshness_sla_s) return "STALE";
  return "FRESH";
}

async function storageStats(): Promise<StorageStat[]> {
  const db = await getSql();
  return db<StorageStat>`
    select 'desk_basis_minutes'::text as storage, count(*)::int as n, max(minute)::text as latest
      from desk_basis_minutes
    union all
    select 'desk_lag_events', count(*)::int, max(t)::text from desk_lag_events
    union all
    select 'desk_replay', count(*)::int, max(close_time)::text from desk_replay
    union all
    select 'desk_samples', count(*)::int, max(taken_at)::text from desk_samples
    union all
    select 'desk_taker', count(*)::int, max(sampled_at)::text from desk_taker
    union all
    select 'desk_absorption', count(*)::int, max(t)::text from desk_absorption
    union all
    select 'desk_policy_observations', count(*)::int, max(close_time)::text from desk_policy_observations
    union all
    select 'desk_call_quality', count(*)::int, max(recorded_at)::text from desk_call_quality
    union all
    select 'desk_v3_samples', count(*)::int, max(taken_at)::text from desk_v3_samples
    union all
    select 'research_ledger', count(*)::int, max(close_time)::text from desk_ledger_research
    union all
    select 'skill_score_audit', count(*)::int, max(close_time)::text
      from desk_ledger_research where skill_score_audit is not null
    union all
    select 'desk_v4_frames', count(*)::int, max(taken_at)::text from desk_v4_frames
    union all
    select 'desk_v5_windows', count(*)::int, max(first_seen_at)::text from desk_v5_windows
  `;
}

export async function labAuditSnapshot() {
  const now = Date.now();
  const errors = validateLabInventory();
  const stats = new Map((await storageStats()).map((row) => [row.storage, row]));
  const items = LAB_INVENTORY.map((item) => {
    const stat = item.storage ? stats.get(item.storage) ?? null : null;
    const health = healthOf(item, stat, now);
    return {
      ...item,
      health,
      rows: stat ? Number(stat.n) : null,
      latest: stat?.latest ?? null,
      age_s: stat ? ageSeconds(stat.latest, now) : null,
      stale: health === "STALE",
      empty: health === "EMPTY",
    };
  });
  const problems = items.filter((x) => x.health === "STALE" || x.health === "EMPTY");
  return {
    at: new Date(now).toISOString(),
    authority: { changes_nothing: true, paper_only: true },
    inventory_errors: errors,
    summary: {
      total: items.length,
      active_or_control: items.filter((x) => x.lifecycle === "ACTIVE" || x.lifecycle === "CONTROL").length,
      derived: items.filter((x) => x.lifecycle === "DERIVED").length,
      on_demand: items.filter((x) => x.lifecycle === "ON_DEMAND").length,
      stale: items.filter((x) => x.health === "STALE").length,
      empty: items.filter((x) => x.health === "EMPTY").length,
      event_driven: items.filter((x) => x.health === "EVENT_DRIVEN").length,
    },
    problems: problems.map((x) => ({
      id: x.id,
      label: x.label,
      health: x.health,
      rows: x.rows,
      latest: x.latest,
      age_s: x.age_s,
      freshness_sla_s: x.freshness_sla_s,
      question: x.question,
      reader: x.reader,
      exit_criterion: x.exit_criterion,
    })),
    items,
  };
}
