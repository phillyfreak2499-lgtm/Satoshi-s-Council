/**
 * When a shadow arm observes a window and does not book, the pairing universe
 * still needs a row. A missing receipt is an outage, not a zero.
 *
 * NULL_FAV already writes no_fill at its T-5 fallback. The E1 package and the
 * E2/E3 streams that ride PKG_85 did not: a WAIT left the window absent, so
 * 14 NULL_FAV windows after 2026-09-22T04:22:47Z had no PKG/E2/E3 partner.
 *
 * The sit receipt is written once, at the frozen T-3 checkpoint (12 s grace,
 * same helper as NULL_FAV). Earlier ticks stay silent so a later eligible
 * tick can still fill. Production Chair, floor, and gates are untouched.
 */
import { scheduledCheckpoint } from "./shadow-arms.ts";

/** T-3: last moment the observer is still inside the 3-10 minute band. */
export const PACKAGE_SIT_SCHEDULE_SECS = Object.freeze([180] as const);

/**
 * True when this tick should persist a no_fill sit for an arm that has not
 * already recorded fill, intention, veto, or no_fill on the same window.
 */
export function shouldWriteSitReceipt(secsLeft: number, alreadyRecorded: boolean): boolean {
  if (alreadyRecorded) return false;
  return scheduledCheckpoint(secsLeft, PACKAGE_SIT_SCHEDULE_SECS) === 180;
}
