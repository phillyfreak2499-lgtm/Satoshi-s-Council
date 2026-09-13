/**
 * Chamber PR 1 — server observer.
 *
 * observeChairWaitMilestone records one CHAIR_WAIT_MILESTONE after the Chair
 * has already decided. It never mutates the Chair result. Failures are
 * swallowed here so speech cannot take down the tick.
 *
 * No public POST. No write createServerFn.
 */
import { bookState, type BookState } from "./book-floor";
import { maybeChairWaitEvent } from "./chamber-wait";
import { recordSystemEvent } from "./system-events.server";
import type { RecordEventResult } from "./system-events";
import type { CallLogRow, ChairResult, Snapshot } from "./types";

function waitBook(snap: Snapshot, chair: ChairResult, callLog: CallLogRow[] = []): BookState {
  return bookState(snap, chair.lean, callLog);
}

/**
 * Observe a finalized (snap, chair) pair. Safe to void from the engine.
 * Duplicate event_key is a no-op via Phase 1A unique key.
 */
export async function observeChairWaitMilestone(
  snap: Snapshot,
  chair: ChairResult,
  callLog: CallLogRow[] = [],
): Promise<RecordEventResult | null> {
  if (String(snap.ticker ?? "").includes("DEMO")) return null;
  const input = maybeChairWaitEvent(chair, snap, waitBook(snap, chair, callLog));
  if (!input) return null;
  try {
    return await recordSystemEvent(input);
  } catch {
    return null;
  }
}
