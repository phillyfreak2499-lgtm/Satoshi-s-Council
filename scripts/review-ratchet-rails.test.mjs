/**
 * The seat-review ratchet, reproduced with the REAL learner functions.
 *
 * reviewSeats (learner.ts) runs every REVIEW_EVERY calls after FULL_N and
 * demotes a seat whose rolling scalp average is under EDGE_FLOOR: calibration
 * debt = seat_n and the lowest-EV LIVE card is benched. runHuddle then
 * un-benches a card with a good L20 to SHADOW, and with
 * AUTO_SKILL_PROMOTION_ENABLED false nothing returns it to LIVE. This rail
 * proves that path end to end on an authentic fixture (STRIKE's live legs of
 * 2026-09-22), pins the default of the freeze switch, and proves the frozen
 * branch prints its verdict without moving a status.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
function loader(deps = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (key) => {
      if (key in deps) return deps[key];
      assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
      const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
      return load(path.href.slice(root.href.length));
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, structuredClone, process: { env: {} }, console });
    return exports;
  }
  return load;
}
const load = loader();
const learnerMod = load("src/lib/desk/learner.ts");
const skills = load("src/lib/desk/skills.ts");
const math = load("src/lib/desk/math.ts");
const exposure = load("src/lib/desk/review-exposure.ts");

/** STRIKE past FULL_N calls; 20 rolling legs averaging +1.95¢ (the live legs on 2026-09-22). */
function fixture(calls = 700) {
  const learner = skills.freshLearner();
  learner.graded_windows = 1553;
  learner.learn_phase = "EXPLOIT";
  learner.seat_calls.STRIKE = calls;
  learner.seat_n.STRIKE = 210;
  learner.seat_hits.STRIKE = 175;
  learner.seat_scalp.STRIKE = { open: null, legs: [1, -19, 21, 16, 2, 16, 3, 14, -1, 9, 10, 4, -11, -15, 10, -32, -21, 9, 14, 9] };
  const card = learner.skills["STRIKE.itm_time"];
  card.status = "LIVE";
  Object.assign(card, { n: 1284, hits: 1219, ev_n: 1284, ev_sum: 1836, ev: 1.43, wilson: 0.936, last20: Array(20).fill(1), pocket: { US_PM_FINAL: { n: 355, hits: 341 } } });
  return learner;
}

test("the freeze switch defaults OFF in source and in the module: production behaviour is unchanged", () => {
  assert.match(read("src/lib/desk/learner.ts"), /export const SEAT_REVIEW_DEMOTION_FROZEN = false;/);
  assert.equal(learnerMod.SEAT_REVIEW_DEMOTION_FROZEN, false);
  assert.equal(learnerMod.AUTO_SKILL_PROMOTION_ENABLED, false);
  assert.deepEqual([math.EDGE_FLOOR, math.FULL_N, math.REVIEW_EVERY], [15, 700, 500]);
});

test("REPRODUCTION: at 700 calls the review benches the LIVE card and re-zeroes calibration; the huddle un-benches to SHADOW; nothing re-promotes", () => {
  const learner = fixture(700);
  const before = exposure.reviewExposure(learner).find((r) => r.seat === "STRIKE");
  assert.equal(before.would_demote, true);
  assert.equal(before.first_to_bench, "STRIKE.itm_time");

  const lines = learnerMod.reviewSeats(learner);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /STRIKE (1\.9|2\.0)¢ < 15¢ demote · bench STRIKE\.itm_time/);
  assert.equal(learner.skills["STRIKE.itm_time"].status, "BENCH");
  assert.equal(learner.seat_calib_debt.STRIKE, 210, "debt = seat_n: the seat is UNCALIBRATED again");
  assert.equal(learner.seat_review_at.STRIKE, 1200, "the next review is owed at 1200 calls");
  assert.ok(Object.values(learner.skills).some((c) => c.owner === "STRIKE" && c.id.startsWith("STRIKE.rethink_") && c.status === "SHADOW"), "a rethink SHADOW card is spawned");

  learnerMod.runHuddle(learner);
  assert.equal(learner.skills["STRIKE.itm_time"].status, "SHADOW", "L20 100% un-benches the card to SHADOW");
  for (let i = 0; i < 3; i += 1) learnerMod.runHuddle(learner);
  assert.equal(learner.skills["STRIKE.itm_time"].status, "SHADOW", "AUTO_SKILL_PROMOTION_ENABLED=false: the card never returns to LIVE");
  assert.equal(exposure.reviewExposure(learner).find((r) => r.seat === "STRIKE").live_cards.length, 0, "the seat has no LIVE directional card left");
});

test("at 699 calls nothing fires; a thin book holds; a passing average holds and pays down debt", () => {
  const early = fixture(699);
  assert.equal(learnerMod.reviewSeats(early).length, 0);
  assert.equal(early.skills["STRIKE.itm_time"].status, "LIVE");
  const thin = fixture(700);
  thin.seat_scalp.STRIKE = { open: null, legs: [1, 2, 3] };
  assert.match(learnerMod.reviewSeats(thin)[0], /hold \(thin book\)/);
  assert.equal(thin.skills["STRIKE.itm_time"].status, "LIVE");
  const rich = fixture(700);
  rich.seat_scalp.STRIKE = { open: null, legs: Array(20).fill(16) };
  rich.seat_calib_debt.STRIKE = 150;
  assert.match(learnerMod.reviewSeats(rich)[0], /\+16\.0¢ hold/);
  assert.equal(rich.seat_calib_debt.STRIKE, 50);
});

test("FROZEN branch (opt-in only): the verdict is printed, no status or debt moves, nothing benched is restored", () => {
  const learner = fixture(700);
  learner.skills["STREAK.continue_young"].status = "SHADOW"; // an earlier victim stays where it is
  const lines = learnerMod.reviewSeats(learner, { frozen: true });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /STRIKE (1\.9|2\.0)¢ < 15¢ would demote · FROZEN \(no change\) · would bench STRIKE\.itm_time/);
  assert.equal(learner.skills["STRIKE.itm_time"].status, "LIVE");
  assert.equal(learner.seat_calib_debt.STRIKE, undefined);
  assert.equal(learner.seat_review_at.STRIKE, 1200, "the review counter still advances: freezing is not skipping");
  assert.equal(learner.skills["STREAK.continue_young"].status, "SHADOW");
  assert.ok(!Object.values(learner.skills).some((c) => c.id.startsWith("STRIKE.rethink_")), "no rethink card is spawned while frozen");
});

test("the engine still calls reviewSeats with no override: the constant, not a call site, decides", () => {
  const engine = read("src/lib/desk/server-engine.ts");
  assert.match(engine, /reviewSeats\(e\.learner\);/);
  assert.doesNotMatch(engine, /reviewSeats\(e\.learner, \{/);
});
