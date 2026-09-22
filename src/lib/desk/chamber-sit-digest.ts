/**
 * Presentation helper for a quiet Chamber.
 * Collapses consecutive SATOSHI WAIT dispatches into one digest line.
 * Does not write events, change the Chair, or alter the book.
 */

function utcClock(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  } catch {
    return value.slice(11, 16) || value;
  }
}

export function sitStreakLine(n: number): string {
  const count = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
  if (count <= 1) return "Sitting this window is the call.";
  return `The Chair has sat ${count} consecutive windows on this feed. Sitting this window is the call.`;
}

/** Compact header: Quiet · 4 windows · 12:15–13:00 UTC */
export function quietRangeLine(n: number, fromIso: string, toIso: string): string {
  const count = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
  const from = utcClock(fromIso);
  const to = utcClock(toIso);
  if (count <= 1) return `Quiet · 1 window · ${from} UTC`;
  return `Quiet · ${count} windows · ${from}–${to} UTC`;
}
