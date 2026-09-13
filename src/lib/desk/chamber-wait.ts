/**
 * Chamber PR 1 — pure CHAIR_WAIT_MILESTONE builder.
 *
 * Observes an already-decided Chair result. Does not call runChair,
 * does not recompute gates, does not mutate the Chair result.
 *
 * public=true is INTENTIONAL for this event family only, so the first
 * SATOSHI Chamber proof is visible. The table default remains false.
 */
import { plainLine } from "./chair-words.ts";
import { whyFacts } from "./floor-clarity.ts";
import type { BookState } from "./book-floor.ts";
import type { ChairResult, Snapshot } from "./types.ts";
import type { SystemEventInput } from "./system-events.ts";

export const CHAIR_WAIT_EVENT_TYPE = "CHAIR_WAIT_MILESTONE" as const;

/** Intentional: this family is the first public Chamber proof. Schema default stays false. */
export const CHAIR_WAIT_IS_PUBLIC = true;

export const CHAIR_WAIT_REASONS = ["feed-condition", "hard-gate", "under-bar", "no-edge"] as const;
export type ChairWaitReason = (typeof CHAIR_WAIT_REASONS)[number];

const REASON_SET = new Set<string>(CHAIR_WAIT_REASONS);

function keyPart(raw: unknown, max = 80): string {
  return String(raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function isChairWaitReason(v: string): v is ChairWaitReason {
  return REASON_SET.has(v);
}

export function chairWaitEventKey(ticker: string, closeTime: number, reason: string): string {
  const t = keyPart(ticker, 80);
  const c = keyPart(String(Math.round(Number(closeTime) || 0)), 20);
  const r = keyPart(reason, 24);
  return `CHAIR_WAIT_MILESTONE:${t}:${c}:${r}`;
}

export type ChairWaitEvidence = {
  wait_reason: ChairWaitReason;
  ticker: string;
  close_time: number;
  plain: string;
  quorum_up: number;
  quorum_down: number;
  quorum_wait: number;
  failed_hard: string[];
  score: number;
  bar: number;
};

/** Build the event, or null when this tick is not a WAIT milestone. */
export function maybeChairWaitEvent(
  chair: ChairResult | null | undefined,
  snap: Snapshot | null | undefined,
  book: BookState = { kind: "wait" },
): SystemEventInput | null {
  if (!chair || !snap) return null;
  if (chair.lean !== "WAIT") return null;
  const ticker = String(snap.ticker ?? "").trim();
  const closeTime = Number(snap.close_time);
  if (!ticker || !Number.isFinite(closeTime) || closeTime <= 0) return null;

  const plain = plainLine(chair, snap, book);
  const why = whyFacts(chair, plain);
  if (!isChairWaitReason(why.wait_reason)) return null;

  const payload: ChairWaitEvidence = {
    wait_reason: why.wait_reason,
    ticker,
    close_time: closeTime,
    plain,
    quorum_up: why.quorum.up,
    quorum_down: why.quorum.down,
    quorum_wait: why.quorum.wait,
    failed_hard: why.failed_hard.map((g) => g.id),
    score: Number(chair.score) || 0,
    bar: Number(chair.bar) || 0,
  };

  return {
    event_key: chairWaitEventKey(ticker, closeTime, why.wait_reason),
    event_type: CHAIR_WAIT_EVENT_TYPE,
    character: "SATOSHI",
    occurred_at: snap.as_of > 0 ? snap.as_of : Date.now(),
    source_type: "window",
    source_id: `${ticker}:${closeTime}`,
    payload,
    public: CHAIR_WAIT_IS_PUBLIC,
  };
}
