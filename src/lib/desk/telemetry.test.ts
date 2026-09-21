import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChairEvalRow,
  buildSeatReadRows,
  chairWaitReason,
  classifySuppression,
  effectiveSpeakBar,
  isEligibleVoter,
  SUPPRESSION_REASONS,
} from "./telemetry.ts";
import type { ChairResult, Gate, Learner, SeatRow, Snapshot, Vote } from "./types.ts";

const AS_OF = Date.parse("2026-09-21T15:00:00Z");
const CLOSE = AS_OF + 6 * 60_000;

function learner(knobs: Learner["knobs"] = {}): Learner {
  return { knobs } as unknown as Learner;
}

function vote(o: Partial<Vote>): Vote {
  return {
    seat: "WICK",
    lean: "WAIT",
    confidence: 0,
    features: {},
    reasoning: "",
    skill_used: "WICK.pin_at_high",
    skill_status: "LIVE",
    shadow: null,
    paper: [],
    thresh_used: [],
    skill_n: 0,
    skill_hits: 0,
    skill_wilson: 0,
    hypothesis: "",
    evidence: [],
    counter: "",
    invalidate_if: "",
    health: "LIVE",
    feed_age_s: 0,
    eyes: "",
    phase: "MID",
    ...o,
  } as Vote;
}

/** A directional read that the whisper filter gagged below the speak bar. */
function gagged(seat: string, raw: "UP" | "DOWN", rawConf: number): Vote {
  return vote({
    seat: seat as Vote["seat"],
    lean: "WAIT",
    confidence: 70,
    forced_sit: true,
    raw_lean: raw,
    raw_conf: rawConf,
  });
}

function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    ticker: "KXBTC15M-26SEP211500-45",
    close_time: CLOSE,
    as_of: AS_OF,
    phase: "MID",
    mins_left: 6,
    secs_left: 360,
    demo: false,
    ...o,
  } as unknown as Snapshot;
}

function seatRow(o: Partial<SeatRow>): SeatRow {
  return { seat: "WICK", weight: 0.1, status: "LIVE", contribution: 0, ...o } as unknown as SeatRow;
}

function gate(id: string, pass: boolean, hard: boolean, value = ""): Gate {
  return { id, label: id, pass, hard, value };
}

function chair(o: Partial<ChairResult> = {}): ChairResult {
  return {
    lean: "WAIT",
    confidence: 80,
    score: 0.1,
    bar: 0.5,
    bar_breakdown: {
      base: 0.3,
      quiet: 0.08,
      weekend: 0,
      phase: 0,
      law_miss1: 0,
      calib_tax: 0,
      sit_mass: 0.12,
      knn: 0,
      pre_clamp: 0.5,
      final: 0.5,
    },
    vs_bar: 0.09,
    dir_mass: 0.1,
    sit_total_mass: 0.6,
    aggressiveness: 0.9,
    time_factor: 0.78,
    diversity: 1,
    sit_mass: 0.6,
    conflict_frac: 0,
    categories_agree: 0,
    hard_fail: false,
    size: 1,
    gates: [gate("bar", false, true, "|0.10| × 0.90 = 0.09 vs bar 0.50")],
    rows: [],
    ...o,
  } as unknown as ChairResult;
}

// ---------------------------------------------------------------------------
// Suppression classification (structured reason codes, numerically derived)
// ---------------------------------------------------------------------------

test("1. directional read below 52 keeps its direction/confidence and is confidence-gagged", () => {
  const v = gagged("CARRY", "UP", 50);
  assert.equal(classifySuppression(v, learner(), AS_OF), "below_speak_conf");
  const [row] = buildSeatReadRows(snap(), [v], chair(), learner());
  assert.equal(row.raw_lean, "UP"); // original direction retained
  assert.equal(row.raw_conf, 50); // original confidence retained
  assert.equal(row.final_lean, "WAIT");
  assert.equal(row.passed_speak, false);
  assert.equal(row.effective_speak_threshold, 52);
  assert.equal(row.suppression_reason, "below_speak_conf");
});

test("2. directional read at/above threshold is recorded as spoke", () => {
  const v = vote({ seat: "CHAIN", lean: "UP", confidence: 61, raw_lean: "UP", raw_conf: 61 });
  assert.equal(classifySuppression(v, learner(), AS_OF), "spoke");
  const [row] = buildSeatReadRows(snap(), [v], chair(), learner());
  assert.equal(row.passed_speak, true);
  assert.equal(row.final_lean, "UP");
  assert.equal(row.suppression_reason, "spoke");
});

test("3. no-skill WAIT is distinguishable from a confidence-gag WAIT", () => {
  const noSkill = vote({ seat: "PULSE", lean: "WAIT", skill_used: "SIT", raw_lean: "WAIT", raw_conf: 0 });
  const gag = gagged("CARRY", "DOWN", 49);
  assert.equal(classifySuppression(noSkill, learner(), AS_OF), "no_skill_fired");
  assert.equal(classifySuppression(gag, learner(), AS_OF), "below_speak_conf");
  assert.notEqual(
    classifySuppression(noSkill, learner(), AS_OF),
    classifySuppression(gag, learner(), AS_OF),
  );
});

test("4. retired / non-voter / eligibility suppression stay distinct", () => {
  // retired seat with a strong raw read is still 'retired', not 'spoke'
  const retired = vote({ seat: "FADE", lean: "WAIT", forced_sit: true, raw_lean: "UP", raw_conf: 80 });
  assert.equal(classifySuppression(retired, learner(), AS_OF), "retired");
  // pit-crew non-voter
  const nonVoter = vote({ seat: "ORBIT", lean: "WAIT", forced_sit: true, raw_lean: "DOWN", raw_conf: 70 });
  assert.equal(classifySuppression(nonVoter, learner(), AS_OF), "non_voter");
  // eligibility hold: directional AT/ABOVE the bar, still forced to sit
  const eligible = gagged("STRIKE", "UP", 66);
  assert.equal(classifySuppression(eligible, learner(), AS_OF), "eligibility_hold");
  assert.equal(isEligibleVoter("FADE"), false);
  assert.equal(isEligibleVoter("ORBIT"), false);
  assert.equal(isEligibleVoter("STRIKE"), true);
});

test("4b. feed_down, feed_stale, coach_bench and raw_wait each classify", () => {
  assert.equal(classifySuppression(vote({ seat: "TAPE", health: "DOWN", raw_lean: "UP", raw_conf: 60 }), learner(), AS_OF), "feed_down");
  assert.equal(classifySuppression(vote({ seat: "TAPE", health: "STALE", lean: "WAIT", raw_lean: "WAIT", skill_used: "TAPE.persist_imbalance", raw_conf: 0 }), learner(), AS_OF), "feed_stale");
  const benched = learner({ TAPE: { edge_mult: 1, benched_until: AS_OF + 60_000, speak_offset: 0, prev_offset: null, updated_at: 0, reason: "" } });
  assert.equal(classifySuppression(gagged("TAPE", "UP", 40), benched, AS_OF), "coach_bench");
  assert.equal(classifySuppression(vote({ seat: "DRIFT", lean: "WAIT", raw_lean: "WAIT", raw_conf: 0 }), learner(), AS_OF), "raw_wait");
});

test("5b. COACH speak_offset shifts the effective threshold and passed_speak", () => {
  const l = learner({ CARRY: { edge_mult: 1, benched_until: 0, speak_offset: -4, prev_offset: null, updated_at: 0, reason: "" } });
  assert.deepEqual(effectiveSpeakBar(l, "CARRY"), { bar: 48, offset: -4 });
  // raw 50 now clears the lowered 48 bar → not below_speak_conf
  const v = vote({ seat: "CARRY", lean: "UP", confidence: 50, raw_lean: "UP", raw_conf: 50 });
  const [row] = buildSeatReadRows(snap(), [v], chair(), l);
  assert.equal(row.effective_speak_threshold, 48);
  assert.equal(row.passed_speak, true);
});

// ---------------------------------------------------------------------------
// Chair eval capture (numeric fields, not parsed strings)
// ---------------------------------------------------------------------------

test("5. sit_mass and its exact bar contribution are captured numerically", () => {
  const c = chair({ sit_mass: 0.6, bar_breakdown: { ...chair().bar_breakdown, sit_mass: 0.2 * 0.6 } });
  const row = buildChairEvalRow(snap(), [], c, c);
  assert.equal(row.sit_mass, 0.6);
  assert.equal(row.bar_sit_mass, 0.2 * 0.6);
});

test("6. every other bar modifier is captured as its own numeric field", () => {
  const bd = { base: 0.3, quiet: 0.08, weekend: 0.04, phase: -0.04, law_miss1: 0.06, calib_tax: 0.04, sit_mass: 0.1, knn: 0.03, pre_clamp: 0.61, final: 0.61 };
  const row = buildChairEvalRow(snap(), [], chair({ bar_breakdown: bd }), chair({ bar_breakdown: bd }));
  assert.equal(row.bar_base, 0.3);
  assert.equal(row.bar_quiet, 0.08);
  assert.equal(row.bar_weekend, 0.04);
  assert.equal(row.bar_phase, -0.04);
  assert.equal(row.bar_law_miss1, 0.06);
  assert.equal(row.bar_calib_tax, 0.04);
  assert.equal(row.bar_knn, 0.03);
  assert.equal(row.bar_pre_clamp, 0.61);
  assert.equal(row.bar_final, 0.61);
});

test("6b. speaker counts and wait reason derive from votes/gates", () => {
  const votes = [
    vote({ seat: "CHAIN", lean: "UP", raw_lean: "UP", raw_conf: 60 }),
    vote({ seat: "CARRY", lean: "DOWN", raw_lean: "DOWN", raw_conf: 60 }),
    gagged("WICK", "UP", 40),
    vote({ seat: "ORBIT", lean: "WAIT" }), // non-voter, excluded from counts
  ];
  const row = buildChairEvalRow(snap(), votes, chair(), chair());
  assert.equal(row.up_speakers, 1);
  assert.equal(row.down_speakers, 1);
  assert.equal(row.speaker_count, 2);
  assert.equal(row.eligible_voter_count, 3); // CHAIN, CARRY, WICK (ORBIT not eligible)
  assert.equal(row.silent_count, 1);
  assert.equal(row.wait_reason, "hard:bar"); // the failing hard gate
});

test("6c. wait_reason is empty for a directional final call", () => {
  assert.equal(chairWaitReason(chair({ lean: "UP" })), "");
});

// ---------------------------------------------------------------------------
// ABSOLUTE INVARIANT — the telemetry read path mutates nothing
// ---------------------------------------------------------------------------

test("7. builders never mutate the snapshot, votes, or ChairResult", () => {
  const s = snap();
  const votes = [
    vote({ seat: "CHAIN", lean: "UP", raw_lean: "UP", raw_conf: 60 }),
    gagged("CARRY", "DOWN", 50),
    vote({ seat: "ORBIT", lean: "WAIT" }),
  ];
  const c = chair({ rows: [seatRow({ seat: "CHAIN", weight: 0.2, contribution: 0.12 })] });
  const sBefore = structuredClone(s);
  const vBefore = structuredClone(votes);
  const cBefore = structuredClone(c);

  buildSeatReadRows(s, votes, c, learner());
  buildChairEvalRow(s, votes, c, c);
  for (const v of votes) classifySuppression(v, learner(), s.as_of);

  assert.deepEqual(s, sBefore, "snapshot unchanged");
  assert.deepEqual(votes, vBefore, "votes unchanged");
  assert.deepEqual(c, cBefore, "ChairResult unchanged");
});

test("8. suppression reason set is closed and every classification is a member", () => {
  const set = new Set<string>(SUPPRESSION_REASONS);
  const samples: Vote[] = [
    vote({ seat: "CHAIN", lean: "UP", raw_lean: "UP", raw_conf: 60 }),
    gagged("CARRY", "UP", 50),
    gagged("STRIKE", "UP", 66),
    vote({ seat: "FADE", forced_sit: true, raw_lean: "UP", raw_conf: 80 }),
    vote({ seat: "ORBIT" }),
    vote({ seat: "PULSE", skill_used: "SIT", raw_lean: "WAIT", raw_conf: 0 }),
    vote({ seat: "TAPE", health: "DOWN" }),
  ];
  for (const v of samples) assert.ok(set.has(classifySuppression(v, learner(), AS_OF)), `reason for ${v.seat}`);
});
