/**
 * The chair's paper book has a price floor.
 *
 * The chair's read (UP, DOWN or WAIT on the strip and the board) and a paper
 * fill are two different things. The ledger books a fill only at an ask of
 * CHAIR_MIN_ASK_CENTS or better. The record that set it, 52 graded calls
 * from Sep 5 to Sep 8 2026: the 20 booked under 70¢ won 4 and lost 280¢; the
 * 32 at 70¢ or better won 28 and made +202¢ after fees. A 15-minute window is
 * nearly decided by the time one side prints 70¢, and that is where the
 * seats' reads have earned their keep.
 *
 * Under the floor the read still shows, still grades the seats and the
 * chair's own hit rate, and still lands in the ledger as chair_lean with no
 * entry — so the floor can be revisited on data, not on memory. Nothing is
 * positioned, so a later tick at the floor can still fill the same window.
 */
import { markSide } from "./scalp";
import type { CallLogRow, Lean, Snapshot } from "./types";

export const CHAIR_MIN_ASK_CENTS = 70;

/**
 * When the floor went live: the merge that shipped it, 2026-09-08 20:47 UTC
 * (3:47 pm Chicago). The last fill under 70¢ closed at 19:45 UTC that day and
 * the first window booked under the floor closed at 22:00 UTC, so every window
 * closing from this moment on was played by the rule above. The books split
 * their record on it; nothing decides on it.
 */
export const CHAIR_FLOOR_SINCE_ISO = "2026-09-08T20:47:00.000Z";

/** A paper fill is allowed at this ask: at or above the floor, and a real price. */
export function bookable(cents: number): boolean {
  return Number.isFinite(cents) && cents >= CHAIR_MIN_ASK_CENTS && cents < 100;
}

export type BookState =
  /** No read and no position. */
  | { kind: "wait" }
  /** A position is held on this window, booked at `cents`; `ask` is that side's ask now. */
  | { kind: "booked"; lean: "UP" | "DOWN"; cents: number; ask: number }
  /** The chair leans a side but its ask sits under the floor: no paper fill. */
  | { kind: "floor"; lean: "UP" | "DOWN"; ask: number }
  /** The chair leans a side at or above the floor and the book has not filled yet (next tick books). */
  | { kind: "filling"; lean: "UP" | "DOWN"; ask: number };

function openRow(snap: Snapshot, callLog: CallLogRow[]): CallLogRow | null {
  return (
    callLog.find(
      (r) => r.settle == null && r.ticker === snap.ticker && Math.abs(r.close_time - snap.close_time) < 90_000,
    ) ?? null
  );
}

/** What the book is doing with the chair's read on this window. */
export function bookState(snap: Snapshot, lean: Lean, callLog: CallLogRow[]): BookState {
  const row = openRow(snap, callLog);
  if (row) return { kind: "booked", lean: row.lean, cents: row.cents, ask: markSide(snap, row.lean) };
  if (lean !== "UP" && lean !== "DOWN") return { kind: "wait" };
  const ask = markSide(snap, lean);
  return bookable(ask) ? { kind: "filling", lean, ask } : { kind: "floor", lean, ask };
}
