/**
 * Proof the desk is alive under a WAIT: the last graded window, in one line.
 *
 * Pure. Takes the last graded window /books already computes and turns it
 * into a plain line. A missing window is a missing line, never a dash:
 * nothing here invents a fill or a window. Paper only. No authority.
 */
import type { BooksWindow } from "./books.ts";
import { fmtCents, readStamp } from "./record.ts";

export type StillFact = { label: string; text: string; href: string };

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
    href: last.ticker ? `/window/${encodeURIComponent(last.ticker)}` : "/books",
  };
}
