import { getSql } from "@/lib/db";
import { getReadinessIntegrity } from "./server-engine";
import { readinessReport, type ReadinessReport, type RegimeCount } from "./readiness";
import { TAKER_FROZEN_AT } from "./taker";

/** Everything is counted from the start of the freeze date, so the evaluation
 *  stays strictly out-of-sample and the experiment boundary stays identifiable. */
const FREEZE_ISO = `${TAKER_FROZEN_AT}T00:00:00Z`;

let cache: { at: number; snap: ReadinessSnapshot } | null = null;
const TTL_MS = 60_000;

export type ReadinessSnapshot = ReadinessReport & {
  generated_at: number;
  info: {
    days_since_freeze: number;
    windows_all_time: number;
    chair_dir_since_freeze: number;
    taker_total: number;
    regimes: RegimeCount[];
    integrity: ReturnType<typeof getReadinessIntegrity>;
    alerted: boolean;
  };
};

/**
 * The read-only readiness snapshot for the owner: how much out-of-sample data
 * has accumulated since the freeze, and whether it clears the gate. Reads the
 * ledger and the TAKER shadow table only, and folds in the engine's live ledger
 * integrity. Touches nothing the desk decides. Cached 60s.
 *
 * `alerted` reflects whether the one-time owner push has already fired; it is
 * passed in by the caller (the engine, which owns the latch) and defaults to
 * false for plain endpoint reads.
 */
export async function readinessSnapshot(alerted = false): Promise<ReadinessSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { ...cache.snap, info: { ...cache.snap.info, alerted } };
  }
  const db = await getSql();

  const led = await db<{
    windows_since_freeze: number;
    chair_wait: number;
    chair_dir: number;
    windows_all: number;
  }>`
    select
      count(*) filter (where close_time >= ${FREEZE_ISO})                              as windows_since_freeze,
      count(*) filter (where close_time >= ${FREEZE_ISO} and chair_lean = 'WAIT')      as chair_wait,
      count(*) filter (where close_time >= ${FREEZE_ISO} and chair_lean in ('UP','DOWN')) as chair_dir,
      count(*)                                                                          as windows_all
    from desk_ledger
  `;

  const tak = await db<{ dir_graded: number; total: number }>`
    select
      count(*) filter (
        where eligible and lean in ('UP','DOWN') and winner in ('UP','DOWN')
          and close_time >= ${FREEZE_ISO}
      ) as dir_graded,
      count(*) as total
    from desk_taker
  `;

  const regs = await db<{ regime: string; n: number }>`
    select coalesce(nullif(regime, ''), '') as regime, count(*)::int as n
    from desk_taker
    where winner in ('UP','DOWN') and close_time >= ${FREEZE_ISO}
    group by 1
  `;

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const regimes: RegimeCount[] = regs
    .map((r) => ({ regime: r.regime || "", n: num(r.n) }))
    .sort((a, b) => b.n - a.n);
  const integrity = getReadinessIntegrity();

  const report = readinessReport({
    windows_since_freeze: num(led[0]?.windows_since_freeze),
    taker_dir_graded: num(tak[0]?.dir_graded),
    chair_wait_since_freeze: num(led[0]?.chair_wait),
    regimes,
    gaps: integrity.gaps,
    recon_new_holes: integrity.recon_new_holes,
  });

  const now = Date.now();
  const days = Math.max(0, Math.floor((now - Date.parse(FREEZE_ISO)) / 86_400_000));
  const snap: ReadinessSnapshot = {
    ...report,
    generated_at: now,
    info: {
      days_since_freeze: days,
      windows_all_time: num(led[0]?.windows_all),
      chair_dir_since_freeze: num(led[0]?.chair_dir),
      taker_total: num(tak[0]?.total),
      regimes,
      integrity,
      alerted,
    },
  };
  cache = { at: now, snap };
  return snap;
}

/** For the engine's hourly latch: is the gate passed right now? Read-only. */
export async function readinessReady(): Promise<boolean> {
  return (await readinessSnapshot()).ready;
}
