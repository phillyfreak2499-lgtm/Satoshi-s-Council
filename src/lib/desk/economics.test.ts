import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR_LIVE_CENTS, bookable } from "./book-floor.ts";
import { economicsOf } from "./economics.ts";
import { markSide } from "./scalp.ts";
import type { Snapshot } from "./types";

/**
 * A snapshot carrying only the fields the box reads. Built deliberately with
 * values the box could NOT reconstruct — a fair value that is not Phi of
 * anything here, a fee that is not the real fee for the price — so that a test
 * comparing the box against these fields proves it carried them rather than
 * recomputed them and happened to agree.
 */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    yes_ask: 82,
    no_ask: 21,
    yes_mid: 80,
    fair_yes: 77.4,
    fee_yes: 3.3,
    fee_no: 2.1,
    edge_up: -8.7,
    edge_down: 4.2,
    leftover_cents: -3,
    yes_bid_size: 140,
    no_bid_size: 65,
    ...over,
  } as Snapshot;
}

test("every number is carried from the snapshot, not recomputed", () => {
  // The fee and fair value here are deliberately not what a recomputation would
  // produce for this price. If the box derived them, these assertions fail.
  const s = snap();
  const up = economicsOf(s, "UP");
  assert.equal(up.fair, s.fair_yes);
  assert.equal(up.fee, s.fee_yes);
  assert.equal(up.edge, s.edge_up);
  assert.equal(up.leftover, s.leftover_cents);
  assert.equal(up.ask, s.yes_ask);
  assert.equal(up.touch, s.yes_bid_size);
});

test("the DOWN side reads DOWN's own fields, and NO fair is the complement", () => {
  const s = snap();
  const dn = economicsOf(s, "DOWN");
  assert.equal(dn.fee, s.fee_no);
  assert.equal(dn.edge, s.edge_down);
  assert.equal(dn.ask, s.no_ask);
  assert.equal(dn.touch, s.no_bid_size);
  // A binary's NO fair is 100 − YES fair by definition, not by a second model.
  // Compared at display precision: the box rounds, and 100 − 77.4 is not 22.6 in
  // binary floating point.
  assert.ok(Math.abs(dn.fair - (100 - s.fair_yes)) < 0.05, `${dn.fair} is not the complement of ${s.fair_yes}`);
  assert.equal(up_plus_down(s), 100);
});

function up_plus_down(s: Snapshot): number {
  return economicsOf(s, "UP").fair + economicsOf(s, "DOWN").fair;
}

test("the ask is the same ask the book marks, on both sides", () => {
  for (const s of [snap(), snap({ yes_ask: 0, no_ask: 0, yes_mid: 64 }), snap({ yes_ask: 91, no_ask: 11 })]) {
    for (const side of ["UP", "DOWN"] as const) {
      assert.equal(economicsOf(s, side).ask, Math.round(markSide(s, side) * 10) / 10, `${side} ask drifted from markSide`);
    }
  }
});

test("the floor verdict is the book's own gate, at every price", () => {
  // Not "agrees with the floor constant" — literally the same predicate, so a
  // change to how the book gates a fill cannot leave the box behind.
  for (let ask = 1; ask <= 99; ask++) {
    const e = economicsOf(snap({ yes_ask: ask }), "UP");
    assert.equal(e.bookable, bookable(ask), `${ask}¢ disagreed with the book`);
  }
});

test("the floor shown is the constant that gates the fill", () => {
  assert.equal(economicsOf(snap(), "UP").floor, FLOOR_LIVE_CENTS);
  // Reverting the trial is one constant, and the box has to follow it.
  assert.equal(economicsOf(snap({ yes_ask: FLOOR_LIVE_CENTS }), "UP").bookable, true);
  assert.equal(economicsOf(snap({ yes_ask: FLOOR_LIVE_CENTS - 1 }), "UP").bookable, false);
});

test("breakeven is the price plus its fee, the rate this call needs to stand still", () => {
  const s = snap({ yes_ask: 82, fee_yes: 3.3 });
  assert.equal(economicsOf(s, "UP").breakeven, 85.3);
});

test("a sub-floor ask says so, and names the floor", () => {
  const e = economicsOf(snap({ yes_ask: 71 }), "UP");
  assert.equal(e.bookable, false);
  assert.match(e.why ?? "", new RegExp(`71¢ is under the ${FLOOR_LIVE_CENTS}¢ floor`));
});

test("an empty touch is reported beside a true verdict, not instead of it", () => {
  // The book's gate is a price test, so it passes. Saying bookable:false here
  // would misreport what the book does; saying nothing would overstate the fill.
  const e = economicsOf(snap({ yes_ask: 84, yes_bid_size: 0 }), "UP");
  assert.equal(e.bookable, true);
  assert.equal(e.touch, 0);
  assert.match(e.why ?? "", /nothing resting at the touch/);
});

test("a clean fill at the floor has nothing standing in the way", () => {
  const e = economicsOf(snap({ yes_ask: 86, yes_bid_size: 220 }), "UP");
  assert.equal(e.bookable, true);
  assert.equal(e.why, null);
});

test("WAIT prices nothing and says why rather than showing a zero", () => {
  const e = economicsOf(snap(), "WAIT");
  assert.equal(e.side, null);
  assert.equal(e.ask, 0);
  assert.equal(e.bookable, false);
  assert.match(e.why ?? "", /not leaning/);
  // Fair value still shows: it is the desk's read on the window, not on a side.
  assert.equal(e.fair, snap().fair_yes);
});

test("a hole in the book is not a price", () => {
  for (const s of [snap({ yes_ask: 0, yes_mid: 0 }), snap({ yes_ask: 100, yes_mid: 0 })]) {
    const e = economicsOf(s, "UP");
    assert.equal(e.bookable, false);
    assert.match(e.why ?? "", /no real price/);
  }
});

test("a non-finite field becomes a zero rather than a NaN on the page", () => {
  const e = economicsOf(snap({ fair_yes: NaN, leftover_cents: Infinity, fee_yes: NaN }), "UP");
  for (const v of [e.fair, e.leftover, e.fee, e.ask, e.edge, e.breakeven]) {
    assert.ok(Number.isFinite(v), "a non-finite value reached the box");
  }
});
