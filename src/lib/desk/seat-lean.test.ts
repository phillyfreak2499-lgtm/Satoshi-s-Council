/**
 * Directional Lean — read-model tests.
 *
 * The meter is a mirror of the seat's own raw read, never a second opinion:
 * UP above 50, DOWN below, WAIT at 50, no read as no number. A read the Chair
 * never heard stays visible as research context; a SHADOW or benched read
 * never becomes a vote; a DOWN feed is NO READ; a stale feed is flagged, not
 * hidden; nothing crosses a window boundary; and the input is never mutated.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIRECTIONAL_LEAN_DISCLAIMER,
  DIRECTIONAL_LEAN_LABEL,
  DIRECTION_WORD,
  leanDirection,
  leanIsCurrent,
  leanScore,
  leanValueText,
  researchReadWord,
  seatDirectionalLean,
  seatDirectionalLeans,
} from "./seat-lean.ts";
import { seatFactFor } from "./pro-floor.ts";
import { SPEAK_CONF } from "./math.ts";
import type { SeatFact } from "./pro-floor";
import type { SeatRow, Vote } from "./types";

const WINDOW = { ticker: "KXBTC15M-26SEP2514-T85000", close_time: 1_790_000_000_000, as_of: 1_789_999_500_000 };
const NEXT = { ticker: "KXBTC15M-26SEP2515-T85100", close_time: WINDOW.close_time + 900_000, as_of: WINDOW.close_time + 5_000 };

function fact(over: Partial<SeatFact> = {}): SeatFact {
  return {
    seat: "DRIFT",
    callsign: "VEC",
    family: "structure",
    eyes: "ret 5/15/30",
    raw_lean: "UP",
    raw_conf: 70,
    final_lean: "UP",
    final_conf: 70,
    final_conf_transformed: false,
    voice: "speaking",
    suppression: null,
    health_warning: false,
    speak_bar: SPEAK_CONF,
    aggregated: true,
    health: "LIVE",
    status: "LIVE",
    weight: 0.1,
    contribution: 0.07,
    why: "trend holds on 15/30",
    skill_used: "DRIFT.aligned_3h",
    skill_status: "LIVE",
    ...over,
  };
}

function vote(over: Partial<Vote> = {}): Vote {
  return {
    seat: "DRIFT",
    lean: "UP",
    confidence: 70,
    features: {},
    reasoning: "trend holds on 15/30",
    skill_used: "DRIFT.aligned_3h",
    skill_status: "LIVE",
    shadow: null,
    paper: [],
    thresh_used: [],
    skill_n: 40,
    skill_hits: 24,
    skill_wilson: 0.46,
    hypothesis: "aligned drift",
    evidence: ["ret15 > 0"],
    counter: "",
    invalidate_if: "ret5 flips",
    health: "LIVE",
    feed_age_s: 1.2,
    eyes: "ret 5/15/30",
    phase: "MID",
    raw_lean: "UP",
    raw_conf: 70,
    ...over,
  };
}

function row(over: Partial<SeatRow> = {}): SeatRow {
  return {
    rank: 1, wilson_rank: 1, contrib_rank: 1, scalp_avg: null, scalp_n: 0, calib_n: 40, calib: 1, calls: 3,
    seat: "DRIFT", callsign: "VEC", lean: "UP", forced_sit: false, conf: 70, skill_used: "DRIFT.aligned_3h",
    base_w: 0.07, weight: 0.1, listen: 1, health: "LIVE", signed: 1, contribution: 0.07, shadow_lean: null,
    why: "trend holds on 15/30", status: "LIVE", folded: false,
    ...over,
  } as SeatRow;
}

test("1. an UP raw read maps above 50, with the documented formula", () => {
  assert.equal(leanScore("UP", 70), 85);
  const l = seatDirectionalLean(fact(), WINDOW);
  assert.equal(l.score, 85);
  assert.equal(l.direction, "BULLISH");
  assert.equal(l.researchSide, "UP");
  assert.equal(l.sourceStrength, 70);
  assert.ok((l.score ?? 0) > 50);
});

test("2. a DOWN raw read maps below 50", () => {
  assert.equal(leanScore("DOWN", 70), 15);
  const l = seatDirectionalLean(fact({ raw_lean: "DOWN", final_lean: "DOWN" }), WINDOW);
  assert.equal(l.score, 15);
  assert.equal(l.direction, "BEARISH");
  assert.equal(researchReadWord(l), "DOWN");
});

test("3. WAIT maps to 50 and NEUTRAL; an absent raw read is NO READ with no number", () => {
  assert.equal(leanScore("WAIT", 0), 50);
  assert.equal(leanScore("WAIT", 88), 50, "a WAIT never carries intensity");
  assert.equal(leanScore(null, 70), null);
  const sit = seatDirectionalLean(fact({ raw_lean: "WAIT", raw_conf: 0, final_lean: "WAIT", voice: "waiting", skill_used: "SIT", skill_status: "SIT" }), WINDOW);
  assert.equal(sit.score, 50);
  assert.equal(sit.direction, "NEUTRAL");
  assert.equal(sit.status, "SIT");
  assert.equal(researchReadWord(sit), "NEUTRAL");
  const none = seatDirectionalLean(fact({ raw_lean: null, raw_conf: null, final_lean: "WAIT", voice: "waiting" }), WINDOW);
  assert.equal(none.score, null);
  assert.equal(none.direction, "NO_READ");
  assert.equal(researchReadWord(none), "NO READ");
  assert.equal(leanDirection(null), "NO_READ");
});

test("4. equal UP and DOWN strengths mirror around 50", () => {
  for (const s of [0, 1, 3, 25, 45, 52, 70, 91, 92]) {
    const up = leanScore("UP", s)!;
    const down = leanScore("DOWN", s)!;
    assert.equal(up - 50, 50 - down, `strength ${s} mirrors`);
  }
});

test("5. the score clamps to 0–100 and rounds to a whole number", () => {
  assert.equal(leanScore("UP", 100), 100);
  assert.equal(leanScore("UP", 250), 100);
  assert.equal(leanScore("DOWN", 250), 0);
  assert.equal(leanScore("UP", -30), 50, "a negative strength has no intensity");
  assert.equal(leanScore("UP", Number.NaN), 50);
  assert.equal(leanScore("UP", 45), 73);
  assert.equal(leanScore("DOWN", 45), 27);
  for (const s of [0, 3.3, 45, 92, 1000]) {
    const v = leanScore("UP", s)!;
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
  }
});

test("6. a raw direction held below the speak bar stays visible as research context, from the real pipeline shape", () => {
  // The vote as bots.ts leaves it on a forced sit: lean WAIT, confidence rewritten to max(70, raw), raw fields kept.
  const v = vote({ lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "UP", raw_conf: 45, reasoning: "aligned drift · sit (45 < 52 conf)" });
  const r = row({ lean: "WAIT", forced_sit: true, conf: 70 });
  const f = seatFactFor("DRIFT", v, r, undefined, WINDOW.as_of);
  assert.equal(f.voice, "suppressed");
  assert.equal(f.suppression, "below-speak-bar");
  const l = seatDirectionalLean(f, WINDOW);
  assert.equal(l.score, 73);
  assert.equal(l.direction, "BULLISH");
  assert.equal(l.researchSide, "UP");
  assert.equal(l.status, "BELOW BAR");
  assert.equal(l.isAuthorizedSpeaker, false);
  assert.equal(l.heardLean, "WAIT", "what the Chair heard is kept apart from the research side");
  assert.equal(l.sourceStrength, 45, "the seat's own strength, not the rewritten 70");
  assert.match(l.statusPlain, /SATOSHI did not hear this vote/);
});

test("6b. a forced sit without a retained raw read is never reconstructed", () => {
  const v = vote({ lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: undefined, raw_conf: undefined });
  const f = seatFactFor("DRIFT", v, row({ lean: "WAIT", forced_sit: true, conf: 70 }), undefined, WINDOW.as_of);
  const l = seatDirectionalLean(f, WINDOW);
  assert.equal(l.score, null);
  assert.equal(l.direction, "NO_READ");
  assert.equal(l.researchSide, null);
});

test("7. SHADOW and BENCH reads are research only and never an authorized speaker", () => {
  const shadow = seatDirectionalLean(fact({ voice: "suppressed", suppression: "below-speak-bar", skill_status: "SHADOW", final_lean: "WAIT", final_conf_transformed: true }), WINDOW);
  assert.equal(shadow.status, "SHADOW");
  assert.equal(shadow.isAuthorizedSpeaker, false);
  assert.equal(shadow.score, 85, "the research read is still shown");
  assert.equal(shadow.heardLean, "WAIT");
  const bench = seatDirectionalLean(fact({ voice: "benched", suppression: "benched", final_lean: "WAIT", final_conf_transformed: true }), WINDOW);
  assert.equal(bench.status, "BENCH");
  assert.equal(bench.isAuthorizedSpeaker, false);
  const muted = seatDirectionalLean(fact({ voice: "muted", suppression: "muted", status: "MUTED", weight: 0 }), WINDOW);
  assert.equal(muted.status, "MUTED");
  assert.equal(muted.isAuthorizedSpeaker, false);
  const retired = seatDirectionalLean(fact({ seat: "ODDS", voice: "retired", suppression: "retired", aggregated: false }), WINDOW);
  assert.equal(retired.status, "RETIRED");
  const crew = seatDirectionalLean(fact({ seat: "WARDEN", voice: "non-voter", aggregated: false }), WINDOW);
  assert.equal(crew.status, "NON-VOTER");
  assert.equal(crew.isAuthorizedSpeaker, false);
  // Only the Chair's own aggregation makes a speaker.
  const speaking = seatDirectionalLean(fact(), WINDOW);
  assert.equal(speaking.status, "SPEAKING");
  assert.equal(speaking.isAuthorizedSpeaker, true);
});

test("8. a DOWN feed is NO READ; a STALE feed keeps its honest read and is flagged", () => {
  const down = seatDirectionalLean(fact({ voice: "unhealthy", suppression: "feed", health: "DOWN", raw_lean: "WAIT", raw_conf: 0, final_lean: "WAIT", final_conf: 0 }), WINDOW);
  assert.equal(down.score, null);
  assert.equal(down.direction, "NO_READ");
  assert.equal(down.status, "DOWN");
  assert.equal(down.stale, false);
  // Even a lingering raw field cannot stand once the feed is DOWN: applyHealth silenced the seat first.
  const downLinger = seatDirectionalLean(fact({ voice: "unhealthy", health: "DOWN", raw_lean: "UP", raw_conf: 60 }), WINDOW);
  assert.equal(downLinger.score, null);
  assert.equal(downLinger.researchSide, null);
  const stale = seatDirectionalLean(fact({ health: "STALE", health_warning: true, raw_conf: 42, final_conf: 42 }), WINDOW);
  assert.equal(stale.stale, true);
  assert.equal(stale.score, 71);
  assert.equal(stale.status, "SPEAKING", "a STALE speaker the Chair heard is still a speaker, with the warning beside it");
  assert.match(leanValueText(stale), /stale feed/);
});

test("9. nothing carries across a window: a lean is stamped and refused for another ticker or close", () => {
  const l = seatDirectionalLean(fact(), WINDOW);
  assert.deepEqual(l.window, WINDOW);
  assert.equal(leanIsCurrent(l, WINDOW), true);
  assert.equal(leanIsCurrent(l, NEXT), false);
  assert.equal(leanIsCurrent(l, { ...WINDOW, close_time: WINDOW.close_time + 1 }), false);
  assert.equal(leanIsCurrent(l, { ...WINDOW, ticker: "OTHER" }), false);
  // A fresh frame for the next window is built only from that frame's facts.
  const next = seatDirectionalLeans([fact({ raw_lean: "WAIT", raw_conf: 0, final_lean: "WAIT", voice: "waiting" })], NEXT);
  assert.equal(next[0].score, 50);
  assert.equal(next[0].window.ticker, NEXT.ticker);
});

test("10. the helper never mutates its input and is deterministic", () => {
  const f = fact({ health: "STALE", health_warning: true });
  const before = JSON.stringify(f);
  const a = seatDirectionalLean(f, WINDOW);
  const b = seatDirectionalLean(f, WINDOW);
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(a, b);
  assert.notEqual(a, b, "a fresh object each call");
  const w = { ...WINDOW };
  seatDirectionalLean(f, w);
  assert.deepEqual(w, WINDOW);
});

test("11. the copy says what the number is not", () => {
  assert.equal(DIRECTIONAL_LEAN_LABEL, "DIRECTIONAL LEAN");
  assert.equal(DIRECTIONAL_LEAN_DISCLAIMER, "Directional Lean shows research direction and intensity. It is not a probability and not a SATOSHI call.");
  const l = seatDirectionalLean(fact(), WINDOW);
  assert.equal(l.disclaimer, DIRECTIONAL_LEAN_DISCLAIMER);
  const text = leanValueText(l);
  assert.match(text, /Directional Lean 85 of 100, bullish, research read UP/);
  for (const banned of [/confidence/i, /probabilit/i, /win chance/i, /\bodds\b/i, /\bchance\b/i]) {
    assert.doesNotMatch(text, banned);
    assert.doesNotMatch(l.statusPlain, banned);
    for (const w of Object.values(DIRECTION_WORD)) assert.doesNotMatch(w, banned);
  }
});
