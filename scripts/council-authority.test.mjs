import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyAuthorityReview, admitCouncilVotes, countChairQuorum, directionalHoldReason, CLOSED_DIRECTIONAL_CARDS } from "../src/lib/desk/council-authority.ts";

const card = (over = {}) => ({
  status: "LIVE", n: 75, ev_n: 75, wilson: 0.8, ev: 2,
  pocket: { ASIA_FINAL: { n: 30, hits: 30 } }, ...over,
});
const vote = (over = {}) => ({
  seat: "DRIFT", lean: "DOWN", confidence: 58, skill_used: "DRIFT.read",
  skill_status: "LIVE", reasoning: "paper read", ...over,
});
const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("only an eligible mature LIVE predictive card may speak directionally", () => {
  const learner = { skills: { "DRIFT.read": card() } };
  assert.equal(directionalHoldReason(vote(), learner, "ASIA_FINAL"), null);
  assert.match(directionalHoldReason(vote({ skill_status: "SHADOW" }), learner, "ASIA_FINAL"), /no LIVE/);
  assert.match(directionalHoldReason(vote(), { skills: { "DRIFT.read": card({ status: "SHADOW" }) } }, "ASIA_FINAL"), /no LIVE/);
  assert.match(directionalHoldReason(vote(), { skills: {} }, "ASIA_FINAL"), /no LIVE/);
  assert.match(directionalHoldReason(vote(), { skills: { "DRIFT.read": card({ n: 20, ev_n: 20 }) } }, "ASIA_FINAL"), /50/);
  assert.match(directionalHoldReason(vote(), { skills: { "DRIFT.read": card({ wilson: 0.59 }) } }, "ASIA_FINAL"), /Wilson/);
  assert.match(directionalHoldReason(vote(), { skills: { "DRIFT.read": card({ ev: 1 }) } }, "ASIA_FINAL"), /EV/);
  assert.equal(directionalHoldReason(vote({ lean: "WAIT" }), learner, "EUROPE_MID"), null);
});

test("reviewed retired rules cannot regain paper-call authority through a future LIVE label", () => {
  const ids = ["ODDS.cheap_yes", "CHEAP.value", "FADE.60s_rip", "VEL.spot_lead"];
  assert.deepEqual(CLOSED_DIRECTIONAL_CARDS, new Set(ids));
  for (const id of ids) {
    const learner = { skills: { [id]: card({ status: "LIVE", n: 200, ev_n: 200, wilson: 0.9, ev: 8 }) } };
    const read = vote({ skill_used: id, skill_status: "LIVE" });
    assert.match(directionalHoldReason(read, learner, "ASIA_FINAL"), /retired directional rule/);
    assert.equal(admitCouncilVotes([read], learner, "ASIA_FINAL")[0].lean, "WAIT");
  }
  assert.equal(directionalHoldReason(vote({ skill_used: "VEL.spot_lead", lean: "WAIT" }),
    { skills: {} }, "ASIA_FINAL"), null, "WAIT research remains available");
});

test("a perfect late pocket cannot license an unseen regime", () => {
  const learner = { skills: { "DRIFT.read": card({ min_regime_n: 24 }) } };
  assert.equal(directionalHoldReason(vote(), learner, "ASIA_FINAL"), null);
  assert.match(directionalHoldReason(vote(), learner, "US_AM_MID"), /0\/24 in US_AM_MID/);
  assert.match(directionalHoldReason(vote(), { skills: { "DRIFT.read": card({ manual_hold: true }) } }, "ASIA_FINAL"), /held/);
});

test("a sticky or research side is a forced sit with preserved raw grading evidence", () => {
  const original = vote({ skill_status: "SHADOW", raw_lean: "DOWN", raw_conf: 58 });
  const other = vote({ seat: "STREAK", skill_used: "STREAK.read", lean: "UP" });
  const context = vote({ seat: "WARDEN", skill_used: "SIT", lean: "WAIT" });
  const learner = { skills: { "DRIFT.read": card({ status: "SHADOW" }), "STREAK.read": card() } };
  const results = admitCouncilVotes([original, other, context], learner, "ASIA_FINAL");
  assert.equal(results[0].lean, "WAIT");
  assert.equal(results[0].forced_sit, true);
  assert.equal(results[0].raw_lean, "DOWN");
  assert.equal(results[0].raw_conf, 58);
  assert.equal(results[0].skill_status, "SHADOW");
  assert.equal(results[1].lean, "UP");
  assert.equal(results[2], context);
  assert.equal(original.lean, "DOWN", "the learner's original paper read remains unchanged");
  assert.equal(results.filter((v) => v.lean === "DOWN").length, 0, "no false booking-side quorum");
});

test("forced sits and context seats are absent from the displayed Chair quorum", () => {
  const votes = [
    vote({ seat: "DRIFT", lean: "UP", skill_used: "DRIFT.read" }),
    vote({ seat: "WHALE", lean: "DOWN", skill_used: "WHALE.proxy", skill_status: "SHADOW" }),
    vote({ seat: "TAPE", lean: "WAIT", skill_used: "SIT" }),
    vote({ seat: "WARDEN", lean: "WAIT", skill_used: "SIT" }),
    vote({ seat: "CARRY", lean: "DOWN", skill_used: "CARRY.read" }),
  ];
  const learner = { skills: { "DRIFT.read": card(), "WHALE.proxy": card({ status: "SHADOW" }),
    "CARRY.read": card() } };
  const admitted = admitCouncilVotes(votes, learner, "ASIA_FINAL");
  assert.equal(admitted[1].forced_sit, true);
  assert.deepEqual(countChairQuorum(admitted, new Set(["CARRY"]), new Set(["WARDEN", "ORBIT", "WIRE"])),
    { up: 1, down: 0, wait: 1 });
  const chair = source("src/lib/desk/chair.ts");
  assert.match(chair, /const quorum = countChairQuorum\(votes, muted, CHAIR_NON_VOTERS\);/);
});

test("saved authority review applies once without resetting evidence or disabling guards", () => {
  const learner = { skills: {
    "WHALE.proxy": card({ n: 65, ev_n: 65, wilson: 0.40379420402276267, ev: -0.9846153846153847 }),
    "STRIKE.rethink_zj9p": card({ n: 291 }),
    "CHAIN.oi_against": card({ status: "SHADOW", n: 267 }),
    "FADE.60s_rip": card({ status: "BENCH", n: 235 }),
    "WARDEN.semantic": card({ n: 0, ev_n: 0 }),
  }, seat_w: { WHALE: 0.2 }, graded_windows: 955 };
  assert.equal(applyAuthorityReview(learner), true);
  assert.equal(learner.skills["WHALE.proxy"].status, "SHADOW");
  assert.equal(learner.skills["STRIKE.rethink_zj9p"].status, "SHADOW");
  assert.equal(learner.skills["CHAIN.oi_against"].status, "BENCH");
  assert.equal(learner.skills["FADE.60s_rip"].status, "BENCH");
  assert.equal(learner.skills["WARDEN.semantic"].status, "LIVE");
  assert.equal(learner.skills["WHALE.proxy"].n, 65);
  assert.equal(learner.seat_w.WHALE, 0.2);
  assert.equal(learner.graded_windows, 955);
  learner.skills["STRIKE.rethink_zj9p"].status = "BENCH";
  assert.equal(applyAuthorityReview(learner), false);
  assert.equal(learner.skills["STRIKE.rethink_zj9p"].status, "BENCH", "future owner decisions are not overwritten");
});

test("the production path normalizes before scoring and freezes automatic promotions", () => {
  const bots = source("src/lib/desk/bots.ts");
  const chair = source("src/lib/desk/chair.ts");
  const learner = source("src/lib/desk/learner.ts");
  const persist = source("src/lib/desk/persist.ts");
  assert.match(bots, /const pool = liveSkills\(learner, seat\)\.filter/);
  assert.match(chair, /votes = admitCouncilVotes\(votes, learner, snap\.regime_key\);/);
  assert.ok(chair.indexOf("votes = admitCouncilVotes(") < chair.indexOf("const accs: Acc[]"));
  assert.match(learner, /export const AUTO_SKILL_PROMOTION_ENABLED = false;/);
  assert.match(learner, /const promote = AUTO_SKILL_PROMOTION_ENABLED/);
  assert.match(learner, /AUTO_SKILL_PROMOTION_ENABLED &&\s*card\.n >= promoNeed\.n/);
  assert.match(learner, /!CLOSED_DIRECTIONAL_CARDS\.has\(card\.id\)/);
  assert.match(persist, /applyAuthorityReview\(learner\);/);
});
