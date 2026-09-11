import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_AGAINST, marketSide, seatSignal, signalReport, type SignalRow } from "./seat-signal.ts";

/** n windows where the price said `mid` for YES, the seat leaned `lean`, and UP won `ups` of them. */
function win(n: number, mid: number, lean: "UP" | "DOWN" | null, ups: number): SignalRow[] {
  return Array.from({ length: n }, (_, i) => ({ lean, mid, winner: i < ups ? ("UP" as const) : ("DOWN" as const) }));
}

test("the market's side is the one the price favours, with its own probability", () => {
  assert.deepEqual(marketSide(85), { side: "UP", prob: 85 });
  assert.deepEqual(marketSide(15), { side: "DOWN", prob: 85 });
  // An even price favours nobody, so there is nothing to agree or disagree with.
  assert.equal(marketSide(50), null);
  assert.equal(marketSide(0), null);
  assert.equal(marketSide(100), null);
  assert.equal(marketSide(NaN), null);
});

test("a seat that only ever agrees with the price inherits its accuracy and adds nothing", () => {
  // Price says UP at 80¢ and UP wins 80% of the time. The seat says UP every
  // time. Its hit rate is a flattering 80 and its objection cell is empty.
  const s = seatSignal("ECHO", win(100, 80, "UP", 80));
  assert.equal(s.hit, 80);
  assert.equal(s.with_market.n, 100);
  assert.equal(s.against_market.n, 0);
  assert.equal(s.informative, false);
  assert.equal(s.thin, true, "no objections means nothing can be judged");
});

test("a seat is informative when its objection shows the price was overstated", () => {
  // The price claims 80% for UP. On the windows this seat objects, UP wins only
  // half the time. The seat loses most of those bets and is still right that the
  // favourite was overpriced.
  const s = seatSignal("SHARP", win(60, 80, "DOWN", 30));
  assert.equal(s.against_market.n, 60);
  assert.equal(s.against_market.market_said, 80);
  assert.equal(s.against_market.market_actual, 50);
  assert.equal(s.against_market.overconfident, 30);
  assert.equal(s.informative, true);
  // And note it: the seat's own side won only half the time.
  assert.equal(s.against_market.seat_right, 50);
  assert.equal(s.anti, false);
});

test("losing most of its objections does not make a seat uninformative", () => {
  // The heart of the module. Price says 90%, truth on these windows is 70%. The
  // seat picks the 30% side and is wrong 70% of the time — and has still found
  // twenty points of overpricing.
  const s = seatSignal("QUIET", win(50, 90, "DOWN", 35));
  assert.equal(s.against_market.seat_right, 30, "the seat loses most of them");
  assert.equal(s.against_market.overconfident, 20);
  assert.equal(s.informative, true);
});

test("a seat is anti-informative when the market beats its own claim on the objection", () => {
  // Price says 70% and UP wins 95% of the time on exactly the windows this seat
  // objects. Its objection is a signal to trust the price MORE.
  const s = seatSignal("BACKWARD", win(60, 70, "DOWN", 57));
  assert.equal(s.against_market.overconfident, -25);
  assert.equal(s.anti, true);
  assert.equal(s.informative, false);
});

test("the verdict is taken against the interval, never the point estimate", () => {
  // A gap of a couple of points on a handful of windows is noise, and calling it
  // informative is how a study manufactures findings.
  const noisy = seatSignal("NOISE", win(20, 70, "DOWN", 13)); // actual 65 vs said 70
  assert.ok((noisy.against_market.overconfident ?? 0) > 0, "the point estimate does lean that way");
  assert.equal(noisy.informative, false, "a 5-point gap on 20 windows is not a finding");
  assert.ok(noisy.against_market.actual_hi! > 70, "the interval still reaches the claimed rate");
});

test("a thin objection cell is never called either way", () => {
  const s = seatSignal("RARE", win(MIN_AGAINST - 1, 90, "DOWN", 0));
  assert.equal(s.thin, true);
  assert.equal(s.informative, false);
  assert.equal(s.anti, false);
});

test("agreement and objection are counted against the price, not against each other", () => {
  const rows = [...win(40, 80, "UP", 32), ...win(30, 80, "DOWN", 15)];
  const s = seatSignal("MIX", rows);
  assert.equal(s.spoke, 70);
  assert.equal(s.with_market.n, 40);
  assert.equal(s.against_market.n, 30);
  assert.equal(s.with_market.market_actual, 80);
  assert.equal(s.against_market.market_actual, 50);
});

test("quiet windows and even prices are excluded, not counted as agreement", () => {
  const s = seatSignal("Q", [...win(10, 80, null, 8), ...win(10, 50, "UP", 5), ...win(20, 80, "UP", 16)]);
  assert.equal(s.spoke, 20, "only the windows with both a read and a lopsided price");
  assert.equal(s.with_market.n, 20);
});

test("the report says the hit rate is not the test", () => {
  const r = signalReport(new Map([["A", win(60, 80, "DOWN", 30)], ["B", win(60, 80, "UP", 48)]]));
  assert.match(r.verdict, /The hit rate is not the test/);
  assert.match(r.verdict, /candidate to run in SHADOW/);
  assert.match(r.verdict, /None of it moves a weight today/);
});

test("an informative seat is named and the no-winner-required point is made", () => {
  const r = signalReport(new Map([["SHARP", win(60, 80, "DOWN", 30)]]));
  assert.deepEqual(r.informative, ["SHARP"]);
  assert.match(r.verdict, /does NOT require the seat to pick the winner/);
  assert.match(r.verdict, /knowing a favourite is overpriced is the edge/);
});

test("an anti-informative seat is called out as worse than silence", () => {
  const r = signalReport(new Map([["BACKWARD", win(60, 70, "DOWN", 57)]]));
  assert.deepEqual(r.anti, ["BACKWARD"]);
  assert.match(r.verdict, /led away from the truth/);
  assert.match(r.verdict, /worse than a seat that says nothing/);
});

test("finding nothing is stated rather than left blank", () => {
  const r = signalReport(new Map([["FLAT", win(60, 80, "DOWN", 48)]]));
  assert.deepEqual(r.informative, []);
  assert.match(r.verdict, /No seat's objection showed the price to be overstated/);
});

test("the number of seats tested is in the verdict, because that is the look-elsewhere", () => {
  const m = new Map<string, SignalRow[]>();
  for (let i = 0; i < 8; i++) m.set(`S${i}`, win(40, 80, "DOWN", 20));
  const r = signalReport(m);
  assert.equal(r.tested, 8);
  assert.match(r.verdict, /8 seats objected to the price often enough to judge/);
  assert.match(r.verdict, /the best-looking one is partly the luckiest/);
});

test("nothing to judge is reported as nothing", () => {
  const r = signalReport(new Map([["A", win(5, 80, "DOWN", 2)]]));
  assert.equal(r.tested, 0);
  assert.match(r.verdict, /Nothing here is a result/);
});
