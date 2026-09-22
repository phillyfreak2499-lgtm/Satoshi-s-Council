/**
 * Last recorded paper call, as a floor line.
 *
 * Presentation only. Reads a graded BooksWindow the books already computed.
 * Does not invent a fill, change the Chair, or touch the book.
 */
import type { BooksWindow } from "./books.ts";

export const WINDOW_MS = 15 * 60 * 1000;

export type LastCallLine = {
  label: string;
  text: string;
  href: string;
  replayHref: string | null;
  windowsAgo: number | null;
};

function hrefOf(w: BooksWindow): string {
  return w.ticker ? `/window/${encodeURIComponent(w.ticker)}` : "/books";
}

function fmtCents(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}¢`;
}

function readStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "an unknown minute";
}

/** How many 15-minute windows sit between the fill and the latest grade (or now). */
export function windowsAgo(fillClose: string, fromClose?: string | null): number | null {
  const fill = Date.parse(fillClose);
  const from = fromClose ? Date.parse(fromClose) : Date.now();
  if (!Number.isFinite(fill) || !Number.isFinite(from)) return null;
  return Math.max(0, Math.round((from - fill) / WINDOW_MS));
}

/** One filled window as "Last call: date · side · result · net — N windows ago". */
export function lastCallLine(
  fill: BooksWindow | null | undefined,
  latest?: BooksWindow | null,
): LastCallLine | null {
  if (!fill?.call) return null;
  if (fill.winner !== "UP" && fill.winner !== "DOWN") return null;
  if (!Number.isFinite(Date.parse(fill.close_time))) return null;
  const side = fill.call.lean ?? "position";
  const net = fill.call.ev == null ? "not yet graded" : fmtCents(fill.call.ev);
  const ago = windowsAgo(fill.close_time, latest?.close_time ?? fill.close_time);
  const agoText = ago == null ? "" : ` — ${ago} ${ago === 1 ? "window" : "windows"} ago`;
  return {
    label: "Last call",
    text: `${readStamp(fill.close_time)} · ${side} · settled ${fill.winner} · ${net}${agoText}`,
    href: hrefOf(fill),
    replayHref: fill.ticker ? hrefOf(fill) : null,
    windowsAgo: ago,
  };
}
