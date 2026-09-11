import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPONENT_MIN,
  COOLDOWN,
  correctedAlpha,
  cvar,
  dayBlockCI,
  delta,
  ECONOMIC,
  evaluateComponentGates,
  FULL_FLOOR_MIN,
  gateSummary,
  maxDrawdown,
  PROBATION,
  REGIME,
  RISK,
  ROLLBACK,
  STABILITY,
  regimeGate,
  type ComponentEvidence,
  type Pair,
} from "./promotion-gates.ts";

// ---------------------------------------------------------------------------
// THE FREEZE. A threshold moves only as a reviewed code change — never because a
// candidate is close to clearing it.
// ---------------------------------------------------------------------------

test("FREEZE: every promotion threshold is exactly as specified", () => {
  assert.deepEqual({ ...COMPONENT_MIN }, { fills: 250, paired_control_losses: 25, days: 30 });
  assert.deepEqual({ ...FULL_FLOOR_MIN }, { windows: 500, directional_calls: 100, days: 30 });
  assert.equal(ECONOMIC.min_avg_net_cents, 0);
  assert.equal(ECONOMIC.min_paired_delta_cents, 1.0);
  assert.equal(ECONOMIC.confidence, 0.95);
  assert.equal(RISK.max_drawdown_ratio, 0.75);
  assert.equal(RISK.cvar_improvement, 0.2);
  assert.equal(RISK.cvar_pct, 10);
  assert.equal(RISK.catastrophic_rate_ratio, 0.6);
  assert.equal(RISK.catastrophic_cents, -30);
  assert.equal(RISK.worst_loss_slack_cents, 5);
  assert.equal(REGIME.min_paired, 30);
  assert.equal(REGIME.max_trail_cents, 2.0);
  assert.equal(STABILITY.consecutive_daily_evaluations, 3);
  assert.equal(COOLDOWN.eligible_fills, 100);
  assert.equal(PROBATION.active_fills, 100);
  assert.deepEqual(
    { ...ROLLBACK },
    { min_paired_calls: 50, trails_by_cents: -1.5, drawdown_worse_ratio: 1.5, catastrophic_rate_worse_ratio: 1.5 },
  );
});

test("thresholds cannot be mutated at runtime", () => {
  assert.throws(() => {
    (COMPONENT_MIN as unknown as { fills: number }).fills = 1;
  });
  assert.equal(COMPONENT_MIN.fills, 250);
});

// ---------------------------------------------------------------------------
// Statistics.
// ---------------------------------------------------------------------------

test("drawdown is a path property, measured in order", () => {
  // +10, -30, +5: cumulative 10, -20, -15. Peak 10, trough -20, so the worst
  // peak-to-trough run is -30 — not the -15 the series ends at.
  assert.equal(maxDrawdown([10, -30, 5]), -30);
  assert.equal(maxDrawdown([5, 5, 5]), 0, "a series that only rises has no drawdown");
  assert.equal(maxDrawdown([]), 0);
  // Sorting destroys it, which is why the caller must pass chronological data. A
  // reversal often coincides by accident, so this uses a pair that genuinely differs:
  // interleaved swings peak and recover, while the sorted version front-loads every
  // loss into one uninterrupted run.
  assert.equal(maxDrawdown([30, -40, 30, -40, 50]), -50, "as it happened");
  assert.equal(maxDrawdown([-40, -40, 30, 30, 50]), -80, "the same windows, sorted");
});

test("CVaR averages the worst tail and refuses to invent one", () => {
  const xs = [-50, -40, -30, 5, 5, 5, 5, 5, 5, 5];
  // 10% of 10 observations is the single worst.
  assert.equal(cvar(xs, 10), -50);
  assert.equal(cvar(xs, 30), Math.round(((-50 - 40 - 30) / 3) * 100) / 100);
  // Too few observations for a tail to mean anything.
  assert.equal(cvar([-50, 5], 10), null);
  assert.equal(cvar([], 10), null);
});

test("the bootstrap resamples days, not windows", () => {
  // Same 40 paired deltas. Spread over 10 days the interval is wide; all on ONE day
  // it is not computable, because one day says nothing about day-to-day variation.
  const spread: Pair[] = [];
  for (let d = 0; d < 10; d++) {
    for (let i = 0; i < 4; i++) {
      spread.push({ day: `2026-09-${String(d + 1).padStart(2, "0")}`, candidate_net: 2, champion_net: 0 });
    }
  }
  const oneDay: Pair[] = spread.map((p) => ({ ...p, day: "2026-09-01" }));
  const a = dayBlockCI(spread, 0.05, 500, 1);
  const b = dayBlockCI(oneDay, 0.05, 500, 1);
  assert.ok(a);
  assert.equal(a.days, 10);
  assert.equal(b, null, "a single day cannot produce a confidence interval");
});

test("the bootstrap widens when days disagree", () => {
  // Ten consistent days vs ten wildly inconsistent ones with the same mean.
  const mk = (vals: number[]): Pair[] =>
    vals.map((v, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, candidate_net: v, champion_net: 0 }));
  const tight = dayBlockCI(mk([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]), 0.05, 1000, 7)!;
  const wild = dayBlockCI(mk([-20, 24, -20, 24, -20, 24, -20, 24, -20, 24]), 0.05, 1000, 7)!;
  assert.equal(tight.point, 2);
  assert.equal(wild.point, 2);
  assert.ok(hi(wild) - wild.lo > hi(tight) - tight.lo, "disagreeing days must widen the interval");
  assert.ok(tight.lo > 0, "ten consistent days clear zero");
  assert.ok(wild.lo < 0, "the same mean from wild days does not");
});
const hi = (i: { hi: number }) => i.hi;

test("the bootstrap is reproducible from the same data and seed", () => {
  const pairs: Pair[] = [];
  for (let d = 0; d < 8; d++) {
    pairs.push({ day: `2026-09-0${d + 1}`, candidate_net: d % 2 ? 4 : -1, champion_net: 0 });
  }
  const a = dayBlockCI(pairs, 0.05, 800, ECONOMIC.bootstrap_seed);
  const b = dayBlockCI(pairs, 0.05, 800, ECONOMIC.bootstrap_seed);
  assert.deepEqual(a, b, "an evaluation must be reproducible from stored data alone");
});

test("multiple candidates shrink the error budget each one gets", () => {
  // Rounded, because 1 - 0.95 is 0.050000000000000044 in binary floating point.
  assert.equal(Math.round(correctedAlpha(0.95, 1) * 10000) / 10000, 0.05);
  assert.equal(Math.round(correctedAlpha(0.95, 4) * 10000) / 10000, 0.0125);
  // Four candidates each at 5% would give roughly a one-in-five chance that one
  // clears by luck. The corrected interval is strictly harder to clear.
  const pairs: Pair[] = [];
  for (let d = 0; d < 12; d++) pairs.push({ day: `d${d}`, candidate_net: 1.2, champion_net: 0 });
  const one = dayBlockCI(pairs, correctedAlpha(0.95, 1), 1000, 3)!;
  const four = dayBlockCI(pairs, correctedAlpha(0.95, 4), 1000, 3)!;
  assert.ok(four.lo <= one.lo, "correcting can only lower the bound");
});

test("delta is candidate minus champion", () => {
  assert.equal(delta({ day: "d", candidate_net: -9, champion_net: -82 }), 73);
});

// ---------------------------------------------------------------------------
// The gates, and failing closed.
// ---------------------------------------------------------------------------

/** Evidence that clears everything, so each test can break exactly one thing. */
function strongEvidence(): ComponentEvidence {
  const pairs: Pair[] = [];
  const cand: number[] = [];
  const champ: number[] = [];
  // 300 fills over 40 days. The candidate turns big losses into small ones and
  // gives up a little on the winners — the shape the hypothesis predicts.
  for (let i = 0; i < 300; i++) {
    const day = `2026-08-${String((i % 40) + 1).padStart(2, "0")}`;
    const championLoses = i % 4 === 0; // 75 losing windows
    const c = championLoses ? -8 : 16;
    const k = championLoses ? -82 : 18;
    pairs.push({ day, candidate_net: c, champion_net: k, regime: i % 2 ? "US_MID" : "ASIA_MID" });
    cand.push(c);
    champ.push(k);
  }
  return {
    candidate_id: "PROVE180_V1",
    pairs,
    candidate_nets: cand,
    champion_nets: champ,
    days: 40,
    paired_control_losses: 75,
    competitors: 4,
  };
}

test("strong evidence passes every required gate", () => {
  const r = evaluateComponentGates(strongEvidence());
  assert.equal(
    r.all_required_passed,
    true,
    `expected all gates to pass, blocked by: ${r.blocked_by.join(", ")}`,
  );
  assert.equal(r.passed, r.total);
  assert.match(gateSummary(r), /every required gate passed/);
});

test("a thin sample is insufficient, never a pass", () => {
  const ev = strongEvidence();
  const r = evaluateComponentGates({
    ...ev,
    pairs: ev.pairs.slice(0, 40),
    candidate_nets: ev.candidate_nets.slice(0, 40),
    champion_nets: ev.champion_nets.slice(0, 40),
    days: 6,
    paired_control_losses: 8,
  });
  assert.equal(r.all_required_passed, false);
  const byId = new Map(r.gates.map((x) => [x.id, x]));
  assert.equal(byId.get("min_fills")!.state, "insufficient");
  assert.equal(byId.get("min_days")!.state, "insufficient");
  assert.equal(byId.get("min_control_losses")!.state, "insufficient");
  assert.match(byId.get("min_fills")!.detail, /40 \/ 250/);
});

test("missing any one required gate blocks promotion", () => {
  // Sample, economics, CI and regime all fine; only the drawdown is worse. One
  // failed safety gate must be enough.
  const ev = strongEvidence();
  const worse = ev.candidate_nets.map((x, i) => (i < 30 ? -60 : x)); // a deep early run
  const r = evaluateComponentGates({ ...ev, candidate_nets: worse });
  assert.equal(r.all_required_passed, false);
  assert.ok(r.blocked_by.includes("Drawdown"), `blocked_by was ${r.blocked_by.join(", ")}`);
  assert.ok(r.passed < r.total);
});

test("a failed safety gate is named, not hidden behind a progress score", () => {
  const ev = strongEvidence();
  // The candidate keeps catastrophic losses at 20% of windows, against an allowance
  // of 60% of the Champion's 25% rate — i.e. 15%. Eight of 300 would have passed.
  const cand = ev.candidate_nets.map((x, i) => (i % 5 === 0 ? -70 : x));
  const r = evaluateComponentGates({ ...ev, candidate_nets: cand });
  const cat = r.gates.find((x) => x.id === "catastrophic")!;
  assert.equal(cat.state, "fail");
  assert.match(cat.detail, /vs Champion/);
  assert.match(gateSummary(r), /blocked by/);
});

test("a candidate that merely matches the Champion fails the improvement bar", () => {
  const ev = strongEvidence();
  const r = evaluateComponentGates({
    ...ev,
    pairs: ev.pairs.map((p) => ({ ...p, candidate_net: p.champion_net })),
    candidate_nets: [...ev.champion_nets],
  });
  const beat = r.gates.find((x) => x.id === "beats_incumbent")!;
  assert.equal(beat.state, "fail");
  assert.equal(r.all_required_passed, false);
});

test("a losing candidate fails positive economics even if it beats the Champion", () => {
  // Both lose; the candidate loses less. That is a real improvement and still not
  // a promotion, because the gate requires positive economics in its own right.
  const pairs: Pair[] = [];
  const cand: number[] = [];
  const champ: number[] = [];
  for (let i = 0; i < 300; i++) {
    const day = `2026-08-${String((i % 40) + 1).padStart(2, "0")}`;
    pairs.push({ day, candidate_net: -3, champion_net: -20, regime: "US_MID" });
    cand.push(-3);
    champ.push(-20);
  }
  const r = evaluateComponentGates({
    candidate_id: "PROVE180_V1",
    pairs,
    candidate_nets: cand,
    champion_nets: champ,
    days: 40,
    paired_control_losses: 300,
    competitors: 4,
  });
  assert.equal(r.gates.find((x) => x.id === "positive_economics")!.state, "fail");
  assert.equal(r.gates.find((x) => x.id === "beats_incumbent")!.state, "pass", "+17¢ paired is a real gain");
  assert.equal(r.all_required_passed, false);
});

test("too few tail events makes the tail gates insufficient rather than passing", () => {
  // A Champion with almost no catastrophic losses gives no basis for judging whether
  // the candidate reduces them.
  const ev = strongEvidence();
  const champ = ev.champion_nets.map((x) => (x < -30 ? -5 : x)); // remove the tail
  const r = evaluateComponentGates({
    ...ev,
    champion_nets: champ,
    pairs: ev.pairs.map((p, i) => ({ ...p, champion_net: champ[i]! })),
  });
  const cat = r.gates.find((x) => x.id === "catastrophic")!;
  assert.equal(cat.state, "insufficient");
  assert.match(cat.detail, /needed to judge/);
  assert.equal(r.all_required_passed, false, "insufficient must not promote");
});

test("a regime with too little data is not judged and not a pass", () => {
  const few: Pair[] = Array.from({ length: 10 }, (_, i) => ({
    day: `d${i}`,
    candidate_net: 5,
    champion_net: 0,
    regime: "OVERNIGHT",
  }));
  const gate = regimeGate(few);
  assert.equal(gate.state, "insufficient");
  assert.match(gate.detail, /30 paired observations/);
});

test("a candidate trailing badly inside one judged regime fails", () => {
  const pairs: Pair[] = [];
  for (let i = 0; i < 40; i++) pairs.push({ day: `d${i}`, candidate_net: 6, champion_net: 0, regime: "US_MID" });
  for (let i = 0; i < 40; i++) pairs.push({ day: `e${i}`, candidate_net: -5, champion_net: 0, regime: "OVERNIGHT" });
  const gate = regimeGate(pairs);
  assert.equal(gate.state, "fail", "good overall cannot excuse being much worse somewhere");
  assert.match(gate.detail, /OVERNIGHT/);
});

test("the summary is generated from the measurements", () => {
  const r = evaluateComponentGates(strongEvidence());
  // No hand-written prose: the line is assembled from gate outcomes.
  assert.match(gateSummary(r), /^PROVE180_V1: \d+\/\d+ gates/);
});

test("every gate is required today, so none can be quietly optional", () => {
  const r = evaluateComponentGates(strongEvidence());
  assert.equal(r.gates.every((x) => x.required), true);
  assert.equal(r.gates.length, 11, "3 sample + 3 economic + 4 risk + 1 regime");
});
