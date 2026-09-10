/**
 * The side a paper call was actually booked on — the one honest label for a held
 * position — derived from its settlement, not from the chair's grade-frame lean.
 *
 * Why this exists: the ledger records `chair_lean` as the lean at the GRADE
 * frame, which can decay to WAIT even though the desk held a position to
 * settlement (one position per window, never flipped). So the booked side must
 * be recovered from the outcome: a booked contract pays 100¢ if its side won and
 * 0¢ if it lost, so the side is the winner when it settled at/above 50¢ and the
 * opposite when it settled below. Null when nothing was booked (settle unknown)
 * or the window is not yet graded.
 *
 * This is the SINGLE source of truth for that derivation. Every surface that
 * shows a booked call (BOOKS, GAVEL, the link-preview card, …) reads it here so
 * none of them can drift back to showing the grade-frame lean and mislabel a
 * held call — the bug that made a losing UP call read as "bought DOWN".
 */
export function bookedSideOf(
  settleCents: number | null | undefined,
  winner: "UP" | "DOWN" | null | undefined,
): "UP" | "DOWN" | null {
  if (settleCents == null || (winner !== "UP" && winner !== "DOWN")) return null;
  return settleCents >= 50 ? winner : winner === "UP" ? "DOWN" : "UP";
}
