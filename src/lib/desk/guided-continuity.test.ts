/**
 * Regressions for the Guided "what would change the decision?" card.
 *
 * The live WAIT card printed one condition twice:
 *
 *   • The evidence score still needs to clear the Council's required bar.
 *   • The evidence score still needs to clear the Council's required bar.
 *   More than one condition still needs to improve before the Council would act.
 *
 * Both lines came from the same fact. The `bar` gate is a hard gate, so a short
 * score fails it AND sets `more_than_one_thing_missing`, and the card then
 * appended the bar line a second time as the "other" blocker. These tests pin
 * the wording down to one bullet without letting genuinely separate blockers
 * collapse into each other.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { whatWouldChange, conditionFor, MULTI_BLOCKER_LINE } from "./guided-continuity.ts";
import { whyFacts } from "./floor-clarity.ts";
import type { ChairResult, Gate } from "./types.ts";

const gate = (id: string, label: string, pass = false): Gate => ({ id, label, pass, hard: true, value: "" });

function chair(over: Partial<ChairResult> = {}): ChairResult {
  return {
    lean: "WAIT",
    confidence: 40,
    score: 1.2,
    bar: 2,
    gates: [],
    hypothesis: "",
    evidence: [],
    counter: "",
    invalidate_if: "",
    wait_note: "",
    quorum: { up: 4, down: 3, wait: 8 },
    ...over,
  } as unknown as ChairResult;
}

const BAR = "The evidence score still needs to clear the Council's required bar.";
const QUIET = "The market is too quiet right now and needs to move more.";
const FRESH = "The desk's data sources need to pass their freshness check.";

// ---------------------------------------------------------------------------
// 1. Two internal causes, one sentence — the live defect.
// ---------------------------------------------------------------------------

test("the bar failing as a gate and the score being short print one bullet, not two", () => {
  // Exactly the live production state: `bar` is the only failing hard gate and
  // the score is under it, so the Chair's flag and the gate are one fact.
  const c = chair({ gates: [gate("bar", "|score| x aggressiveness >= confluence bar"), gate("quiet", "movement", true)] });
  assert.equal(whyFacts(c, "").more_than_one_thing_missing, true, "the upstream flag is unchanged");

  const w = whatWouldChange(c, "waiting");
  assert.deepEqual(w.conditions, [BAR]);
  assert.equal(new Set(w.conditions).size, w.conditions.length, "no bullet may repeat");
});

test("two different gates that share one beginner sentence print it once", () => {
  // `warden` and `semantic` deliberately map to the same freshness wording.
  const c = chair({ score: 3, gates: [gate("warden", "warden freshness"), gate("semantic", "semantic freshness")] });
  assert.equal(conditionFor(gate("warden", "x")), conditionFor(gate("semantic", "y")));

  const w = whatWouldChange(c, "waiting");
  assert.deepEqual(w.conditions, [FRESH]);
});

// ---------------------------------------------------------------------------
// 2. Genuinely distinct causes stay distinct.
// ---------------------------------------------------------------------------

test("a non-bar gate plus a short score keeps both bullets", () => {
  const c = chair({ gates: [gate("quiet", "movement")] });
  const w = whatWouldChange(c, "waiting");
  assert.deepEqual(w.conditions, [QUIET, BAR], "two different blockers, both named");
});

test("several distinct gates are all kept, in the order the Chair published them", () => {
  const c = chair({ score: 3, gates: [gate("spread", "spread"), gate("quiet", "movement"), gate("derivs", "derivs")] });
  const w = whatWouldChange(c, "waiting");
  assert.equal(w.conditions.length, 3);
  assert.equal(w.conditions[0], "The gap between the buying and selling price needs to narrow.");
  assert.equal(w.conditions[1], QUIET);
  assert.equal(w.conditions[2], "The derivatives feed needs to come back.");
});

// ---------------------------------------------------------------------------
// 3. The multi-condition caution tracks the real count, not the bullet count.
// ---------------------------------------------------------------------------

test("collapsing shared wording does not collapse the multi-condition fact", () => {
  // Two distinct gates are two unmet conditions even though they print as one
  // line, so the caution must survive the deduplication.
  const c = chair({ score: 3, gates: [gate("warden", "warden freshness"), gate("semantic", "semantic freshness")] });
  const w = whatWouldChange(c, "waiting");
  assert.equal(w.conditions.length, 1, "one bullet");
  assert.equal(w.multiple, true, "but still more than one condition");
  assert.match(MULTI_BLOCKER_LINE, /More than one condition/);
});

test("the caution is withheld when the bar alone is short, which is one condition", () => {
  const c = chair({ gates: [gate("bar", "score vs bar")] });
  const w = whatWouldChange(c, "waiting");
  assert.equal(w.conditions.length, 1);
  assert.equal(w.multiple, false, "one bullet must not be captioned 'more than one'");
});

test("the caution stays for two distinct blockers", () => {
  assert.equal(whatWouldChange(chair({ gates: [gate("quiet", "movement")] }), "w").multiple, true);
  assert.equal(
    whatWouldChange(chair({ score: 3, gates: [gate("quiet", "m"), gate("spread", "s")] }), "w").multiple,
    true,
  );
});

test("the caution is never raised where the Chair's own flag is false", () => {
  // The published flag is the ceiling: this card may narrow it, never widen it.
  for (const gates of [[], [gate("quiet", "m", true)], [gate("bar", "b")], [gate("quiet", "m")]]) {
    for (const score of [1.2, 3]) {
      const c = chair({ score, gates });
      const w = whatWouldChange(c, "waiting");
      if (w.multiple) {
        assert.equal(whyFacts(c, "").more_than_one_thing_missing, true, "narrower than the flag, never broader");
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 4. The directional path is unchanged.
// ---------------------------------------------------------------------------

test("a directional read still reports its support and its invalidation", () => {
  const c = chair({
    lean: "UP",
    score: 3,
    quorum: { up: 9, down: 2, wait: 5 },
    invalidate_if: "if spot loses the strike with under four minutes left",
  });
  const w = whatWouldChange(c, "reads UP");
  assert.equal(w.stance, "UP");
  assert.equal(w.invalidate, "spot loses the strike with under four minutes left");
  assert.ok(w.supports.some((s) => s.includes("9 of the Council's specialists currently read UP")));
  assert.ok(w.supports.some((s) => s.includes("Every hard condition")));
  assert.deepEqual(w.conditions, []);
});

test("DOWN is reported as DOWN and its counts are not swapped", () => {
  const c = chair({ lean: "DOWN", score: -3, quorum: { up: 2, down: 9, wait: 5 } });
  const w = whatWouldChange(c, "reads DOWN");
  assert.equal(w.stance, "DOWN");
  assert.ok(w.supports[0].includes("9 of the Council's specialists currently read DOWN, against 2 the other way"));
});

test("a directional read with shared-wording gates also deduplicates", () => {
  const c = chair({ lean: "UP", score: 3, gates: [gate("warden", "a"), gate("semantic", "b")] });
  assert.deepEqual(whatWouldChange(c, "reads UP").conditions, [FRESH]);
});

// ---------------------------------------------------------------------------
// 5. Fallbacks.
// ---------------------------------------------------------------------------

test("an unknown gate id still falls back to the Chair's own recorded label", () => {
  assert.equal(
    conditionFor(gate("brand-new-gate", "some recorded label")),
    "A desk condition is not met yet: some recorded label.",
  );
  assert.equal(conditionFor(gate("brand-new-gate", "")), "A desk condition is not met yet.");
});

test("an unknown gate is carried through the card rather than dropped", () => {
  const c = chair({ score: 3, gates: [gate("brand-new-gate", "some recorded label")] });
  assert.deepEqual(whatWouldChange(c, "waiting").conditions, ["A desk condition is not met yet: some recorded label."]);
});

test("no failing gate still explains the wait from the Chair's own reason", () => {
  const noEdge = chair({ score: 3, gates: [] });
  assert.deepEqual(whatWouldChange(noEdge, "waiting").conditions, [
    "The current price leaves too little room after costs.",
  ]);
  const underBar = chair({ score: 1.2, gates: [] });
  assert.deepEqual(whatWouldChange(underBar, "waiting").conditions, [
    "The specialists do not agree strongly enough yet.",
    BAR,
  ]);
});

// ---------------------------------------------------------------------------
// 6. Still no arithmetic of its own.
// ---------------------------------------------------------------------------

test("the card never publishes a probability, a score or a threshold", () => {
  const c = chair({ score: 1.2, bar: 2, confidence: 40, gates: [gate("quiet", "movement")] });
  const w = whatWouldChange(c, "waiting");
  const printed = [...w.conditions, ...w.supports, w.invalidate, w.closing].join(" ");
  for (const banned of ["1.2", "2.0", "40%", "probability", "chance", "likely", "expected value"]) {
    assert.ok(!printed.includes(banned), `must not print ${banned}`);
  }
  assert.match(w.closing, /would not by itself produce a call/);
});

test("the closing line still refuses the 'clear this one and it calls' reading", () => {
  const w = whatWouldChange(chair({ gates: [gate("quiet", "m")] }), "waiting");
  assert.match(w.closing, /every condition and the Council's bar still apply/);
});
