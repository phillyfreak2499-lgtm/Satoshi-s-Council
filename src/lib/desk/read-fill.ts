/**
 * Locked Chair-read vs paper-fill pair. Presentation only.
 * Does not book, grade, or change the Chair.
 */
import type { BookState } from "./book-floor.ts";
import type { Lean } from "./types.ts";

export const READ_FILL_TIP =
  "A read grades the seats. A fill is a booked paper position at the ask after fee. They can disagree.";

export type ReadFillPairFact = {
  read: string;
  fill: string;
  fillDetail: string;
};

export function readFillPair(lean: Lean | string | null | undefined, book: BookState | null | undefined): ReadFillPairFact {
  const read = lean === "UP" || lean === "DOWN" || lean === "WAIT" ? lean : "—";
  if (!book) return { read, fill: "—", fillDetail: "Connecting" };
  if (book.kind === "booked") {
    return {
      read,
      fill: `${book.lean} held`,
      fillDetail: `${book.cents.toFixed(0)}¢ entry`,
    };
  }
  return {
    read,
    fill: "no fill",
    fillDetail: "No recorded paper position in this window",
  };
}
