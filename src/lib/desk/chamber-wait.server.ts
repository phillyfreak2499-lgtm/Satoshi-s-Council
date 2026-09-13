/**
 * Chamber server observer.
 *
 * One already-finalized (snap, chair) pair can produce display-only system events:
 * - SATOSHI: a real paper-book directional call or Chair WAIT milestone;
 * - WARDEN: a real Kalshi feed-health transition;
 * - ALCHEMIST: sparse milestones from the already-persisted prospective policy Lab.
 *
 * Nothing here mutates Snapshot, Chair, gates, seats, learner, paper book, or Lab.
 * Failures are contained so the Chamber can never take down the tick.
 * No public POST. No write createServerFn.
 */
import { bookState, type BookState } from "./book-floor";
import { maybeChairDirectionalEvent } from "./chamber-directional";
import { maybeWardenHealthEvent, type WardenFeedState } from "./chamber-health";
import { currentLabExperimentEvents } from "./chamber-lab.server";
import { maybeChairWaitEvent } from "./chamber-wait";
import { recordSystemEvent } from "./system-events.server";
import type { RecordEventResult, SystemEventInput } from "./system-events";
import type { CallLogRow, ChairResult, Snapshot } from "./types";

let kalshiFeedState: WardenFeedState = null;
let lastLabPollMs = 0;
const seenLabEventKeys = new Set<string>();
const LAB_POLL_MS = 60_000;

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

async function observeLabMilestones(nowMs: number): Promise<void> {
  if (nowMs - lastLabPollMs < LAB_POLL_MS) return;
  lastLabPollMs = nowMs;
  try {
    const events = await currentLabExperimentEvents();
    for (const input of events) {
      if (seenLabEventKeys.has(input.event_key)) continue;
      seenLabEventKeys.add(input.event_key);
      await safeRecord(input);
    }
  } catch {
    // Lab narration is optional display work. It must never affect a tick.
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
 * The process-local WARDEN state and Lab key set are chatter suppressors only;
 * database event_key uniqueness remains the correctness/idempotency backstop.
 */
export async function observeChairWaitMilestone(
  snap: Snapshot,
  chair: ChairResult,
  callLog: CallLogRow[] = [],
): Promise<RecordEventResult | null> {
  if (String(snap.ticker ?? "").includes("DEMO")) return null;

  // Intentionally detached. Lab DB reads and narration never delay SATOSHI/WARDEN
  // or the engine call site, which already voids this observer.
  void observeLabMilestones(Number(snap.as_of) || Date.now()).catch(() => {});

  const health = maybeWardenHealthEvent(kalshiFeedState, snap);
  kalshiFeedState = health.state;
  const healthResult = await safeRecord(health.event);

  const directionalResult = await safeRecord(maybeChairDirectionalEvent(snap, callLog));

  const waitInput = maybeChairWaitEvent(chair, snap, waitBook(snap, chair, callLog));
  const waitResult = await safeRecord(waitInput);
  return waitResult ?? directionalResult ?? healthResult;
}
