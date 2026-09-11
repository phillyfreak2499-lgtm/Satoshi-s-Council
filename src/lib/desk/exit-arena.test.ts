import assert from "node:assert/strict";
import test from "node:test";
import { takerFeeCents } from "./clock.ts";
import {
  CHALLENGER_EXITS,
  pointsFromReplay,
  runArena,
  sellableBid,
  simulateExit,
  type Entry,
  type PricePoint,
} from "./exit-arena.ts";
import {
  EXIT_HOLD_V1,
  EXIT_PROVE120_V1,
  EXIT_PROVE180_V1,
  EXIT_PROVE240_V1,
  EXIT_TAKE90_V1,
  EXIT_CANDIDATES,
  SIGNAL_CHAIR_V1,
} from "./floor-policy.ts";

const T0 = Date.parse("2026-09-11T13:00:00Z");
/** A sample every 4s, like the replay writer. */
const at = (s: number, yes_bid: number, yes_ask: number): PricePoint => ({ t: T0 + s * 1000, yes_bid, yes_ask });
const entryUp: Entry = { side: "UP", cents: 80, t: T0 };
const entryDown: Entry = { side: "DOWN", cents: 80, t: T0 };

// ---------------------------------------------------------------------------
// The executable price rule.
// ---------------------------------------------------------------------------

test("UP sells into the YES bid; DOWN sells into the complement of the YES ask", () => {
  // A book of 82 bid / 85 ask. Holding YES you can sell at 82. Holding NO you can
  // sell at 100-85 = 15 — the NO bid, which is the same order as a YES offer at 85.
  assert.equal(sellableBid("UP", 82, 85), 82);
  assert.equal(sellableBid("DOWN", 82, 85), 15);
});

test("a DOWN holding is never priced off the YES bid", () => {
  // The cheat this study must not make: using 82 for a NO holding would price the
  // side the desk does not hold, and would flatter every DOWN exit.
  const wrong = 82;
  assert.notEqual(sellableBid("DOWN", 82, 85), wrong);
  // Nor the midpoint.
  assert.notEqual(sellableBid("DOWN", 82, 85), (82 + 85) / 2);
  assert.notEqual(sellableBid("UP", 82, 85), (82 + 85) / 2);
});

test("an unusable book yields no price rather than a guess", () => {
  assert.equal(sellableBid("UP", 0, 85), null, "no bid");
  assert.equal(sellableBid("UP", 82, 0), null, "no ask");
  assert.equal(sellableBid("DOWN", 82, 100), null, "ask at 100 leaves no NO bid");
  assert.equal(sellableBid("UP", 100, 100), null);
  assert.equal(sellableBid("UP", 90, 85), null, "crossed book is not tradeable");
  assert.equal(sellableBid("UP", Number.NaN, 85), null);
});

test("a window with no usable price after entry is DATA_INVALID, not a zero", () => {
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, [at(-20, 80, 82), at(-10, 81, 83)], "UP");
  assert.equal(o.data_invalid, true);
  assert.equal(o.exit_reason, "DATA_INVALID");
  assert.equal(o.net_cents, null, "an unevaluable window must not contribute a number");
  assert.match(o.invalid_why ?? "", /no sellable price/);
});

test("prices before the fill are never used", () => {
  // A 95 bid ten seconds BEFORE entry must not prove anything.
  const path = [at(-10, 95, 96), at(20, 80, 82), at(200, 78, 80)];
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, path, "UP");
  assert.equal(o.proven_at, null, "a price the position did not exist for cannot prove it");
  assert.equal(o.exit_reason, "DEADLINE");
});

// ---------------------------------------------------------------------------
// PROVE timers — on elapsed time, from the actual entry.
// ---------------------------------------------------------------------------

test("PROVE horizons are 120 / 180 / 240 seconds", () => {
  assert.equal(Number(EXIT_PROVE120_V1.params.horizon_s), 120);
  assert.equal(Number(EXIT_PROVE180_V1.params.horizon_s), 180);
  assert.equal(Number(EXIT_PROVE240_V1.params.horizon_s), 240);
  for (const e of [EXIT_PROVE120_V1, EXIT_PROVE180_V1, EXIT_PROVE240_V1]) {
    assert.equal(Number(e.params.target_cents), 10, "+10¢, frozen");
  }
});

test("the target is +10¢ from the ACTUAL entry, not a fixed level", () => {
  // Entry 72 needs 82; entry 85 needs 95. An 84 bid proves the first and not the second.
  const path = [at(40, 84, 86)];
  assert.equal(simulateExit(EXIT_PROVE180_V1, { side: "UP", cents: 72, t: T0 }, path, "UP").exit_reason, "PROVEN_HELD");
  // Entry 85 never reaches 95, and there is no sample at or after the 180s
  // deadline, so it settles. It does NOT invent a fill at the deadline.
  assert.equal(simulateExit(EXIT_PROVE180_V1, { side: "UP", cents: 85, t: T0 }, path, "UP").exit_reason, "SETTLEMENT");
});

test("proof inside the horizon holds to settlement; each horizon decides for itself", () => {
  // +10¢ arrives at 150s. PROVE-120 has already missed it; 180 and 240 catch it.
  const path = [at(40, 84, 86), at(124, 78, 80), at(150, 90, 92), at(200, 70, 72), at(300, 60, 62)];
  const o120 = simulateExit(EXIT_PROVE120_V1, entryUp, path, "UP");
  const o180 = simulateExit(EXIT_PROVE180_V1, entryUp, path, "UP");
  const o240 = simulateExit(EXIT_PROVE240_V1, entryUp, path, "UP");

  assert.equal(o120.exit_reason, "DEADLINE", "120s deadline passed before the move");
  assert.equal(o120.exit_cents, 78, "first valid bid at or after 120s is the 124s sample");
  assert.equal(o120.secs_held, 124);

  assert.equal(o180.exit_reason, "PROVEN_HELD");
  assert.equal(o180.proven_at, T0 + 150_000);
  assert.equal(o240.exit_reason, "PROVEN_HELD");
});

test("a sample exactly on the deadline counts as inside the horizon", () => {
  // The boundary has to be decided and stated: at-or-before proves.
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, [at(180, 90, 92)], "UP");
  assert.equal(o.exit_reason, "PROVEN_HELD");
  assert.equal(o.proven_at, T0 + 180_000);
});

test("the deadline exit takes the first valid bid at or after it, not the deadline's price", () => {
  // Nothing trades between 100s and 260s. The exit is the 260s bid, and secs_held
  // says 260 — it does not pretend to have sold at 180.
  const path = [at(100, 79, 81), at(260, 55, 57)];
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, path, "DOWN");
  assert.equal(o.exit_reason, "DEADLINE");
  assert.equal(o.exit_cents, 55);
  assert.equal(o.secs_held, 260);
});

test("an invalid book at the deadline is skipped to the next valid one", () => {
  const path = [at(100, 79, 81), at(200, 0, 0), at(240, 60, 62)];
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, path, "DOWN");
  assert.equal(o.exit_cents, 60, "the unusable quote is not an exit price");
  assert.equal(o.secs_held, 240);
});

test("a window that ends before the deadline settles rather than inventing a fill", () => {
  const o = simulateExit(EXIT_PROVE240_V1, entryUp, [at(40, 82, 84), at(100, 81, 83)], "UP");
  assert.equal(o.exit_reason, "SETTLEMENT");
  assert.equal(o.exit_cents, null);
  assert.equal(o.exit_t, null);
});

// ---------------------------------------------------------------------------
// TAKE-90
// ---------------------------------------------------------------------------

test("TAKE-90 needs a genuinely sellable 90 bid", () => {
  assert.equal(Number(EXIT_TAKE90_V1.params.take_cents), 90);
  // An ask of 90 is not a bid of 90: holding YES, 89 bid / 91 ask does not fill.
  assert.equal(simulateExit(EXIT_TAKE90_V1, entryUp, [at(40, 89, 91)], "UP").exit_reason, "SETTLEMENT");
  assert.equal(simulateExit(EXIT_TAKE90_V1, entryUp, [at(40, 90, 92)], "UP").exit_reason, "TARGET");
});

test("TAKE-90 on a DOWN holding reads the NO bid", () => {
  // NO bid 90 means YES ask 10.
  assert.equal(simulateExit(EXIT_TAKE90_V1, entryDown, [at(40, 8, 10)], "DOWN").exit_cents, 90);
  // YES bid 90 is irrelevant to a NO holding.
  assert.equal(simulateExit(EXIT_TAKE90_V1, entryDown, [at(40, 90, 92)], "DOWN").exit_reason, "SETTLEMENT");
});

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

test("settlement pays one fee; an early exit pays two", () => {
  // The ledger's convention is ev = settle - entry - fee(entry): settlement is not
  // a trade. An exit that actually sells is, so it pays its own fee too.
  const held = simulateExit(EXIT_HOLD_V1, entryUp, [at(40, 82, 84)], "UP");
  assert.equal(held.net_cents, 100 - 80 - takerFeeCents(80));

  const cut = simulateExit(EXIT_PROVE180_V1, entryUp, [at(100, 79, 81), at(200, 70, 72)], "UP");
  assert.equal(cut.exit_cents, 70);
  assert.equal(cut.net_cents, Math.round((70 - 80 - takerFeeCents(80) - takerFeeCents(70)) * 10) / 10);
});

test("a proven position that settles pays one fee, not two", () => {
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, [at(40, 90, 92)], "UP");
  assert.equal(o.exit_reason, "PROVEN_HELD");
  assert.equal(o.net_cents, 100 - 80 - takerFeeCents(80), "proof is not a trade");
});

// ---------------------------------------------------------------------------
// Direction vs policy result — the distinction that must not collapse.
// ---------------------------------------------------------------------------

test("direction wrong and the loss saved are reported separately", () => {
  // The motivating case: Chair bought UP at 82, settlement went DOWN. HOLD eats the
  // lot; PROVE-180 cuts at 74.
  const entry: Entry = { side: "UP", cents: 82, t: T0 };
  const path = [at(40, 80, 82), at(200, 74, 76)];
  const hold = simulateExit(EXIT_HOLD_V1, entry, path, "DOWN");
  const prove = simulateExit(EXIT_PROVE180_V1, entry, path, "DOWN");

  assert.equal(hold.direction_right, false);
  assert.equal(prove.direction_right, false, "the exit policy does not change whose direction it was");
  assert.ok(hold.net_cents! < -80, `HOLD should be a near-total loss, got ${hold.net_cents}`);
  assert.ok(prove.net_cents! > hold.net_cents!, "the cut is the smaller loss");
  assert.ok(prove.net_cents! < 0, "but it is still a loss: the policy did not profit");
  // Both lost. One lost much less. That difference is the whole hypothesis.
  assert.ok(prove.net_cents! - hold.net_cents! > 50);
});

test("direction right does not guarantee the policy profited", () => {
  // Settlement favours UP, but TAKE-90 banked 90 and paid two fees — still a win,
  // just a smaller one than holding. The point is that the two axes are independent.
  const path = [at(40, 90, 92)];
  const take = simulateExit(EXIT_TAKE90_V1, entryUp, path, "UP");
  const hold = simulateExit(EXIT_HOLD_V1, entryUp, path, "UP");
  assert.equal(take.direction_right, true);
  assert.ok(take.net_cents! > 0);
  assert.ok(hold.net_cents! > take.net_cents!, "holding to 100 beat banking 90 minus a fee");
});

// ---------------------------------------------------------------------------
// Excursions, parity and plumbing.
// ---------------------------------------------------------------------------

test("excursions are measured on the sellable bid over the held interval only", () => {
  // Best 88 (+8), worst 70 (-10) before the 200s exit; the 300s collapse is after.
  const path = [at(40, 88, 90), at(100, 70, 72), at(200, 75, 77), at(300, 10, 12)];
  const o = simulateExit(EXIT_PROVE180_V1, entryUp, path, "UP");
  assert.equal(o.exit_reason, "DEADLINE");
  assert.equal(o.mfe_cents, 8);
  assert.equal(o.mae_cents, -10, "the post-exit collapse is not this position's excursion");
});

test("every candidate is handed the identical entry", () => {
  const path = [at(40, 84, 86), at(200, 70, 72)];
  const rows = runArena(EXIT_CANDIDATES, entryUp, path, "UP");
  assert.equal(rows.length, 5, "HOLD plus four challengers");
  // Same entry price and fee underlie every observation: a candidate cannot have
  // chosen a cheaper fill. Checked through the one number they all share.
  for (const r of rows) {
    assert.equal(r.obs.data_invalid, false, `${r.exit.id} should be evaluable`);
  }
  const settledNet = 100 - 80 - takerFeeCents(80);
  assert.equal(rows.find((r) => r.exit.id === "HOLD_V1")!.obs.net_cents, settledNet);
  assert.equal(rows.find((r) => r.exit.id === "PROVE240_V1")!.obs.net_cents, settledNet, "also settled");
});

test("an exit policy is the only thing the arena will run", () => {
  const o = simulateExit(SIGNAL_CHAIR_V1, entryUp, [at(40, 84, 86)], "UP");
  assert.equal(o.data_invalid, true, "a signal policy has no exit behaviour to simulate");
  assert.match(o.invalid_why ?? "", /not an exit policy/);
});

test("replay columns convert to absolute timestamps", () => {
  // cols.t is SECONDS from cols.t0, which is ms. Getting this backwards would make
  // every horizon wrong by a factor of a thousand.
  const pts = pointsFromReplay({ t0: T0, t: [0, 4, 8], yes_bid: [80, 81, 82], yes_ask: [82, 83, 84] });
  assert.equal(pts.length, 3);
  assert.equal(pts[0]!.t, T0);
  assert.equal(pts[1]!.t, T0 + 4_000);
  assert.equal(pts[2]!.t, T0 + 8_000);
});

test("sampling density cannot change an elapsed-time verdict", () => {
  // The failure this guards against: treating N samples back as N*step seconds.
  // The +10¢ move happens at 120s in both paths. At 4s resolution that is 30
  // samples in; at 60s resolution it is 2 samples in. An index-based horizon would
  // read those as wildly different elapsed times. An elapsed-time horizon cannot.
  const dense: PricePoint[] = [];
  for (let s = 0; s <= 300; s += 4) dense.push(at(s, s >= 120 ? 90 : 79, s >= 120 ? 92 : 81));
  const coarse: PricePoint[] = [];
  for (let s = 0; s <= 300; s += 60) coarse.push(at(s, s >= 120 ? 90 : 79, s >= 120 ? 92 : 81));

  const a = simulateExit(EXIT_PROVE180_V1, entryUp, dense, "UP");
  const b = simulateExit(EXIT_PROVE180_V1, entryUp, coarse, "UP");
  assert.equal(a.exit_reason, "PROVEN_HELD");
  assert.equal(b.exit_reason, "PROVEN_HELD", "2 samples in at 60s spacing is still 120 seconds");
  assert.equal(a.proven_at, T0 + 120_000);
  assert.equal(b.proven_at, T0 + 120_000);
  assert.equal(a.net_cents, b.net_cents);

  // And the same trajectory is correctly NOT proven for the 120s horizon at either
  // density when the move lands a little later than its deadline.
  const late4: PricePoint[] = [];
  for (let s = 0; s <= 300; s += 4) late4.push(at(s, s >= 124 ? 90 : 79, s >= 124 ? 92 : 81));
  const late60: PricePoint[] = [];
  for (let s = 0; s <= 300; s += 60) late60.push(at(s, s >= 124 ? 90 : 79, s >= 124 ? 92 : 81));
  assert.equal(simulateExit(EXIT_PROVE120_V1, entryUp, late4, "UP").exit_reason, "DEADLINE");
  assert.equal(simulateExit(EXIT_PROVE120_V1, entryUp, late60, "UP").exit_reason, "DEADLINE");
});

test("the challenger list is the four named candidates", () => {
  assert.deepEqual(
    CHALLENGER_EXITS.map((x) => x.id),
    ["PROVE120_V1", "PROVE180_V1", "PROVE240_V1", "TAKE90_V1"],
  );
  assert.equal(CHALLENGER_EXITS.some((x) => x.control), false, "the control is not a challenger");
});
