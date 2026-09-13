/**
 * Chamber server observer.
 *
 * One already-finalized (snap, chair) pair can produce display-only system events:
 * - SATOSHI: a real paper-book directional call or Chair WAIT milestone;
 * - WARDEN: a real Kalshi feed-health transition.
 *
 * Nothing here mutates Snapshot, Chair, gates, seats, learner, or paper book.
 * Failures are contained so the Chamber can never take down the tick.
 * No public POST. No write createServerFn.
 */
import { bookState, type BookState } from "./book-floor";
import { maybeChairDirectionalEvent } from "./chamber-directional";
import { maybeWardenHealthEvent, type WardenFeedState } from "./chamber-health";
import { maybeChairWaitEvent } from "./chamber-wait";
import { recordSystemEvent } from "./system-events.server";
import type { RecordEventResult, SystemEventInput } from "./system-events";
import type { CallLogRow, ChairResult, Snapshot } from "./types";

let kalshiFeedState: WardenFeedState = null;

function waitBook(snap: Snapshot, chair: ChairResult, callLog: CallLogRow[] = []): BookState {
  return bookState(snap, chair.lean, callLog);
}

async function safeRecord(input: SystemEventInput | null): Promise<RecordEventResult | null> {
  if (!input) return null;
  try {
    return await recordSystemEvent(input);
  } catch {
    return null;
  }
}

/**
 * Observe a finalized (snap, chair) pair. Safe to void from the engine.
 * Duplicate event_key is a no-op via the Phase 1A unique key.
 *
 * Directional speech is sourced from callLog, so it can only appear after the
 * paper book has actually recorded a call. Because noteCall runs after this observer,
 * a fresh call becomes visible on the next tick; the observer never races ahead of it.
 *
 * The process-local WARDEN state is only a chatter suppressor. It is updated before
 * persistence so overlapping async observers cannot emit the same transition twice;
 * the database event_key remains the correctness/idempotency backstop.
 */
export async function observeChairWaitMilestone(
  snap: Snapshot,
  chair: ChairResult,
  callLog: CallLogRow[] = [],
): Promise<RecordEventResult | null> {
  if (String(snap.ticker ?? "").includes("DEMO")) return null;

  const health = maybeWardenHealthEvent(kalshiFeedState, snap);
  kalshiFeedState = health.state;
  const healthResult = await safeRecord(health.event);

  const directionalResult = await safeRecord(maybeChairDirectionalEvent(snap, callLog));

  const waitInput = maybeChairWaitEvent(chair, snap, waitBook(snap, chair, callLog));
  const waitResult = await safeRecord(waitInput);
  return waitResult ?? directionalResult ?? healthResult;
}
