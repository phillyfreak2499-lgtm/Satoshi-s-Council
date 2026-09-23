import { EVIDENCE_OF } from "./seats.ts";
import type { ChairResult, SeatId, SeatRow } from "./types";

/**
 * Return the distinct Chair rows that are allowed to supply entry support.
 *
 * Keep this predicate in one place: admission, its audit, and the diagnostic
 * gate vector must never disagree about who has authority.  The first row for
 * a seat wins so malformed/legacy duplicate output cannot manufacture votes,
 * while the input order remains the Chair's display order.
 */
export function eligibleSupportRows(
  chair: Pick<ChairResult, "rows">,
  side: "UP" | "DOWN",
): SeatRow[] {
  const seen = new Set<SeatId>();
  return chair.rows.filter((row) => {
    if (seen.has(row.seat)) return false;
    seen.add(row.seat);
    return row.lean === side &&
      row.health === "LIVE" &&
      !row.folded &&
      !row.forced_sit &&
      (row.status === "LIVE" || row.status === "FADED") &&
      EVIDENCE_OF[row.seat] !== "context" &&
      typeof row.weight === "number" &&
      Number.isFinite(row.weight) &&
      row.weight > 0;
  });
}
