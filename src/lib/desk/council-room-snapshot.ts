/**
 * Council Room V1 — current-state snapshot, kept apart from recorded events.
 *
 * Pure. Allowlists the few fields the Chamber roster and the Phase 2 room show
 * from the existing public GET /frame body: seat availability and current read,
 * the Chair's current lean, the reported tick age and the window identity. A snapshot describes what the desk looks like at one
 * instant; it is never diffed into an "event" and never narrated as one.
 * Anything not live (demo source, missing time, unusable rows) is refused.
 */
import type { SeatAvailability } from "./council-public.ts";

export type SnapshotLean = "UP" | "DOWN" | "WAIT";

export type SnapshotSeat = SeatAvailability & {
  /** The seat's current read, only when the frame carries a known value. */
  lean?: SnapshotLean;
};

export type RosterSnapshot = {
  /** Server time the frame was read. */
  as_of: number;
  ticker: string;
  close_time: number | null;
  /** The Chair's current lean as reported by the frame; null when absent or unknown. */
  chair_lean: SnapshotLean | null;
  /** Seconds since the server desk last ticked, exactly as reported; null when absent. */
  tick_age_s: number | null;
  rows: SnapshotSeat[];
};

function leanOf(v: unknown): SnapshotLean | undefined {
  return v === "UP" || v === "DOWN" || v === "WAIT" ? v : undefined;
}

function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function parseRosterSnapshot(body: unknown): RosterSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const f = body as { ok?: unknown; as_of?: unknown; tick_age_s?: unknown; snap?: unknown; chair?: unknown; settings?: unknown };
  if (f.ok === false) return null;
  const asOf = finiteOrUndefined(f.as_of);
  const snap = f.snap && typeof f.snap === "object" ? (f.snap as { ticker?: unknown; close_time?: unknown }) : null;
  const ticker = typeof snap?.ticker === "string" ? snap.ticker.trim() : "";
  if (asOf == null || !snap || !ticker || ticker.includes("DEMO")) return null;
  const chair = f.chair && typeof f.chair === "object" ? (f.chair as { rows?: unknown; lean?: unknown }) : null;
  const raw = Array.isArray(chair?.rows) ? chair!.rows : [];
  const rows: SnapshotSeat[] = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (typeof row.seat !== "string" || !row.seat) continue;
    const lean = leanOf(row.lean);
    rows.push({
      seat: row.seat,
      selectable_live_cards: finiteOrUndefined(row.selectable_live_cards),
      authority_ready_cards: finiteOrUndefined(row.authority_ready_cards),
      authority_hold_reason: typeof row.authority_hold_reason === "string" ? row.authority_hold_reason.slice(0, 120) : undefined,
      ...(lean ? { lean } : {}),
    });
  }
  return {
    as_of: asOf,
    ticker,
    close_time: finiteOrUndefined(snap.close_time) ?? null,
    chair_lean: leanOf(chair?.lean) ?? null,
    tick_age_s: finiteOrUndefined(f.tick_age_s) ?? null,
    rows,
  };
}
