/**
 * The economics of one call, in one place.
 *
 * WHY THIS EXISTS. "The chair likes UP" and "the book can pay for UP" are
 * different claims, and the floor means the second one fails constantly. Reading
 * the strip it was possible to see a confident UP and no fill and have no way to
 * tell why: was the ask under the floor, was the spread eating the edge, was
 * there any size at the touch to fill against? Those numbers all existed — on
 * the snapshot, in the frame — and none of them were shown together.
 *
 * THE ONE RULE. This module computes nothing the desk has not already computed.
 * Fair value, the fee, the leftover, the ask, the sizes: every field is carried
 * from the snapshot the engine built, not recalculated here. A second
 * implementation of the fee or of fair value would be a second answer, and on a
 * page whose whole point is honesty a second answer is worse than no answer. The
 * only work this file does is PICKING THE SIDE — which ask, which fee — and
 * asking the floor, through the same `bookable` that gates the real fill.
 *
 * A test asserts field-by-field that every number here is identical to the
 * snapshot's own, so a future edit cannot quietly start deriving one.
 */
import { FLOOR_LIVE_CENTS, bookable } from "./book-floor.ts";
import { markSide } from "./scalp.ts";
import type { Lean, Snapshot } from "./types";

export type Economics = {
  /** The side being priced, or null when the chair is not leaning. */
  side: "UP" | "DOWN" | null;
  /** Fair value for THIS side in cents — the desk's own Phi(d/sigma), carried over. */
  fair: number;
  /** What this side costs now. */
  ask: number;
  /** The Kalshi taker fee at that price, as the engine already worked it out. */
  fee: number;
  /** 100 − (yes ask + no ask): what the two legs leave on the table. */
  leftover: number;
  /** The live floor, read from the constant that gates the real fill. */
  floor: number;
  /** Would the book pay this ask? The same predicate the book uses, not a copy. */
  bookable: boolean;
  /** Resting size on the side a fill would have to take. 0 means nothing to hit. */
  touch: number;
  /** fair − ask − fee: the edge the desk claims on this side, after the fee. */
  edge: number;
  /** (ask + fee), the win rate this price needs to stand still, in percent. */
  breakeven: number;
  /**
   * What stands between the read and a real fill, in plain words. Null when
   * nothing does. This can be set while `bookable` is true: the paper book pays
   * any ask at the floor, but an ask with nothing resting behind it is not a fill
   * the desk should claim it could have had, and the box says both things rather
   * than quietly picking one.
   */
  why: string | null;
};

/**
 * Assemble the box. `lean` is the chair's read; everything else is read off the
 * snapshot the engine already enriched.
 */
export function economicsOf(snap: Snapshot, lean: Lean): Economics {
  const side = lean === "UP" || lean === "DOWN" ? lean : null;
  const up = side === "UP";
  // Fair for the side: the snapshot stores YES fair, and a binary's NO fair is
  // its complement by definition, not by a second model.
  const fair = side == null ? snap.fair_yes : up ? snap.fair_yes : 100 - snap.fair_yes;
  const ask = side == null ? 0 : markSide(snap, side);
  const fee = side == null ? 0 : up ? snap.fee_yes : snap.fee_no;
  // The edge the engine published for this side, carried not recomputed.
  const edge = side == null ? 0 : up ? snap.edge_up : snap.edge_down;
  // A fill on UP takes the YES ask, which rests against YES-side size.
  const touch = side == null ? 0 : up ? snap.yes_bid_size : snap.no_bid_size;
  const ok = side != null && bookable(ask);
  return {
    side,
    fair: r1(fair),
    ask: r1(ask),
    fee: r1(fee),
    leftover: r1(snap.leftover_cents),
    floor: FLOOR_LIVE_CENTS,
    bookable: ok,
    touch,
    edge: r1(edge),
    breakeven: r1(ask > 0 ? ask + fee : 0),
    why: whyNot(side, ask, ok, touch),
  };
}

/**
 * Say what is in the way, in the order it matters. The last case is the one the
 * floor cannot see: the book's gate is a price test, so an ask at the floor with
 * an empty touch passes it. That is reported as a caveat beside a true
 * `bookable`, never by overriding the book's own verdict — the box must say what
 * the book would do, not what it ought to do.
 */
function whyNot(side: "UP" | "DOWN" | null, ask: number, ok: boolean, touch: number): string | null {
  if (side == null) return "no read — the chair is not leaning";
  if (!(ask > 0) || ask >= 100) return "no real price on this side";
  if (!ok) return `${r1(ask)}¢ is under the ${FLOOR_LIVE_CENTS}¢ floor`;
  if (touch <= 0) return "at the floor, but nothing resting at the touch";
  return null;
}

function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
