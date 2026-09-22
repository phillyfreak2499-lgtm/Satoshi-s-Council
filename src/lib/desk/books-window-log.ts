/**
 * Recent-windows log as a summary: sit runs collapse, fills stay open.
 *
 * Presentation only. Does not change totals, grading, or the ledger.
 */
import type { BooksWindow } from "./books.ts";

export type SitRun = {
  kind: "sit-run";
  count: number;
  from: string;
  to: string;
  windows: BooksWindow[];
};

export type FilledRow = {
  kind: "fill";
  window: BooksWindow;
};

export type WindowLogRow = SitRun | FilledRow;

export function isSit(w: BooksWindow): boolean {
  return w.call == null;
}

/** Collapse consecutive sits. Filled windows stay one row each, in the same order. */
export function collapseWindowLog(windows: readonly BooksWindow[]): WindowLogRow[] {
  const out: WindowLogRow[] = [];
  let run: BooksWindow[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push({
      kind: "sit-run",
      count: run.length,
      from: run[0]!.close_time,
      to: run[run.length - 1]!.close_time,
      windows: run,
    });
    run = [];
  };
  for (const w of windows) {
    if (isSit(w)) {
      run.push(w);
      continue;
    }
    flush();
    out.push({ kind: "fill", window: w });
  }
  flush();
  return out;
}

export function sitRunLabel(row: SitRun): string {
  const n = row.count;
  return n === 1 ? "sat out · 1 window" : `sat out · ${n} windows`;
}

/** Chicago-stable close stamp with a calendar date, so missing closes are dated. */
export function datedClose(iso: string, tz = "America/Chicago"): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}
