/**
 * Stillness with a scoreboard: the facts the homepage prints under a WAIT.
 *
 * Pure. Takes the last graded window and the books' last-7-days column,
 * both already computed for /books, and turns them into plain lines. A
 * missing input is a missing line, never a dash: nothing here invents a
 * fill, a window or a week. Paper only. No authority over anything.
 */
import type { BooksWindow } from "./books.ts";
import { fmtCents, readStamp, type BooksColumn } from "./record.ts";

export type StillFact = { id: "last" | "week"; label: string; text: string; href: string; link: string };

/** "2026-09-18 22:45 UTC · sat · settled UP", linked to the window's replay. */
export function lastWindowFact(last: BooksWindow | null | undefined): StillFact | null {
  if (!last || !last.ticker || !Number.isFinite(Date.parse(last.close_time))) return null;
  if (last.winner !== "UP" && last.winner !== "DOWN") return null;
  const call = last.call;
  const position = !call
    ? "sat"
    : `paper ${call.lean ?? "position"} at ${call.entry.toFixed(0)}¢, ${call.ev == null ? "not yet graded" : `${fmtCents(call.ev)} after fee`}`;
  return {
    id: "last",
    label: "Last window",
    text: `${readStamp(last.close_time)} · ${position} · settled ${last.winner}`,
    href: `/window/${encodeURIComponent(last.ticker)}`,
    link: "Open the window",
  };
}

/** "+230.0¢ paper · 54 of 60 fills won · needs 52%", from the books' own last-7-days column. */
export function weekFact(week: BooksColumn | null | undefined): StillFact | null {
  if (!week || !Number.isFinite(week.n) || week.n <= 0 || !Number.isFinite(week.calls) || !Number.isFinite(week.net)) return null;
  const windows = `${week.n} window${week.n === 1 ? "" : "s"}`;
  const text = week.calls > 0
    ? `${fmtCents(week.net)} paper · ${week.wins} of ${week.calls} fill${week.calls === 1 ? "" : "s"} won${week.breakeven != null && Number.isFinite(week.breakeven) ? ` · needs ${Math.round(week.breakeven)}%` : ""}`
    : `sat all ${windows} · no paper fills`;
  return { id: "week", label: "Last 7 days", text, href: "/books", link: "Read the record" };
}

/** The facts worth printing, in order. Empty when nothing is graded yet. */
export function stillFacts(last: BooksWindow | null | undefined, week: BooksColumn | null | undefined): StillFact[] {
  return [lastWindowFact(last), weekFact(week)].filter((fact): fact is StillFact => fact !== null);
}
