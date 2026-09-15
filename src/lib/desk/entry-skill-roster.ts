/** Immutable research receipt for the exact tick that booked a paper position. */
import type { ChairResult, Snapshot, Vote } from "./types";

export const ENTRY_SKILL_ROSTER_VERSION = "ENTRY_SKILL_ROSTER_V1";

export type EntrySkillRoster = {
  version: typeof ENTRY_SKILL_ROSTER_VERSION;
  scope: "booked_paper_entry";
  confidence_kind: "signal_strength_not_calibrated_probability";
  ticker: string;
  close_time_ms: number;
  entry_at_ms: number;
  side: "UP" | "DOWN";
  ask_cents: number;
  fee_cents: number;
  quote_age_s: number | null;
  quote_seq: number | null;
  regime: string;
  build_sha: string;
  chair_rows: { seat: string; skill_used: string; lean: string; status: string; contribution: number | null }[];
  seat_reads: { seat: string; selected_skill: string; selected_status: string; lean: string; confidence: number | null; raw_lean: string; raw_confidence: number | null; forced_sit: boolean; paper: { id: string; status: string; lean: string; confidence: number | null }[] }[];
};

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Receives this tick's votes explicitly. The engine's lastVotes are from the previous tick. */
export function captureEntrySkillRoster(
  snap: Snapshot, chair: ChairResult, votes: readonly Vote[], cents: number, fee: number, buildSha: string,
): EntrySkillRoster | null {
  if (chair.lean !== "UP" && chair.lean !== "DOWN") return null;
  return {
    version: ENTRY_SKILL_ROSTER_VERSION, scope: "booked_paper_entry",
    confidence_kind: "signal_strength_not_calibrated_probability",
    ticker: snap.ticker, close_time_ms: snap.close_time, entry_at_ms: snap.as_of,
    side: chair.lean, ask_cents: cents, fee_cents: fee,
    quote_age_s: snap.quote_ts > 0 ? numberOrNull(snap.quote_age_s) : null,
    quote_seq: snap.quote_seq > 0 ? snap.quote_seq : null,
    regime: snap.regime_key ?? "", build_sha: buildSha,
    chair_rows: chair.rows.map(r => ({ seat: r.seat, skill_used: r.skill_used, lean: r.lean,
      status: r.status, contribution: numberOrNull(r.contribution) })),
    seat_reads: votes.map(v => ({ seat: v.seat, selected_skill: v.skill_used,
      selected_status: v.skill_status, lean: v.lean, confidence: numberOrNull(v.confidence),
      raw_lean: v.raw_lean ?? v.lean, raw_confidence: numberOrNull(v.raw_conf ?? v.confidence),
      forced_sit: v.forced_sit === true,
      paper: (v.paper ?? []).map(p => ({ id: p.id, status: p.status, lean: p.lean,
        confidence: numberOrNull(p.confidence) })) })),
  };
}

/** Old queued rows (41 or 42 columns) never acquire a fabricated receipt. */
export function withEntrySkillRosterColumn(values: unknown[]): unknown[] {
  return values.length === 42 ? [...values, null] : values;
}
