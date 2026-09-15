/**
 * The Lab's writer (server only): what each frozen exit policy would have done to
 * the position the Chair actually took.
 *
 * RUNS AT SETTLE, OFF THE DECISION PATH. By the time a window grades, the desk
 * already holds both things this needs: the real paper fill, with its price and
 * timestamp, and the window's full replay series. So nothing here has to run
 * during the window, nothing here can slow the brain loop, and nothing here can
 * change what the desk decided. It reads durable state and writes its own table.
 *
 * PAPER ONLY. Every row is a simulated exit on a paper book. There is no order,
 * no venue, no size, and no path from this module to one.
 *
 * WHAT IT WILL NOT DO. It will not invent an entry for a window the Chair sat out
 * — there is nothing to exit. It will not write a row it could not price; an
 * unpriceable window is recorded as DATA_INVALID and counts toward nothing. And
 * it writes with ON CONFLICT DO NOTHING, so a restart mid-settle replays the
 * write without revising a recorded result.
 */
import { getSql } from "@/lib/db";
import { takerFeeCents } from "./clock";
import {
  runArena,
  type Entry,
  type Observation,
  type PricePoint,
  type Side,
} from "./exit-arena";
import { EXIT_CANDIDATES, exitCandidatesForEntry, FLOOR_V1, FLOOR_SELECTIVE_V1, FLOOR_SELECTIVE_V2, type Component, type FloorPolicyVersion } from "./floor-policy";

/**
 * The research version stamped on every observation.
 *
 * Bumped by hand when the measurement changes in a way that makes earlier rows
 * incomparable. It is not a build id: a deploy that changes nothing about how an
 * observation is computed must not make the previous rows look like a different
 * study.
 */
export const LAB_RESEARCH_VERSION = "lab-1";

/** What the writer needs about the graded window. */
export type SettledWindow = {
  ticker: string;
  /** Window close, ms. */
  closeMs: number;
  /** The official settlement — never derived from a price. */
  winner: Side;
  /** The real paper fill, or null when the Chair did not take a position. */
  entry: Entry | null;
  /** The window's replay price series. */
  path: readonly PricePoint[];
};

/** Read the active Champion, falling back to the composition that is the unchanged desk. */
export async function activeChampion(): Promise<FloorPolicyVersion> {
  try {
    const db = await getSql();
    const rows = await db<{
      policy_id: string;
      version: number;
      signal_policy: string;
      entry_policy: string;
      exit_policy: string;
      risk_policy: string;
      created_at: string;
      prospective_start_at: string;
    }>`
      select policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy,
             created_at, prospective_start_at
        from desk_floor_policy where status = 'CHAMPION' limit 1
    `;
    const r = rows[0];
    if (!r || r.policy_id !== FLOOR_SELECTIVE_V2.policy_id) return FLOOR_SELECTIVE_V2;
    return {
      policy_id: r.policy_id,
      version: Number(r.version),
      signal_policy: r.signal_policy,
      entry_policy: r.entry_policy,
      exit_policy: r.exit_policy,
      risk_policy: r.risk_policy,
      created_at: String(r.created_at),
      prospective_start_at: String(r.prospective_start_at),
      status: "CHAMPION",
    };
  } catch {
    // The Champion must always be nameable. If it cannot be read, the answer is
    // the last known-good composition, never an improvised one.
    return FLOOR_SELECTIVE_V2;
  }
}

const iso = (ms: number | null): string | null => (ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

/**
 * Record every exit candidate's observation for one settled window.
 *
 * Returns how many rows were newly written, so the caller can log a silent
 * no-write rather than assuming it worked.
 */
/**
 * The key every candidate's observation references.
 *
 * Deterministic, so a write replayed after a restart produces the same key and the
 * ON CONFLICT guards still recognise it. Derived from the window and the moment of
 * the fill, which together identify one position.
 */
export function fillKeyOf(ticker: string, closeMs: number, entryT: number): string {
  return `${ticker}|${closeMs}|${entryT}`;
}

export async function recordExitArena(w: SettledWindow, champion: FloorPolicyVersion): Promise<number> {
  // No position, no exit competition. Not a failure — most windows are WAIT.
  if (!w.entry) return 0;
  if (!w.ticker || !(w.closeMs > 0)) return 0;
  const db = await getSql();
  // A held pre-V2 fill keeps its historical policy. Never relabel it as a V2 result.
  if (champion.policy_id === FLOOR_SELECTIVE_V2.policy_id && w.entry.t < Date.parse(champion.prospective_start_at)) {
    const [previous] = await db<FloorPolicyVersion>`
      select policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy,
             created_at::text, prospective_start_at::text, status
      from desk_floor_policy
      where policy_id in ('FLOOR_V1', 'FLOOR_SELECTIVE_V1')
        and prospective_start_at <= ${new Date(w.entry.t).toISOString()}::timestamptz
      order by prospective_start_at desc limit 1
    `;
    if (!previous) return 0; // Missing policy provenance cannot seed new research evidence.
    champion = previous;
  }
  // A position opened before activation still belongs to the original entry policy.
  if (champion.policy_id === FLOOR_SELECTIVE_V1.policy_id && w.entry.t < Date.parse(champion.prospective_start_at)) {
    champion = FLOOR_V1;
  }

  // A recovered older fill cannot seed a newly defined candidate's evidence.
  const rows = runArena(exitCandidatesForEntry(w.entry.t), w.entry, w.path, w.winner);
  if (!rows.length) return 0;

  const entryFee = takerFeeCents(w.entry.cents);
  const fillKey = fillKeyOf(w.ticker, w.closeMs, w.entry.t);

  // The source fill FIRST, once. Every observation references it, so two candidates
  // cannot describe different entries for the same window — there is only one entry
  // to describe. A foreign key makes that structural rather than conventional, which
  // is also why this write has to precede the candidates'.
  await db`
    insert into desk_policy_fills (
      fill_key, ticker, close_time, entry_side, entry_t, entry_cents, entry_fee_cents,
      signal_policy, entry_policy, risk_policy
    ) values (
      ${fillKey}, ${w.ticker}, ${new Date(w.closeMs).toISOString()}, ${w.entry.side},
      ${new Date(w.entry.t).toISOString()}, ${w.entry.cents}, ${entryFee},
      ${champion.signal_policy}, ${champion.entry_policy}, ${champion.risk_policy}
    )
    on conflict (fill_key) do nothing
  `;

  let written = 0;
  for (const { exit, obs } of rows) {
    const n = await writeOne(db, w, champion, exit, obs, entryFee, fillKey);
    written += n;
  }
  return written;
}

type Db = Awaited<ReturnType<typeof getSql>>;

async function writeOne(
  db: Db,
  w: SettledWindow,
  champion: FloorPolicyVersion,
  exit: Component,
  obs: Observation,
  entryFee: number,
  fillKey: string,
): Promise<number> {
  const entry = w.entry!;
  // The composition recorded beside the row is the Champion's, with THIS candidate
  // in the slot it is competing for — so the row says what policy it describes
  // even after the Champion changes.
  const exitPolicy = exit.id;
  const res = await db<{ id: number }>`
    insert into desk_policy_observations (
      fill_key,
      ticker, close_time, candidate_id, candidate_kind, candidate_version,
      signal_policy, entry_policy, exit_policy, risk_policy,
      entry_side, entry_t, entry_cents, entry_fee_cents,
      exit_t, exit_cents, exit_fee_cents, exit_reason, secs_held, proven_at,
      mfe_cents, mae_cents, settle_winner, direction_right, net_cents,
      data_invalid, invalid_why, code_version
    ) values (
      ${fillKey},
      ${w.ticker}, ${new Date(w.closeMs).toISOString()}, ${exit.id}, ${exit.kind}, ${exit.version},
      ${champion.signal_policy}, ${champion.entry_policy}, ${exitPolicy}, ${champion.risk_policy},
      ${entry.side}, ${new Date(entry.t).toISOString()}, ${entry.cents}, ${entryFee},
      ${iso(obs.exit_t)}, ${obs.exit_cents}, ${obs.exit_cents == null ? null : takerFeeCents(obs.exit_cents)},
      ${obs.exit_reason}, ${obs.secs_held}, ${iso(obs.proven_at)},
      ${obs.mfe_cents}, ${obs.mae_cents}, ${w.winner}, ${obs.direction_right}, ${obs.net_cents},
      ${obs.data_invalid}, ${obs.invalid_why}, ${LAB_RESEARCH_VERSION}
    )
    on conflict (candidate_id, ticker, close_time) do nothing
    returning id
  `;
  return res.length;
}

/**
 * The Lab's current standing, read-only.
 *
 * Counts only what the research view allows: quarantined windows and unpriceable
 * observations are already excluded by the view, so nothing here re-implements
 * that decision.
 */
export type CandidateStanding = {
  candidate_id: string;
  label: string;
  control: boolean;
  /** Prospective observations that count. */
  n: number;
  net_cents: number;
  avg_cents: number | null;
  profitable: number;
  losing: number;
  direction_right: number;
  direction_wrong: number;
  worst_cents: number | null;
  /** Net cents on the same windows the control saw, for a paired comparison. */
  paired_n: number;
  paired_delta: number | null;
};

export async function labStanding(): Promise<{ champion: FloorPolicyVersion; rows: CandidateStanding[]; at: string }> {
  const champion = await activeChampion();
  const db = await getSql();
  const raw = await db<{
    candidate_id: string;
    n: number;
    net: number | null;
    profitable: number;
    losing: number;
    dir_right: number;
    dir_wrong: number;
    worst: number | null;
  }>`
    select candidate_id,
           count(*)::int                                             as n,
           sum(net_cents)                                            as net,
           count(*) filter (where net_cents > 0)::int                 as profitable,
           count(*) filter (where net_cents < 0)::int                 as losing,
           count(*) filter (where direction_right)::int               as dir_right,
           count(*) filter (where direction_right = false)::int       as dir_wrong,
           min(net_cents)                                            as worst
      from desk_policy_observations_research
     group by candidate_id
  `;
  const byId = new Map(raw.map((r) => [r.candidate_id, r]));

  // Paired comparison against the control, on windows where BOTH produced a
  // countable observation. An unpaired average would compare different windows.
  const paired = await db<{ candidate_id: string; paired_n: number; delta: number | null }>`
    select c.candidate_id,
           count(*)::int                      as paired_n,
           sum(c.net_cents - h.net_cents)     as delta
      from desk_policy_observations_research c
      join desk_policy_observations_research h
        on h.fill_key = c.fill_key and h.candidate_id = 'HOLD_V1'
     where c.candidate_id <> 'HOLD_V1'
     group by c.candidate_id
  `;
  const byPair = new Map(paired.map((r) => [r.candidate_id, r]));

  const rows: CandidateStanding[] = EXIT_CANDIDATES.map((x) => {
    const r = byId.get(x.id);
    const p = byPair.get(x.id);
    const n = r?.n ?? 0;
    const net = Number(r?.net ?? 0);
    const pn = p?.paired_n ?? 0;
    return {
      candidate_id: x.id,
      label: x.label,
      control: x.control === true,
      n,
      net_cents: Math.round(net * 10) / 10,
      avg_cents: n > 0 ? Math.round((net / n) * 100) / 100 : null,
      profitable: r?.profitable ?? 0,
      losing: r?.losing ?? 0,
      direction_right: r?.dir_right ?? 0,
      direction_wrong: r?.dir_wrong ?? 0,
      worst_cents: r?.worst == null ? null : Math.round(Number(r.worst) * 10) / 10,
      paired_n: pn,
      paired_delta: pn > 0 && p?.delta != null ? Math.round((Number(p.delta) / pn) * 100) / 100 : null,
    };
  });

  return { champion, rows, at: new Date().toISOString() };
}
