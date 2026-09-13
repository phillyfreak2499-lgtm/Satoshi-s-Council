/**
 * Chamber directional-call observer.
 *
 * A CallLogRow exists only after the paper book has actually recorded a call.
 * This module turns that already-recorded fact into a display-only SATOSHI event.
 * It does not decide a side, price, eligibility, or whether a fill should happen.
 */
import type { SystemEventInput } from "./system-events.ts";
import type { CallLogRow, Snapshot } from "./types.ts";

function currentPaperCall(snap: Snapshot, callLog: readonly CallLogRow[]): CallLogRow | null {
  const ticker = String(snap.ticker ?? "").trim();
  const close = Number(snap.close_time);
  if (!ticker || ticker.includes("DEMO") || !Number.isFinite(close) || close <= 0) return null;
  return callLog.find((row) => row.ticker === ticker && Number(row.close_time) === close) ?? null;
}

export function maybeChairDirectionalEvent(
  snap: Snapshot,
  callLog: readonly CallLogRow[] = [],
): SystemEventInput | null {
  const row = currentPaperCall(snap, callLog);
  if (!row) return null;
  if (row.lean !== "UP" && row.lean !== "DOWN") return null;
  const cents = Number(row.cents);
  if (!Number.isFinite(cents) || cents <= 0 || cents >= 100) return null;
  const t = Number(row.t);
  const occurred = Number.isFinite(t) && t > 0 ? t : snap.as_of;
  const text = `${row.lean} is on the paper book at ${cents}¢. The position stays paper-only.`;

  return {
    event_key: `CHAIR_DIRECTIONAL:${row.ticker}:${row.close_time}`,
    event_type: "CHAIR_DIRECTIONAL",
    character: "SATOSHI",
    occurred_at: occurred,
    source_type: "window",
    source_id: `${row.ticker}:${row.close_time}`,
    public: true,
    payload: {
      ticker: row.ticker,
      close_time: row.close_time,
      lean: row.lean,
      entry_cents: cents,
      call_id: row.id,
      text,
    },
  };
}
