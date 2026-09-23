/**
 * Independent-evidence accounting for paper admission.
 *
 * Chair same-side folding collapses correlated weight so one family cannot
 * dominate the score. That label is not a withdrawal of booking authority.
 * Admission still counts at most one authorized representative per evidence
 * family. Folded clones, uncalibrated rows, and ineligible statuses never
 * mint extra families or restore a seat that was not authorized before the
 * fold.
 *
 * Fold groups in chair.ts use evidenceOf(seat, snap) and may remap CASCADE
 * when the cascade feed is a proxy. Entry families use EVIDENCE_OF. Those
 * maps are not assumed identical.
 */
import { EVIDENCE_OF, type EvidenceFamily } from "./seats.ts";
import type { Lean, SeatId, SeatRow, SeatStatus } from "./types.ts";

/** Statuses that never carry booking authority, including a fold leftover. */
export const ENTRY_INELIGIBLE_STATUS: ReadonlySet<SeatStatus> = new Set([
  "MUTED",
  "VETO",
  "DOWN",
  "UNCALIBRATED",
  "FOLDED",
]);

export type SupportAccount = {
  seats: SeatId[];
  families: EvidenceFamily[];
  supporterCount: number;
  familyCount: number;
};

export type SupportInput = Pick<SeatRow, "seat" | "lean" | "health" | "status">;

/** A row that was allowed to speak for its family before any fold label. */
export function authorizedBeforeFold(row: SupportInput): boolean {
  if (row.health !== "LIVE") return false;
  if (row.status !== "LIVE" && row.status !== "FADED") return false;
  if (EVIDENCE_OF[row.seat] === "context") return false;
  return true;
}

/**
 * Deterministic family representative among members that were authorized
 * before status is rewritten to FOLDED. Loudest weight wins; seat id breaks
 * ties. Returns null when the group has no authorized member.
 */
export function pickAuthorizedRepresentative<T>(
  members: readonly T[],
  opts: {
    authorized: (member: T) => boolean;
    weight: (member: T) => number;
    seat: (member: T) => SeatId;
  },
): T | null {
  const eligible = members.filter(opts.authorized);
  if (!eligible.length) return null;
  return eligible.reduce((best, cur) => {
    const delta = Math.abs(opts.weight(cur)) - Math.abs(opts.weight(best));
    if (delta > 0) return cur;
    if (delta < 0) return best;
    return opts.seat(cur) < opts.seat(best) ? cur : best;
  });
}

function entryEligible(row: SupportInput, side: "UP" | "DOWN"): boolean {
  return (
    row.lean === side &&
    row.health === "LIVE" &&
    !ENTRY_INELIGIBLE_STATUS.has(row.status) &&
    EVIDENCE_OF[row.seat] !== "context"
  );
}

/**
 * Unique authorized seats on `side`, then unique evidence families those
 * seats represent. Duplicate seat rows are collapsed first. Same-family
 * clones that both remain LIVE still count as one family and do not add a
 * second independent family. They may still add a second supporter seat;
 * Chair folding is what keeps agreeing clones from staying LIVE.
 */
export function familySupport(rows: readonly SupportInput[], side: Lean): SupportAccount {
  if (side !== "UP" && side !== "DOWN") {
    return { seats: [], families: [], supporterCount: 0, familyCount: 0 };
  }
  const bySeat = new Map<SeatId, SupportInput>();
  const ordered = [...rows].sort((a, b) => a.seat.localeCompare(b.seat));
  for (const row of ordered) {
    if (!entryEligible(row, side)) continue;
    if (!bySeat.has(row.seat)) bySeat.set(row.seat, row);
  }
  const seats = [...bySeat.keys()].sort((a, b) => a.localeCompare(b));
  const families = [...new Set(seats.map((seat) => EVIDENCE_OF[seat]))].sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    seats,
    families,
    supporterCount: seats.length,
    familyCount: families.length,
  };
}
