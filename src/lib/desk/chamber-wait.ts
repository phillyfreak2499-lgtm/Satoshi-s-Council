/**
 * Chamber PR 1 — pure WAIT → CHAIR_WAIT_MILESTONE builder.
 *
 * Observes an already-finalized Chair result. Does not call runChair,
 * does not recompute a lean, does not touch the learner, Floor, or book.
 * whyFacts / plainLine are presentation of recorded fields only.
 */
import { plainLine } from "./chair-words.ts";
import { whyFacts } from "./floor-clarity.ts";
import type { BookState } from "./book-floor";
import type { SystemEventInput } from "./system-events";
import type { ChairResult, Snapshot } from "./types";

export const CHAIR_WAIT_PUBLIC = true;

/**
 * CHAIR_WAIT_MILESTONE is the first Chamber proof. Visibility is intentional:
 * the producer sets public=true for this family only. The table default stays
 * false — other event families must opt in the same way.
 */
export const CHAIR_WAIT_PUBLIC_REASON =
  "CHAIR_WAIT_MILESTONE is public so the first SATOSHI line can render. Schema default remains false.";

export function chairWaitEventKey(ticker: string, closeTime: number, waitReason: string): string {
  return `CHAIR_WAIT_MILESTONE:${ticker}:${closeTime}:${waitReason}`;
}

/**
 * Build one insert-once event from a finalized Chair WAIT, or null.
 *
 * Null when:
 *   - lean is not WAIT
 *   - whyFacts.wait_reason is empty
 *   - ticker / close_time are unusable
 *   - ticker is a DEMO window
 *
 * The SATOSHI line is stored on the payload because reconstructing plainLine
 * later needs snap + book, which this event must not dump.
 */
export function maybeChairWaitEvent(
  chair: ChairResult,
  snap: Snapshot,
  book: BookState,
): SystemEventInput | null {
  if (chair.lean !== "WAIT") return null;
  const ticker = String(snap.ticker ?? "").trim();
  const closeTime = Number(snap.close_time);
  if (!ticker || !Number.isFinite(closeTime) || closeTime <= 0) return null;
  if (ticker.includes("DEMO")) return null;

  const why = whyFacts(chair, "");
  if (!why.wait_reason) return null;

  const text = plainLine(chair, snap, book);
  if (!text.trim()) return null;

  return {
    event_key: chairWaitEventKey(ticker, closeTime, why.wait_reason),
    event_type: "CHAIR_WAIT_MILESTONE",
    character: "SATOSHI",
    occurred_at: snap.as_of > 0 ? new Date(snap.as_of).toISOString() : new Date(closeTime).toISOString(),
    source_type: "window",
    source_id: `${ticker}:${closeTime}`,
    public: CHAIR_WAIT_PUBLIC,
    payload: {
      wait_reason: why.wait_reason,
      ticker,
      close_time: closeTime,
      text,
      quorum: why.quorum,
      score: chair.score,
      bar: chair.bar,
      failed_hard: why.failed_hard.map((g) => g.id),
    },
  };
}
