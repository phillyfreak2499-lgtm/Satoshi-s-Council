/**
 * S2-5 decision-snapshot WRITER (server only). Measurement only, structurally so.
 *
 * One public write, `recordDecisionSnapshot`. It returns void, so there is
 * nothing a caller could branch on, and no seat, DSL rule, threshold, Chair
 * input, learned weight or skill imports it. The data goes one way -- a finalized
 * `(snap, chair)` pair, captured synchronously on the decision tick and handed
 * here as FACTS -- into desk_decision_snapshots. The only consumer is a research
 * query. It cannot steer a decision because there is nothing for a decision to read.
 *
 * WHAT IT PERSISTS, AND WHEN. At most two bounded events per exact window:
 *   OPENING            the first finalized read (UP/DOWN/WAIT), on the first tick
 *                      this process sees a window with no OPENING row yet.
 *   FIRST_DIRECTIONAL  the first later UP/DOWN read, only when the persisted
 *                      OPENING was WAIT.
 * The WHICH-event decision is the pure `decisionSnapshotEvents`; this module only
 * resolves the window's known state and performs the idempotent insert.
 *
 * THE DATABASE IS THE DURABLE AUTHORITY. The primary key
 * (ticker, close_time, snapshot_kind) makes every insert idempotent under
 * `on conflict do nothing`, so a restart, a replay, or a double tick can never
 * create a contradictory duplicate or rewrite an earlier read. Process-local
 * memory is only a cache to avoid re-probing every tick; on a cache miss (first
 * sight, or after a restart) the exact window is read back from the table FIRST,
 * so a FIRST_DIRECTIONAL decision always keys off the persisted OPENING lean --
 * the essential restart property (an opening WAIT survives a restart and a later
 * UP/DOWN still records).
 *
 * IT SWALLOWS ITS OWN ERRORS. A failed research write must never disturb a brain
 * tick, so a throw is caught and the window is NOT marked done -- the next tick
 * retries, and uniqueness makes a retry after a partial success harmless. A
 * transient failure therefore never permanently suppresses a row.
 *
 * NO RE-READ. It never calls a feed, never queries a current quote, never reads a
 * fill, a grade, or a replay point to populate a row. The row is exactly the facts
 * the decision tick already held.
 */
import { getSql } from "@/lib/db";
import {
  buildDecisionSnapshotRow,
  DECISION_RESEARCH_VERSION,
  decisionSnapshotEvents,
  type DecisionSnapshotRow,
  type SnapshotKind,
} from "./decision-snapshot";
import type { ChairResult, Lean, Snapshot } from "./types";

export { buildDecisionSnapshotRow, DECISION_RESEARCH_VERSION };

type Sql = Awaited<ReturnType<typeof getSql>>;

/** What this process knows about one live window. The DB, not this, is authoritative. */
type WindowMem = {
  openingDone: boolean;
  openingLean: Lean | null;
  firstDirectionalDone: boolean;
};

const mem = new Map<string, WindowMem>();
/** A handful of live windows, never an all-time ledger. */
const MEM_MAX = 64;

function memKey(ticker: string, closeMs: number): string {
  return `${ticker}|${closeMs}`;
}

function setMem(key: string, state: WindowMem): void {
  mem.set(key, state);
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
}

/** Reset point for tests only. Not wired into the engine. */
export function __resetDecisionMem(): void {
  mem.clear();
}

/**
 * Read the exact window's persisted state back from the table.
 *
 * EXACT window only -- `ticker` AND `close_time` -- never ticker alone and never a
 * nearest-close fallback, so one window's reads can never be resolved from another's.
 */
async function resolveWindow(db: Sql, ticker: string, closeIso: string): Promise<WindowMem> {
  const rows = await db<{ snapshot_kind: string; chair_lean: string }>`
    select snapshot_kind, chair_lean
      from desk_decision_snapshots
     where ticker = ${ticker} and close_time = ${closeIso}
  `;
  const state: WindowMem = { openingDone: false, openingLean: null, firstDirectionalDone: false };
  for (const r of rows) {
    if (r.snapshot_kind === "OPENING") {
      state.openingDone = true;
      state.openingLean = r.chair_lean as Lean;
    } else if (r.snapshot_kind === "FIRST_DIRECTIONAL") {
      state.firstDirectionalDone = true;
    }
  }
  return state;
}

async function insertRow(db: Sql, row: DecisionSnapshotRow, kind: SnapshotKind): Promise<void> {
  await db`
    insert into desk_decision_snapshots (
      ticker, close_time, snapshot_kind, decision_at,
      secs_left, quote_age_s, quote_seq, print_age_s, quote_last_change_at,
      chair_lean, chair_confidence, chair_score, chair_bar, chair_sit_mass, chair_hard_fail,
      chair_quorum_up, chair_quorum_down, chair_quorum_wait, chair_size,
      chair_gates, chair_hypothesis, chair_evidence, chair_counter, chair_decision, chair_invalidate_if,
      spot, spot_source, strike,
      yes_bid, yes_ask, no_bid, no_ask, yes_bid_size, no_bid_size,
      kalshi_taker_yes, kalshi_trade_n,
      fair_yes, lab_fair_yes, yes_mid, spread_cents, combined_ask_cents, leftover_cents,
      edge_up, edge_down, fee_yes, fee_no,
      regime_key, clock_key, atr, imbalance, range_pos,
      research_version
    ) values (
      ${row.ticker}, ${new Date(row.close_time_ms).toISOString()}, ${kind},
      ${new Date(row.decision_at_ms).toISOString()},
      ${row.secs_left}, ${row.quote_age_s}, ${row.quote_seq}, ${row.print_age_s},
      ${row.quote_last_change_ms == null ? null : new Date(row.quote_last_change_ms).toISOString()},
      ${row.chair_lean}, ${row.chair_confidence}, ${row.chair_score}, ${row.chair_bar},
      ${row.chair_sit_mass}, ${row.chair_hard_fail},
      ${row.chair_quorum_up}, ${row.chair_quorum_down}, ${row.chair_quorum_wait}, ${row.chair_size},
      ${JSON.stringify(row.chair_gates ?? [])}::jsonb, ${row.chair_hypothesis},
      ${JSON.stringify(row.chair_evidence ?? [])}::jsonb, ${row.chair_counter},
      ${row.chair_decision}, ${row.chair_invalidate_if},
      ${row.spot}, ${row.spot_source}, ${row.strike},
      ${row.yes_bid}, ${row.yes_ask}, ${row.no_bid}, ${row.no_ask},
      ${row.yes_bid_size}, ${row.no_bid_size},
      ${row.kalshi_taker_yes}, ${row.kalshi_trade_n},
      ${row.fair_yes}, ${row.lab_fair_yes}, ${row.yes_mid}, ${row.spread_cents},
      ${row.combined_ask_cents}, ${row.leftover_cents},
      ${row.edge_up}, ${row.edge_down}, ${row.fee_yes}, ${row.fee_no},
      ${row.regime_key}, ${row.clock_key}, ${row.atr}, ${row.imbalance}, ${row.range_pos},
      ${DECISION_RESEARCH_VERSION}
    )
    on conflict (ticker, close_time, snapshot_kind) do nothing
  `;
}

/**
 * Persist this tick's decision snapshot, if it is one of the two bounded events.
 *
 * Takes FACTS already captured from the finalized `(snap, chair)` pair, never a
 * live object and never a promise to re-read. Returns void: the shadow cannot
 * steer anything because there is nothing to steer on.
 */
export async function recordDecisionSnapshot(row: DecisionSnapshotRow): Promise<void> {
  if (!row.ticker || !Number.isFinite(row.close_time_ms) || row.close_time_ms <= 0) return;
  // decision_at feeds a toISOString that THROWS on a non-finite value; that throw
  // would land in the silent catch below and lose the row without a trace, so it
  // is refused up front.
  if (!Number.isFinite(row.decision_at_ms) || row.decision_at_ms <= 0) return;
  // Demo snapshots carry synthetic timestamps and must never enter a research table.
  if (row.ticker.includes("DEMO")) return;

  try {
    const db = await getSql();
    const key = memKey(row.ticker, row.close_time_ms);
    const closeIso = new Date(row.close_time_ms).toISOString();

    let state = mem.get(key);
    if (!state) {
      // First sight this process, or after a restart: the table is the authority
      // on what the opening read was. Probe the exact window once, then cache.
      state = await resolveWindow(db, row.ticker, closeIso);
      setMem(key, state);
    }

    const plan = decisionSnapshotEvents({
      openingExists: state.openingDone,
      openingLean: state.openingLean,
      firstDirectionalExists: state.firstDirectionalDone,
      currentLean: row.chair_lean,
    });

    if (plan.insertOpening) {
      await insertRow(db, row, "OPENING");
      // The persisted opening lean is the DATABASE's, which on a race or a restart
      // may not be this tick's. Read it back so FIRST_DIRECTIONAL keys off the
      // durable truth rather than what this tick happened to attempt.
      const back = await resolveWindow(db, row.ticker, closeIso);
      state.openingDone = back.openingDone;
      state.openingLean = back.openingLean;
      state.firstDirectionalDone = back.firstDirectionalDone;
    }

    if (plan.insertFirstDirectional) {
      await insertRow(db, row, "FIRST_DIRECTIONAL");
      state.firstDirectionalDone = true;
    }

    setMem(key, state);
  } catch {
    // Deliberately silent, and deliberately does NOT mark the window done: a
    // research write that can break a brain tick is worse than a missing row, and
    // a transient failure must leave the next tick free to retry.
  }
}

/**
 * Convenience for the engine: capture the finalized pair and fire the write.
 * Synchronous capture (so the row is this exact tick's), async non-blocking write.
 */
export function decisionSnapshotFrom(snap: Snapshot, chair: ChairResult): DecisionSnapshotRow {
  return buildDecisionSnapshotRow(snap, chair);
}
