/**
 * Canonical readers for Kalshi wire payloads (pure).
 *
 * Two fields on a public trade say which way it went, and they are not
 * equally current. `taker_outcome_side` is the canonical field on today's
 * REST and websocket APIs; `taker_side` is the deprecated predecessor. A
 * parser that reads only the legacy field goes blind the day Kalshi drops
 * it, and a parser that prefers the legacy field reads the wrong one while
 * both are present. So direction is read here, canonical first, with the
 * legacy name kept purely as a fallback — and a payload carrying neither
 * returns null rather than a guess, because an unknown aggressor must not
 * be silently counted as a YES buyer.
 *
 * `taker_book_side` ("bid" / "ask") says which side of the book was resting
 * and is NOT the aggressor's outcome side. It is read separately and never
 * used to infer direction.
 *
 * Times are read the same way: a message carries the exchange's own event
 * time and we observe it some milliseconds later. Substituting receipt time
 * for event time quietly turns feed lag into zero lag, so both are kept and
 * the gap between them is telemetry.
 */

/** Milliseconds from a Kalshi timestamp field: ms, seconds, or an ISO string. 0 when unreadable. */
export function wireMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n;
    const p = Date.parse(v);
    if (Number.isFinite(p)) return p;
  }
  return 0;
}

/**
 * The taker's outcome side: which contract the aggressor bought.
 * Canonical `taker_outcome_side` wins; `taker_side` is the legacy fallback.
 * Null when the payload says neither — never inferred from price or book side.
 */
export function takerOutcomeSide(msg: Record<string, unknown>): "yes" | "no" | null {
  for (const key of ["taker_outcome_side", "taker_side"]) {
    const raw = msg[key];
    if (typeof raw !== "string") continue;
    const s = raw.trim().toLowerCase();
    if (s === "yes" || s === "no") return s;
  }
  return null;
}

/** True when the canonical direction field is absent, so WARDEN can see the feed drifting. */
export function missingCanonicalSide(msg: Record<string, unknown>): boolean {
  const raw = msg.taker_outcome_side;
  if (typeof raw !== "string") return true;
  const s = raw.trim().toLowerCase();
  return s !== "yes" && s !== "no";
}

/** Which side of the resting book was hit. Context only — never a direction. */
export function takerBookSide(msg: Record<string, unknown>): "bid" | "ask" | null {
  const raw = msg.taker_book_side;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return s === "bid" || s === "ask" ? s : null;
}

/** The exchange's own event time for a trade, in ms. 0 when the payload carries none. */
export function tradeSourceMs(msg: Record<string, unknown>): number {
  return wireMs(msg.ts_ms) || wireMs(msg.ts) || wireMs(msg.created_time) || 0;
}

/**
 * How stale a message was when it reached us, in ms: receipt minus event time.
 * Null when the payload carried no event time (so nothing is claimed), and
 * clamped at zero because a negative lag means clock skew, not time travel.
 */
export function sourceLagMs(sourceMs: number, receiptMs: number): number | null {
  if (!(sourceMs > 0) || !(receiptMs > 0)) return null;
  return Math.max(0, receiptMs - sourceMs);
}
