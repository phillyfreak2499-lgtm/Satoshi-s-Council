import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDelta, applySnapshot, bests, bookTrusted, freshBook, markBookGap, tenths, yesView } from "./lab-book.ts";

/** A two-level book on each side, in the wire's YES-leg convention. */
function snapMsg() {
  return {
    market_ticker: "KXBTC15M-26SEP101430-30",
    // YES bids at 64¢ and 63¢.
    yes_dollars_fp: [
      ["0.6400", "1116.31"],
      ["0.6300", "400.00"],
    ],
    // NO bids reported YES-leg: 0.6500 means a NO bid at 35¢.
    no_dollars_fp: [
      ["0.6500", "7247.11"],
      ["0.6600", "900.00"],
    ],
  };
}

test("a snapshot loads both sides onto one YES-price convention", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  assert.equal(bookTrusted(b), false, "an empty book is not trusted");
  applySnapshot(b, snapMsg(), 1_000);
  assert.equal(b.ok, true);
  assert.equal(bookTrusted(b), true);
  const q = bests(b);
  assert.equal(q.yes_bid, 64);
  assert.equal(q.yes_bid_sz, 1116.31);
  // Best NO bid is 35¢ (the 0.65 YES-leg row), so the YES ask is 65¢.
  assert.equal(q.no_bid, 35);
  assert.equal(q.yes_ask, 65);
  assert.equal(tenths(100 - q.no_bid), q.yes_ask);
});

test("a delta moves a level and keeps the book trusted", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  applySnapshot(b, snapMsg(), 1_000);
  const out = applyDelta(b, { price_dollars: "0.6700", delta_fp: "762.28", side: "yes" }, 2_000);
  assert.deepEqual(out, { side: "yes", price: 67, size: 762.28, delta: 762.28 });
  assert.equal(bests(b).yes_bid, 67, "the new level is the best bid");
  assert.equal(b.upd_t, 2_000);
  assert.equal(bookTrusted(b), true);
});

test("a delta that empties a level removes it", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  applySnapshot(b, snapMsg(), 1_000);
  applyDelta(b, { price_dollars: "0.6400", delta_fp: "-1116.31", side: "yes" }, 2_000);
  assert.equal(bests(b).yes_bid, 63, "the book falls back to the next level");
});

test("a sequence gap makes the book untrusted until a snapshot re-anchors it", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  applySnapshot(b, snapMsg(), 1_000);
  applyDelta(b, { price_dollars: "0.6700", delta_fp: "762.28", side: "yes" }, 2_000);
  assert.equal(bookTrusted(b), true);

  // The stream skipped a message: everything after this is suspect.
  markBookGap(b, 3_000);
  assert.equal(b.stale, true);
  assert.equal(b.gaps, 1);
  assert.equal(b.gap_t, 3_000);
  assert.equal(bookTrusted(b), false, "book-derived evidence must be quarantined");
  // The levels are kept for a human reading the chart, just not trusted.
  assert.equal(bests(b).yes_bid, 67);

  // More deltas while stale do NOT restore trust.
  applyDelta(b, { price_dollars: "0.6800", delta_fp: "50.00", side: "yes" }, 4_000);
  assert.equal(bookTrusted(b), false, "a delta cannot re-anchor a gapped book");
  assert.equal(b.stale, true);

  // Only a fresh snapshot re-anchors.
  applySnapshot(b, snapMsg(), 5_000);
  assert.equal(b.stale, false);
  assert.equal(b.gap_t, 0);
  assert.equal(bookTrusted(b), true);
  assert.equal(b.gaps, 1, "the gap is still counted after recovery");
  assert.equal(bests(b).yes_bid, 64, "the snapshot replaced the stale levels");
});

test("repeated gaps keep the first staleness time and count every gap", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  applySnapshot(b, snapMsg(), 1_000);
  markBookGap(b, 3_000);
  markBookGap(b, 4_000);
  assert.equal(b.gaps, 2);
  assert.equal(b.gap_t, 3_000, "staleness began at the first gap");
  assert.equal(bookTrusted(b), false);
});

test("a crossed snapshot flips the NO-leg interpretation instead of serving a crossed book", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  // NO rows already in NO-leg cents: a 35¢ NO bid against a 64¢ YES bid.
  // Read as YES-leg it would become 65¢, crossing the book (64 + 65 > 100).
  applySnapshot(b, { yes_dollars_fp: [["0.6400", "100"]], no_dollars_fp: [["0.3500", "100"]] }, 1_000);
  const q = bests(b);
  assert.ok(q.yes_bid + q.no_bid <= 100, `book must not be crossed: ${q.yes_bid} + ${q.no_bid}`);
  assert.equal(b.flips, 1);
  assert.equal(bookTrusted(b), true);
});

test("yesView puts both sides on one YES price axis, best first", () => {
  const b = freshBook("KXBTC15M-26SEP101430-30");
  applySnapshot(b, snapMsg(), 1_000);
  const v = yesView(b);
  // YES bids as stored, best first.
  assert.deepEqual(
    v.bids.map((l) => [l.price, l.size]),
    [
      [64, 1116.31],
      [63, 400],
    ],
  );
  // NO bids at 35¢ and 34¢ become YES asks at 65¢ and 66¢, cheapest first.
  assert.deepEqual(
    v.asks.map((l) => [l.price, l.size]),
    [
      [65, 7247.11],
      [66, 900],
    ],
  );
  // The touch agrees with bests(), which is the older derivation.
  const q = bests(b);
  assert.equal(v.bids[0].price, q.yes_bid);
  assert.equal(v.asks[0].price, q.yes_ask);
  assert.equal(v.asks[0].size, q.yes_ask_sz);
  // And the book is not crossed.
  assert.ok(v.asks[0].price > v.bids[0].price);
});

test("yesView drops emptied levels and survives an empty book", () => {
  const b = freshBook("T");
  assert.deepEqual(yesView(b), { bids: [], asks: [] });
  applySnapshot(b, snapMsg(), 1_000);
  applyDelta(b, { price_dollars: "0.6400", delta_fp: "-1116.31", side: "yes" }, 2_000);
  const v = yesView(b);
  assert.deepEqual(v.bids.map((l) => l.price), [63], "the emptied level is gone");
});
