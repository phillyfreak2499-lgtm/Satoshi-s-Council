/**
 * S2-5 decision-snapshot WRITER — server adapter (Postgres-backed). Measurement
 * only, structurally so.
 *
 * The orchestration (per-window serialization, the frozen first-captured row,
 * retry, restart read-back) lives in the pure decision-snapshot-writer.ts; this
 * file is only the durable store behind it: the exact-window lookup and the
 * idempotent insert. One public write, `recordDecisionSnapshot`, which returns
 * the writer's promise so the engine's outer `.catch` can OBSERVE a failure and
 * route it to noteErr — the write no longer swallows its own errors. A research
 * write that rejects still never throws into the tick, because the engine voids
 * it with a `.catch`; but a rejection is now visible, and the window is not
 * marked done, so the next tick retries the same frozen row.
 *
 * No seat, DSL rule, threshold, Chair input, learned weight or skill imports this;
 * the data goes one way, into desk_decision_snapshots. It never re-reads the
 * market, a fill, a grade, or a replay to populate a row.
 */
import { getSql } from "@/lib/db";
import {
  buildDecisionSnapshotRow,
  DECISION_RESEARCH_VERSION,
  type DecisionSnapshotRow,
  type SnapshotKind,
} from "./decision-snapshot.ts";
import { createDecisionWriter, type PersistedWindow } from "./decision-snapshot-writer.ts";
import type { ChairResult, Lean, Snapshot } from "./types";

export { buildDecisionSnapshotRow, DECISION_RESEARCH_VERSION };

/**
 * Read the exact window's persisted state back. EXACT window only -- `ticker` AND
 * `close_time` -- never ticker alone and never a nearest-close fallback, so one
 * window's reads can never be resolved from another's.
 */
async function lookupWindow(ticker: string, closeMs: number): Promise<PersistedWindow> {
  const db = await getSql();
  const closeIso = new Date(closeMs).toISOString();
  const rows = await db<{ snapshot_kind: string; chair_lean: string }>`
    select snapshot_kind, chair_lean
      from desk_decision_snapshots
     where ticker = ${ticker} and close_time = ${closeIso}
  `;
  const out: PersistedWindow = { openingExists: false, openingLean: null, firstDirectionalExists: false };
  for (const r of rows) {
    if (r.snapshot_kind === "OPENING") {
      out.openingExists = true;
      out.openingLean = r.chair_lean as Lean;
    } else if (r.snapshot_kind === "FIRST_DIRECTIONAL") {
      out.firstDirectionalExists = true;
    }
  }
  return out;
}

async function insertSnapshot(row: DecisionSnapshotRow, kind: SnapshotKind): Promise<void> {
  const db = await getSql();
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
      higher_context, research_version
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
      ${row.higher_context == null ? null : JSON.stringify(row.higher_context)}::jsonb,
      ${DECISION_RESEARCH_VERSION}
    )
    on conflict (ticker, close_time, snapshot_kind) do nothing
  `;
}

const writer = createDecisionWriter({ lookupWindow, insertSnapshot });

/**
 * Persist this tick's decision snapshot, if it is one of the two bounded events.
 * Takes FACTS already captured from the finalized `(snap, chair)` pair. Returns
 * the writer's promise so a failure is observable to the caller; it rejects on a
 * store failure and never swallows.
 */
export function recordDecisionSnapshot(row: DecisionSnapshotRow): Promise<void> {
  return writer.record(row);
}

/** Test/operational reset of per-window memory. Not wired into the engine. */
export function __resetDecisionMem(): void {
  writer.reset();
}

/** Capture the finalized pair into a flat row, synchronously, on the decision tick. */
export function decisionSnapshotFrom(snap: Snapshot, chair: ChairResult): DecisionSnapshotRow {
  return buildDecisionSnapshotRow(snap, chair);
}
