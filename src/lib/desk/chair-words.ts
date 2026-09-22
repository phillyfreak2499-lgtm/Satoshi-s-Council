/**
 * One plain sentence on what the chair is doing and why, for the board under
 * the call. Pure: reads the chair's tally and gates, the snapshot's asks and
 * the book's state, and never invents a reason the code did not have.
 */
import type { ChairResult, Snapshot } from "./types";
import { CHAIR_MIN_ASK_CENTS, type BookState } from "./book-floor.ts";

const seats = (n: number) => `${n} seat${n === 1 ? "" : "s"}`;
const sideOf = (lean: "UP" | "DOWN") => (lean === "UP" ? "YES" : "NO");

/** Deliberate sit. Used when the Chair waited on purpose, not because a feed failed. */
export const SIT_IS_THE_CALL = "The evidence does not clear the bar. Sitting this window is the call.";

export function plainLine(chair: ChairResult, snap: Snapshot, book: BookState): string {
  const up = chair.quorum?.up ?? 0;
  const down = chair.quorum?.down ?? 0;
  const lean = chair.lean;

  if (book.kind === "booked") {
    const agree = book.lean === "UP" ? up : down;
    const against = book.lean === "UP" ? down : up;
    const moved = lean !== book.lean ? " The read has moved since, but the position is held to settlement." : "";
    const at = Number.isFinite(snap.as_of) && snap.as_of > 0 ? new Date(snap.as_of).toISOString() : "MISSING";
    return `Paper entry: ${book.lean} at ${book.cents.toFixed(0)}¢. At observation ${at}, ${seats(agree)} agree with the held side and ${seats(against)} oppose it. Entry-time agreement: MISSING. The position is held to settlement.${moved}`;
  }

  if (lean === "UP" || lean === "DOWN") {
    const n = lean === "UP" ? up : down;
    const ask = book.kind === "floor" || book.kind === "filling" ? book.ask : lean === "UP" ? snap.yes_ask : snap.no_ask;
    if (book.kind === "floor") {
      return `${seats(n)} lean ${lean}, but ${sideOf(lean)} is ${ask.toFixed(0)}¢, under the ${CHAIR_MIN_ASK_CENTS}¢ floor, so nothing is booked.`;
    }
    const selective = chair.gates.find((g) => g.id === "selective");
    if (selective && !selective.pass) {
      return `${seats(n)} lean ${lean} and the Chair read stands, but the paper entry waits: ${selective.value}.`;
    }
    return `${seats(n)} lean ${lean} and ${sideOf(lean)} at ${ask.toFixed(0)}¢ clears the floor, so the book fills on the next tick.`;
  }

  if (up + down === 0) {
    return SIT_IS_THE_CALL;
  }
  const tally = `${seats(up)} lean UP and ${seats(down)} lean DOWN`;
  const fail = chair.gates.find((g) => g.hard && !g.pass);
  switch (fail?.id) {
    case "warden":
    case "semantic":
    case "seq":
    case "derivs":
      return `${tally}, but a feed cannot be trusted right now, so the desk waits.`;
    case "chalk":
      return `The book is chalk at ${Math.max(snap.yes_ask, snap.no_ask).toFixed(0)}¢, so there is nothing left to buy.`;
    case "leftover":
      return `${tally}, but the two asks do not add up to a real book, so the desk waits.`;
    case "quote":
      return `${tally}, but the Kalshi quote is stale, so the desk waits.`;
    case "early":
      return `${tally}. It is early in the window, so the desk lets the tape print first.`;
    case "late":
      return `${tally}, but the window is nearly over with nothing booked, so the desk waits for the next one.`;
    case "spread":
      return `${tally}, but the spread is too wide to pay, so the desk waits.`;
    case "quiet":
      return `${tally}, but the market is too quiet to move, so the bar is raised and the desk waits.`;
    case "top3":
      return `${tally}. The top seats disagree, so the desk waits.`;
    case "edge":
      return `${tally}, but neither ask leaves an edge after the fee, so the desk waits.`;
    case "law":
      return `${tally}, but the desk is in lockdown after a run of misses, so it waits.`;
    default:
      return `${tally}. The evidence does not clear the bar, so the desk waits. Sitting this window is the call.`;
  }
}
