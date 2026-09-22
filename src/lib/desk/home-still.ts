/**
 * Proof the desk is alive under a WAIT: the last graded window, in one line.
 *
 * Pure. Takes the last graded window /books already computes and turns it
 * into a plain line. A missing window is a missing line, never a dash:
 * nothing here invents a fill or a window. Paper only. No authority.
 *
 * lastFilledFact skips sits: a long WAIT streak should still show the last
 * recorded paper fill so the floor does not look empty.
 */
import type { BooksWindow } from "./books.ts";
import { fmtCents, readStamp } from "./record.ts";

export type StillFact = { label: string; text: string; href: string };

function hrefOf(last: BooksWindow): string {
  return last.ticker ? `/window/${encodeURIComponent(last.ticker)}` : "/books";
}

/** "2026-09-18 22:45 UTC · sat · settled UP", linked to the window's replay (or /books without a ticker). */
export function lastWindowFact(last: BooksWindow | null | undefined): StillFact | null {
  if (!last || !Number.isFinite(Date.parse(last.close_time))) return null;
  if (last.winner !== "UP" && last.winner !== "DOWN") return null;
  const call = last.call;
  const position = !call
    ? "sat"
    : `paper ${call.lean ?? "position"} at ${call.entry.toFixed(0)}¢, ${call.ev == null ? "not yet graded" : `${fmtCents(call.ev)} after fee`}`;
  return {
    label: "Last window",
    text: `${readStamp(last.close_time)} · ${position} · settled ${last.winner}`,
    href: hrefOf(last),
  };
}

/** Same line, but only when that window booked a side. A sit returns null. */
export function lastFilledFact(last: BooksWindow | null | undefined): StillFact | null {
  if (!last?.call) return null;
  const fact = lastWindowFact(last);
  if (!fact) return null;
  return { ...fact, label: "Last paper fill" };
}

/**
 * Prefer a recorded fill when the most recent grade sat.
 * Falls back to the last window (sit included) so a first-time ledger still prints.
 */
export function preferFilledFact(
  last: BooksWindow | null | undefined,
  fill?: BooksWindow | null,
): StillFact | null {
  if (last?.call) return lastWindowFact(last);
  return lastFilledFact(fill) ?? lastWindowFact(last);
}
