import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCancelPressure,
  depthConcentration,
  depthImbalance,
  depthSlope,
  freshTape2,
  imbalanceVelocity,
  microprice,
  midpoint,
  normalizedOfi,
  ofi,
  onBookDelta,
  onTape2Trade,
  persistence,
  sampleTape2,
  tape2Features,
  touchAge,
  tradeFlow,
  weightedImbalance,
} from "./tape2.ts";
import type { YesView } from "./lab-book.ts";

/** A YES-space book: bids best-first, asks best-first. */
function view(bids: [number, number][], asks: [number, number][]): YesView {
  return {
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
  };
}

/** Heavy bid, thin ask — pressure toward UP. */
const HEAVY_BID = view(
  [
    [80, 1000],
    [79, 500],
    [78, 250],
  ],
  [
    [81, 100],
    [82, 50],
    [83, 25],
  ],
);

test("depth imbalance reads deeper than the touch and keeps its sign meaning", () => {
  // 1000 vs 100 at the touch.
  assert.equal(depthImbalance(HEAVY_BID, 1), round(1000 - 100, 1100));
  // 1750 vs 175 across three levels.
  assert.equal(depthImbalance(HEAVY_BID, 3), round(1750 - 175, 1925));
  // Positive always means pressure toward UP.
  assert.ok(depthImbalance(HEAVY_BID, 1) > 0);
  const flipped = view([[80, 100]], [[81, 1000]]);
  assert.ok(depthImbalance(flipped, 1) < 0, "a heavy ask must read negative");
  // A balanced book is zero; an empty one is zero, not NaN.
  assert.equal(depthImbalance(view([[80, 500]], [[81, 500]]), 1), 0);
  assert.equal(depthImbalance(view([], []), 5), 0);
});

function round(num: number, den: number): number {
  return Math.round((num / den) * 10_000) / 10_000;
}

test("weighted imbalance counts near size more than far size", () => {
  // Same totals either side, but one book's size sits at the touch and the
  // other's sits five cents out. The weighted read must separate them.
  const near = view([[80, 1000]], [[81, 1000]]);
  const farAsk = view(
    [[80, 1000]],
    [
      [81, 1],
      [86, 999],
    ],
  );
  assert.equal(weightedImbalance(near, 5), 0, "equal size at equal distance is balanced");
  assert.ok(weightedImbalance(farAsk, 5) > 0.5, "ask size parked far away should not offset a heavy touch bid");
  // A flat deep sum would call the second book nearly balanced; this is the point.
  assert.ok(Math.abs(depthImbalance(farAsk, 5)) < 0.01);
});

test("microprice leans toward the thin side, and degrades to the mid", () => {
  // Heavy bid, thin ask: fair sits nearer the ask, because the ask gives way first.
  const m = microprice(HEAVY_BID);
  assert.ok(m > midpoint(HEAVY_BID), `microprice ${m} should exceed mid ${midpoint(HEAVY_BID)}`);
  assert.ok(m < 81, "and must stay inside the spread");
  // Balanced sizes put it exactly at the mid.
  const bal = view([[80, 500]], [[82, 500]]);
  assert.equal(microprice(bal), 81);
  assert.equal(midpoint(bal), 81);
  // One-sided or empty books must not produce NaN.
  assert.equal(microprice(view([[80, 10]], [])), 80);
  assert.equal(microprice(view([], [])), 0);
  assert.equal(midpoint(view([], [])), 0);
});

test("a cancel is never counted as a trade — the rule this module exists for", () => {
  const st = freshTape2();
  // 500 of resting ask size is PULLED. That is upward book pressure, and it is
  // emphatically not 500 of buying.
  onBookDelta(st, "ask", 81, -500, 0, 1_000);
  assert.ok(ofi(st, 1_000) > 0, "pulling the ask is upward book pressure");
  const flow = tradeFlow(st, 1_000);
  assert.equal(flow.n, 0, "no execution was observed");
  assert.equal(flow.yes, 0);
  assert.equal(flow.no, 0);
  assert.equal(flow.imbalance, 0);
  // Only the trade channel can create trade flow.
  onTape2Trade(st, "yes", 7, 1_100);
  assert.equal(tradeFlow(st, 1_100).n, 1);
  assert.equal(tradeFlow(st, 1_100).yes, 7);
  // And that execution did not change the book-derived OFI.
  assert.equal(ofi(st, 1_100), ofi(st, 1_000));
});

test("order-flow imbalance signs every combination the way the book means it", () => {
  const cases: [("bid" | "ask"), number, number][] = [
    ["bid", +100, +100], // size added to the bid: upward
    ["bid", -100, -100], // bid pulled: downward
    ["ask", +100, -100], // size added to the ask: downward
    ["ask", -100, +100], // ask pulled: upward
  ];
  for (const [side, delta, expected] of cases) {
    const st = freshTape2();
    onBookDelta(st, side, 80, delta, delta > 0 ? 100 : 0, 1_000);
    assert.equal(ofi(st, 1_000), expected, `${side} ${delta}`);
  }
});

test("added and pulled size are reported separately, not netted away", () => {
  const st = freshTape2();
  onBookDelta(st, "bid", 80, +300, 300, 1_000);
  onBookDelta(st, "bid", 80, -300, 0, 1_500);
  // Netted, this is zero pressure. Separately, it is 300 posted then pulled —
  // a very different thing to read, so both must survive.
  assert.equal(ofi(st, 2_000), 0);
  const p = addCancelPressure(st, 2_000);
  assert.equal(p.bid_add, 300);
  assert.equal(p.bid_cancel, 300);
  assert.equal(p.events, 2);
  assert.equal(p.cancel_share, 0.5);
});

test("normalized OFI scales against the depth it is pushing against", () => {
  const thin = view([[80, 10]], [[81, 10]]);
  const thick = view([[80, 10_000]], [[81, 10_000]]);
  const st = freshTape2();
  onBookDelta(st, "bid", 80, +100, 110, 1_000);
  const a = normalizedOfi(st, thin, 1_000);
  const b = normalizedOfi(st, thick, 1_000);
  assert.ok(a > b, "the same flow matters more in a thin book");
  assert.equal(normalizedOfi(freshTape2(), view([], []), 1_000), 0, "no depth must not divide by zero");
});

test("a depleted level that refills is counted as replenishment, and a stale one is not", () => {
  const st = freshTape2();
  onBookDelta(st, "ask", 81, -100, 0, 1_000); // emptied
  assert.equal(st.replenished, 0);
  onBookDelta(st, "ask", 81, +100, 100, 3_000); // back within the window
  assert.equal(st.replenished, 1);
  // Emptied again, but refilled long after: not the same event.
  onBookDelta(st, "ask", 81, -100, 0, 10_000);
  onBookDelta(st, "ask", 81, +100, 100, 60_000);
  assert.equal(st.replenished, 1, "a refill 50s later is not a replenishment");
});

test("persistence measures how long the sign held, and needs two samples first", () => {
  const st = freshTape2();
  assert.equal(persistence(st, 1_000, 5_000), null, "nothing to measure yet");
  sampleTape2(st, HEAVY_BID, 1_000);
  assert.equal(persistence(st, 1_000, 5_000), null, "one sample is not a window");
  sampleTape2(st, HEAVY_BID, 2_000);
  assert.equal(persistence(st, 2_000, 5_000), 1, "held its sign throughout");
  // Flip the book: the recent window is now mixed.
  const heavyAsk = view([[80, 100]], [[81, 1000]]);
  sampleTape2(st, heavyAsk, 3_000);
  const p = persistence(st, 3_000, 5_000);
  assert.ok(p != null && p < 1 && p > 0, `mixed window should be between 0 and 1, got ${p}`);
  assert.equal(st.flips, 1, "the sign change is counted");
});

test("imbalance velocity is per second and signed toward the change", () => {
  const st = freshTape2();
  sampleTape2(st, view([[80, 100]], [[81, 1000]]), 1_000); // negative
  sampleTape2(st, view([[80, 1000]], [[81, 100]]), 3_000); // positive
  const v = imbalanceVelocity(st, 3_000, 15_000);
  assert.ok(v != null && v > 0, `imbalance rose, velocity should be positive, got ${v}`);
  assert.equal(imbalanceVelocity(freshTape2(), 1_000), null);
});

test("touch age tracks the last change of either best price", () => {
  const st = freshTape2();
  assert.equal(touchAge(st, 5_000), null);
  sampleTape2(st, HEAVY_BID, 1_000);
  assert.equal(touchAge(st, 5_000), 4_000);
  // Size-only change at the same prices does not reset the touch.
  sampleTape2(st, view([[80, 9]], [[81, 9]]), 6_000);
  assert.equal(touchAge(st, 7_000), 6_000);
  // A new best price does.
  sampleTape2(st, view([[79, 9]], [[81, 9]]), 8_000);
  assert.equal(touchAge(st, 9_000), 1_000);
});

test("shape features describe a shell book versus a thick one", () => {
  const shell = view([[80, 1000]], [[81, 1000]]);
  const thick = view(
    [
      [80, 100],
      [79, 1000],
    ],
    [
      [81, 100],
      [82, 1000],
    ],
  );
  assert.equal(depthConcentration(shell, 5), 1, "all the size is at the touch");
  assert.ok(depthConcentration(thick, 5) < 0.3, "a thick book is not concentrated");
  assert.ok(depthSlope(thick, 5) > depthSlope(shell, 5), "the thick book thickens faster");
  assert.equal(depthConcentration(view([], []), 5), 0);
  assert.equal(depthSlope(view([], []), 5), 0);
});

test("the full feature set is finite, complete, and never invents flow", () => {
  const st = freshTape2();
  onBookDelta(st, "bid", 80, +200, 1_200, 1_000);
  onBookDelta(st, "ask", 81, -50, 50, 1_500);
  onTape2Trade(st, "yes", 12, 1_600);
  sampleTape2(st, HEAVY_BID, 1_000);
  sampleTape2(st, HEAVY_BID, 2_000);
  const f = tape2Features(st, HEAVY_BID, 2_000);

  // Every numeric field is finite; nullable ones are null or finite, never NaN.
  for (const [k, v] of Object.entries(f)) {
    if (v === null) continue;
    assert.equal(typeof v, "number", `${k} should be a number`);
    assert.ok(Number.isFinite(v), `${k} was not finite: ${v}`);
  }
  assert.equal(f.yes_bid, 80);
  assert.equal(f.yes_ask, 81);
  assert.equal(f.spread, 1);
  assert.equal(f.bid_levels, 3);
  assert.equal(f.ask_levels, 3);
  assert.ok(f.imb_l1 > 0 && f.imb_l5 > 0);
  assert.equal(f.micro_minus_mid, Math.round((f.microprice - f.midpoint) * 100) / 100);
  assert.ok(f.ofi_15s > 0, "added bid and pulled ask are both upward");
  assert.equal(f.trade_n_15s, 1, "one execution, from the trade channel only");
  assert.equal(f.persist_5s, 1);
  assert.equal(f.book_events_15s, 2);
});

test("an empty book produces a complete, finite, all-zero feature set", () => {
  const f = tape2Features(freshTape2(), { bids: [], asks: [] }, 1_000);
  for (const [k, v] of Object.entries(f)) {
    if (v === null) continue;
    assert.ok(Number.isFinite(v), `${k} was not finite on an empty book: ${v}`);
  }
  assert.equal(f.yes_bid, 0);
  assert.equal(f.spread, 0);
  assert.equal(f.imb_l1, 0);
  assert.equal(f.ofi_15s, 0);
});

test("the rolling window forgets old events instead of growing without bound", () => {
  const st = freshTape2();
  for (let i = 0; i < 500; i++) onBookDelta(st, "bid", 80, +1, i + 1, i * 500);
  const now = 499 * 500; // the last event's own timestamp
  // 60s of history at most, so far fewer than 500 events survive.
  assert.ok(st.events.length < 200, `kept ${st.events.length} events`);
  assert.ok(st.events.every((e) => e.t >= now - 60_000));
  // And the OFI window is narrower still.
  assert.ok(ofi(st, now, 15_000) <= 31);
});

test("no value depends on an event that has not happened yet", () => {
  const st = freshTape2();
  sampleTape2(st, HEAVY_BID, 1_000);
  sampleTape2(st, HEAVY_BID, 2_000);
  const atTwo = tape2Features(st, HEAVY_BID, 2_000);
  // A later event must not change what was true at t=2000.
  onBookDelta(st, "bid", 80, +9_999, 10_999, 5_000);
  onTape2Trade(st, "yes", 9_999, 5_000);
  const recomputed = tape2Features(st, HEAVY_BID, 2_000);
  assert.deepEqual(recomputed, atTwo, "a future event leaked into a past reading");
});
