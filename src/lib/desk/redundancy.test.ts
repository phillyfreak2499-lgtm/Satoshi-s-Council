import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_PCT,
  MIN_SWINGS,
  overlaps,
  redundancyReport,
  seatLift,
  tally,
  type VoteRow,
} from "./redundancy.ts";

const W = (winner: "UP" | "DOWN", spoke: Record<string, "UP" | "DOWN">): VoteRow => ({ winner, spoke });

/** In most tests every seat is heard; the exceptions say so explicitly. */
const ALL = new Set(["A", "B", "C", "D", "S", "X", "Y"]);

test("a tied council says WAIT rather than picking a side", () => {
  assert.equal(tally(["UP", "DOWN"]), "WAIT");
  assert.equal(tally([]), "WAIT");
  assert.equal(tally(["UP", "UP", "DOWN"]), "UP");
  assert.equal(tally(["DOWN"]), "DOWN");
});

test("agreement is counted only where both seats actually spoke", () => {
  // A and B agree on the two windows they share. B is quiet elsewhere, and being
  // quiet at the same time as someone is not agreeing with them.
  const rows = [
    W("UP", { A: "UP", B: "UP" }),
    W("UP", { A: "UP", B: "UP" }),
    ...Array.from({ length: 30 }, () => W("DOWN", { A: "DOWN" })),
  ];
  const [pair] = overlaps(rows, ["A", "B"], 2);
  assert.equal(pair!.both, 2);
  assert.equal(pair!.agree, 100);
});

test("a thin pair is left out rather than shown at a confident-looking rate", () => {
  const rows = [W("UP", { A: "UP", B: "UP" })];
  assert.equal(overlaps(rows, ["A", "B"], 20).length, 0);
});

test("two seats saying the same thing every time read as one seat twice", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    W(i % 2 ? "UP" : "DOWN", { A: i % 2 ? "UP" : "DOWN", B: i % 2 ? "UP" : "DOWN", C: "UP" }),
  );
  const ps = overlaps(rows, ["A", "B", "C"], 20);
  const ab = ps.find((p) => p.a === "A" && p.b === "B")!;
  assert.equal(ab.agree, 100);
  assert.ok(ab.agree >= DUPLICATE_PCT);
  const ac = ps.find((p) => p.a === "A" && p.b === "C")!;
  assert.ok(ac.agree < DUPLICATE_PCT);
});

test("a seat that never changes the answer registers no swings", () => {
  // D always agrees with a council that was already decided 2-0 without it.
  const rows = Array.from({ length: 30 }, () => W("UP", { A: "UP", B: "UP", D: "UP" }));
  const l = seatLift(rows, "D", ALL);
  assert.equal(l.spoke, 30);
  assert.equal(l.swings, 0);
  assert.equal(l.lift, 0);
  assert.equal(l.thin, true);
});

test("lift is measured only on the windows the seat actually changed", () => {
  // X breaks a 1-1 tie. With X the council is right; without it, WAIT.
  const rows = Array.from({ length: 20 }, () => W("UP", { A: "UP", B: "DOWN", X: "UP" }));
  const l = seatLift(rows, "X", ALL);
  assert.equal(l.swings, 20);
  assert.equal(l.right_with, 20);
  assert.equal(l.right_without, 0, "a WAIT is not right");
  assert.equal(l.lift, 20);
  assert.equal(l.thin, false);
});

test("a seat that flips a correct council to a wrong one reads negative", () => {
  // A and B say UP and are right; X flips the tally to DOWN.
  const rows = Array.from({ length: 20 }, () => W("UP", { A: "UP", B: "UP", X: "DOWN", Y: "DOWN" }));
  const l = seatLift(rows, "X", ALL);
  assert.equal(l.swings, 20);
  assert.equal(l.right_with, 0, "2-2 is a tie, so with X the council says WAIT");
  assert.equal(l.right_without, 20);
  assert.equal(l.lift, -20);
});

test("a WAIT is scored as neither right nor wrong", () => {
  // Without X the council ties. That must not count against X's absence as if it
  // had been an incorrect call.
  const rows = [W("UP", { A: "UP", B: "DOWN", X: "DOWN" })];
  const l = seatLift(rows, "X", ALL);
  assert.equal(l.swings, 1);
  assert.equal(l.right_with, 0);
  assert.equal(l.right_without, 0);
});

test("speaking alone is tracked separately, because a lone voice is not redundant", () => {
  const rows = [
    ...Array.from({ length: 12 }, () => W("UP", { S: "UP" })),
    ...Array.from({ length: 4 }, () => W("DOWN", { S: "UP" })),
    ...Array.from({ length: 10 }, () => W("UP", { A: "UP", B: "UP" })),
  ];
  const l = seatLift(rows, "S", ALL);
  assert.equal(l.solo, 16);
  assert.equal(l.solo_right, 75);
  assert.equal(l.spoke, 16);
});

test("a thin lift is labelled thin instead of ranked", () => {
  const rows = Array.from({ length: MIN_SWINGS - 1 }, () => W("UP", { A: "UP", B: "DOWN", X: "UP" }));
  assert.equal(seatLift(rows, "X", ALL).thin, true);
});

test("the report refuses to turn the worst seat into a decision", () => {
  const rows = Array.from({ length: 40 }, () => W("UP", { A: "UP", B: "UP", X: "DOWN", Y: "DOWN" }));
  const r = redundancyReport(rows, ["A", "B", "X", "Y"], ["A", "B", "X", "Y"]);
  assert.ok((r.seats[0]!.lift ?? 0) < 0, "the worst seat should sort first");
  assert.match(r.caveat, /candidate to run gagged in shadow, not a seat to mute/);
  assert.match(r.caveat, /measured on windows that already happened/);
  assert.match(r.caveat, /prospectively/);
});

test("the report names how many seats were tested, because that is the look-elsewhere", () => {
  const rows = Array.from({ length: 40 }, () => W("UP", { A: "UP", B: "DOWN", X: "UP" }));
  const r = redundancyReport(rows, ["A", "B", "X"], ["A", "B", "X"]);
  assert.match(r.caveat, /3 seats examined on 40 graded windows/);
  assert.match(r.caveat, /close to expected even if every seat were identical|No seat is negative/);
});

test("silent seats are reported as a cost, not as a fault", () => {
  const rows = Array.from({ length: 30 }, () => W("UP", { A: "UP", B: "UP", D: "UP" }));
  const r = redundancyReport(rows, ["A", "B", "D"], ["A", "B", "D"]);
  assert.ok(r.silent.includes("D"));
  assert.match(r.caveat, /a cost with no effect, not evidence they are wrong/);
});

test("duplicate pairs are surfaced as where the chair double-counts", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    W(i % 2 ? "UP" : "DOWN", { A: i % 2 ? "UP" : "DOWN", B: i % 2 ? "UP" : "DOWN" }),
  );
  const r = redundancyReport(rows, ["A", "B"], ["A", "B"]);
  assert.match(r.caveat, /counting one read twice/);
});

test("an empty ledger produces no claims", () => {
  const r = redundancyReport([], ["A", "B"], ["A", "B"]);
  assert.equal(r.windows, 0);
  assert.deepEqual(r.pairs, []);
  assert.equal(r.seats.length, 2);
  assert.equal(r.seats[0]!.swings, 0);
});


test("a seat the chair cannot hear gets a row but no swing or lift", () => {
  // Removing a shadow seat from a tally it was never in would describe a council
  // that does not exist. It still reports how it spoke and how it did.
  const rows = [
    ...Array.from({ length: 20 }, () => W("UP", { A: "UP", B: "DOWN", SHADOW: "UP" })),
    ...Array.from({ length: 5 }, () => W("DOWN", { SHADOW: "DOWN" })),
  ];
  const heard = new Set(["A", "B"]);
  const l = seatLift(rows, "SHADOW", heard);
  assert.equal(l.in_tally, false);
  assert.equal(l.swings, null);
  assert.equal(l.lift, null);
  assert.equal(l.right_with, null);
  // Its own record is still measured.
  assert.equal(l.spoke, 25);
  assert.equal(l.alone_right, 100);
  assert.equal(l.solo, 5);
  assert.equal(l.thin, true, "unmeasurable, not merely thin");
});

test("excluding a seat the chair cannot hear changes what every other seat scores", () => {
  // A says UP, B says DOWN, a shadow seat says UP, and UP wins.
  // Heard = {A,B}: with A the tally is 1-1, a WAIT, which is neither right nor
  // wrong — so A scores 0. Count the shadow seat too and the tally becomes UP and
  // A suddenly looks worth +20. The whole ranking turns on the exclusion, which
  // is why it is not left to whatever happens to be in the jsonb.
  const rows = Array.from({ length: 20 }, () => W("UP", { A: "UP", B: "DOWN", SHADOW: "UP" }));
  const heardOnly = seatLift(rows, "A", new Set(["A", "B"]));
  assert.equal(heardOnly.swings, 20);
  assert.equal(heardOnly.right_with, 0, "1-1 is a tie, and a WAIT is not right");
  assert.equal(heardOnly.lift, 0);

  const counted = seatLift(rows, "A", new Set(["A", "B", "SHADOW"]));
  assert.equal(counted.right_with, 20);
  assert.equal(counted.lift, 20);
  assert.notEqual(counted.lift, heardOnly.lift);
});

test("speaking alone counts even when the other voices were not heard", () => {
  // One seat spoke and a shadow seat spoke. The voting seat was not alone.
  const rows = [W("UP", { A: "UP", SHADOW: "DOWN" })];
  assert.equal(seatLift(rows, "A", new Set(["A"])).solo, 0);
  assert.equal(seatLift([W("UP", { A: "UP" })], "A", new Set(["A"])).solo, 1);
});

test("the report says its tally is a proxy for the chair, not the chair", () => {
  const rows = Array.from({ length: 20 }, () => W("UP", { A: "UP", B: "DOWN", X: "UP" }));
  const r = redundancyReport(rows, ["A", "B", "X"], ["A", "B"]);
  assert.match(r.caveat, /PROXY for the chair/);
  assert.match(r.caveat, /weighs confidences against a bar/);
  assert.match(r.caveat, /simple majority of the 2 seats the chair can hear/);
  assert.equal(r.seats.find((s) => s.seat === "X")!.in_tally, false);
});
