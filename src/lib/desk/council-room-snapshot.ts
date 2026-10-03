/**
 * Council Room V1 — current-state snapshot, kept apart from recorded events.
 *
 * Pure. Allowlists the few fields the Chamber roster shows from the existing
 * public GET /frame body. A snapshot describes what the desk looks like at one
 * instant; it is never diffed into an "event" and never narrated as one.
 * Anything not live (demo source, missing time, unusable rows) is refused.
 */
import type { SeatAvailability } from "./council-public.ts";

export type RosterSnapshot = {
  /** Server time the frame was read. */
  as_of: number;
  ticker: string;
  close_time: number | null;
  rows: SeatAvailability[];
};

function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function parseRosterSnapshot(body: unknown): RosterSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const f = body as { ok?: unknown; as_of?: unknown; snap?: unknown; chair?: unknown; settings?: unknown };
  if (f.ok === false) return null;
  const asOf = finiteOrUndefined(f.as_of);
  const snap = f.snap && typeof f.snap === "object" ? (f.snap as { ticker?: unknown; close_time?: unknown }) : null;
  const ticker = typeof snap?.ticker === "string" ? snap.ticker.trim() : "";
  if (asOf == null || !snap || !ticker || ticker.includes("DEMO")) return null;
  const chair = f.chair && typeof f.chair === "object" ? (f.chair as { rows?: unknown }) : null;
  const raw = Array.isArray(chair?.rows) ? chair!.rows : [];
  const rows: SeatAvailability[] = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (typeof row.seat !== "string" || !row.seat) continue;
    rows.push({
      seat: row.seat,
      selectable_live_cards: finiteOrUndefined(row.selectable_live_cards),
      authority_ready_cards: finiteOrUndefined(row.authority_ready_cards),
      authority_hold_reason: typeof row.authority_hold_reason === "string" ? row.authority_hold_reason.slice(0, 120) : undefined,
    });
  }
  return { as_of: asOf, ticker, close_time: finiteOrUndefined(snap.close_time) ?? null, rows };
}
