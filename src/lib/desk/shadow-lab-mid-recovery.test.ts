import assert from "node:assert/strict";
import test from "node:test";
import { feeCents } from "./fee-engine.ts";
import { SELECTIVE_PARAMS } from "./floor-policy.ts";
import { DEPLOYED_POLICY } from "./gate-vector.ts";
import { E1_FAMILY_OVERRIDE, E1_ROSTER_CARDS, nullFavIntention } from "./shadow-arms.ts";
import {
  MID_RECOVERY_ENV_FLAG, MID_RECOVERY_EXPERIMENT, MID_RECOVERY_STAGES, armQuality, evaluateMidRecovery, evaluationFields, summarizeMidRecovery,
  type MidRecoveryDeps, type MidRecoveryEvaluation, type MidRecoveryInput, type MidRecoveryRow,
} from "./shadow-lab-mid-recovery.ts";
import type { ChairResult, Learner, SeatId, SeatRow, Snapshot, Vote } from "./types";

// ---------------------------------------------------------------------------
// Fixtures: a synthetic Chair on the real gate math. The real producer,
// projection and Chair are exercised by scripts/mid-recovery-shadow.test.mjs.
// ---------------------------------------------------------------------------

const now = Date.parse("2026-09-25T15:05:00Z");
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: now + 420_000, ticker: "KXBTC15M-26SEP251012-15", mins_left: 7, secs_left: 420, demo: false,
  yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, no_bid_size: 40, yes_bid_size: 30,
  edge_up: 5, edge_down: -9, fair_yes: 91, fee_yes: 1, fee_no: 2,
  spread_cents: 1, leftover_cents: -1, spot_age_s: 1, lab_fair_yes: 92, lab_age_s: 1,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  ...extra,
} as Snapshot);
const seatRow = (seat: SeatId, lean: "UP" | "DOWN" | "WAIT", extra: Partial<SeatRow> = {}): SeatRow =>
  ({ seat, lean, health: "LIVE", status: "LIVE", folded: false, weight: 0.1, forced_sit: false, skill_used: `${seat}.card`, ...extra }) as SeatRow;
const chairOf = (rows: SeatRow[], extra: Partial<ChairResult> = {}): ChairResult => {
  const up = rows.filter((r) => r.lean === "UP" && !r.forced_sit).length;
  const down = rows.filter((r) => r.lean === "DOWN" && !r.forced_sit).length;
  return {
    lean: up > down ? "UP" : down > up ? "DOWN" : "WAIT", score: 0.8, bar: 0.5, hard_fail: false, confidence: 80, calc: "test",
    gates: [{ id: "bar", label: "bar", pass: true, hard: true, value: "" }],
    quorum: { up, down, wait: rows.filter((r) => r.lean === "WAIT").length }, rows, ...extra,
  } as ChairResult;
};
const waitChair = (): ChairResult => chairOf([seatRow("STREAK", "WAIT"), seatRow("CHAIN", "WAIT"), seatRow("DRIFT", "WAIT")], { confidence: 76 });
const vote = (seat: SeatId, skill: string, lean: Vote["lean"], conf = 70, extra: Partial<Vote> = {}): Vote => ({
  seat, lean, raw_lean: lean, confidence: conf, raw_conf: conf, features: {}, reasoning: skill, skill_used: skill, skill_status: "SHADOW", shadow: null, paper: [],
  thresh_used: [], skill_n: 1, skill_hits: 0, skill_wilson: 0, hypothesis: skill, evidence: [], counter: "", invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID", ...extra,
});
const learner = { skills: {}, seat_w: {}, seat_n: {} } as unknown as Learner;

/** Deps that stand in for the real path: the evaluator must treat their outputs exactly as it treats the real ones. */
function depsFor(candidates: Array<{ seat: SeatId; card_id: string; vote: Vote }>, simulatedRows: SeatRow[], chairExtra: Partial<ChairResult> = {}, evaluatedExtra: Vote[] = [], heldVotes: Vote[] = []): MidRecoveryDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runBotsWithEvaluatedCandidates: (s) => { calls.push("bots"); return { version: "E1_RECOVERY_V1_INACTIVE", ticker: s.ticker, close_time: s.close_time, as_of: s.as_of, votes: heldVotes, evaluated: [...candidates.map((c) => c.vote), ...evaluatedExtra] }; },
    projectInactiveE1Recovery: (frame) => {
      calls.push("project");
      return { version: "E1_RECOVERY_V1_INACTIVE", active: false, ticker: frame.ticker, close_time: frame.close_time, as_of: frame.as_of,
        candidates: candidates.map((c) => ({ ...c, original_status: "SHADOW" as const })), simulated: { votes: candidates.map((c) => c.vote), learner, released: candidates.map((c) => c.card_id), missing: [] } };
    },
    runChair: () => { calls.push("chair"); return chairOf(simulatedRows, chairExtra); },
  };
}
const twoFamilies = [seatRow("STREAK", "UP"), seatRow("CHAIN", "UP"), seatRow("DRIFT", "WAIT")];
const twoCandidates = [
  { seat: "STREAK" as SeatId, card_id: "STREAK.continue_young", vote: vote("STREAK", "STREAK.continue_young", "UP") },
  { seat: "CHAIN" as SeatId, card_id: "CHAIN.oi_with_price", vote: vote("CHAIN", "CHAIN.oi_with_price", "UP") },
];
const input = (s: Snapshot, extra: Partial<MidRecoveryInput> = {}): MidRecoveryInput => ({
  snap: s, chair: waitChair(), learner, settings: { mutes: [], bar_override: null, adaptive_bar: true, beast: false }, call_log: [], audit: null, ready: true, start: now - 86_400_000, recovered_calls: [], watch: null, ...extra,
});
const run = (s: Snapshot, deps = depsFor(twoCandidates, twoFamilies), extra: Partial<MidRecoveryInput> = {}) => evaluateMidRecovery(input(s, extra), deps);
const check = (ev: MidRecoveryEvaluation, id: string) => ev.recovered.checks.find((k) => k.id === id)?.pass;

/** Drive the arm's own confirmation latch through frames `gapMs` apart. */
function confirmOver(s0: Snapshot, frames: number, gapMs: number, deps = depsFor(twoCandidates, twoFamilies)) {
  let ev: MidRecoveryEvaluation | null = null;
  let watch: MidRecoveryInput["watch"] = null;
  for (let i = 0; i < frames; i += 1) {
    ev = evaluateMidRecovery(input(snap({ ...s0, as_of: s0.as_of + i * gapMs }), { watch }), deps);
    watch = ev.confirmation.watch;
  }
  return ev!;
}

// ---------------------------------------------------------------------------
// The frozen experiment.
// ---------------------------------------------------------------------------

test("the experiment is frozen, inactive by default, and uses exactly the frozen E1 roster with STREAK counted as a book read", () => {
  assert.equal(MID_RECOVERY_EXPERIMENT.id, "MID_RECOVERY_V1_INACTIVE");
  assert.equal(MID_RECOVERY_EXPERIMENT.active_by_default, false);
  assert.equal(MID_RECOVERY_EXPERIMENT.authority, "research-only-simulated");
  assert.equal(MID_RECOVERY_EXPERIMENT.roster, E1_ROSTER_CARDS);
  assert.deepEqual([...MID_RECOVERY_EXPERIMENT.roster], ["STRIKE.itm_time", "STREAK.continue_young", "CHAIN.oi_with_price", "CARRY.trend_carry", "DRIFT.aligned_3h", "DRIFT.pullback_in_trend"]);
  assert.equal(MID_RECOVERY_EXPERIMENT.family_override, E1_FAMILY_OVERRIDE);
  assert.deepEqual({ ...MID_RECOVERY_EXPERIMENT.family_override }, { STREAK: "book" });
  assert.deepEqual({ ...MID_RECOVERY_EXPERIMENT.band_secs }, { min: 180, max: 600 });
  assert.equal(MID_RECOVERY_EXPERIMENT.floor_cents, 80);
  assert.equal(MID_RECOVERY_EXPERIMENT.floor_cents, SELECTIVE_PARAMS.floor_cents, "the floor is the deployed floor, never lower");
  assert.equal(MID_RECOVERY_EXPERIMENT.policy_id, DEPLOYED_POLICY.id);
  assert.equal(MID_RECOVERY_EXPERIMENT.recovery_version, "E1_RECOVERY_V1_INACTIVE");
  assert.deepEqual({ ...MID_RECOVERY_EXPERIMENT.arms }, { baseline: "BASELINE", recovered: "RECOVERED_MID", null_fav: "NULL_FAV_80" });
  assert.equal(MID_RECOVERY_ENV_FLAG, "MID_RECOVERY_SHADOW_ENABLED");
  assert.ok(Object.isFrozen(MID_RECOVERY_EXPERIMENT));
  assert.deepEqual([...MID_RECOVERY_STAGES], ["observed", "candidate", "directional", "team", "support", "quote", "economics", "eligible", "confirmed", "simulated_booked"]);
});

test("one evaluation records at least 36 measured fields, covering every promised group", () => {
  const ev = run(snap());
  const fields = evaluationFields(ev);
  assert.ok(fields.length >= 36, `${fields.length} fields`);
  for (const f of [
    "baseline.lean", "baseline.state", "baseline.selective_eligible", "baseline.blocker", "candidates", "recovery.released", "recovery.held_seats", "recovery.correlated_cards_dropped",
    "recovered.lean", "recovered.state", "recovered.eligible", "recovered.blocker", "recovered.families_ok", "confirmation.frames", "confirmation.seconds", "confirmation.confirmed",
    "economics.ask_cents", "economics.spread_cents", "economics.fee_cents", "economics.model_edge_cents", "economics.index_margin_cents", "economics.breakeven_pct",
    "simulated.side", "simulated.price_cents", "simulated.settlement", "simulated.win", "simulated.net_cents", "simulated.booked", "simulated.qualified",
    "null_fav.side", "null_fav.ask_cents", "null_fav.settlement", "null_fav.net_cents", "flags.recovered_agrees_with_favourite", "flags.baseline_agrees_with_favourite", "flags.wait_to_directional", "flags.funnel_stage",
  ]) assert.ok(fields.includes(f), `missing ${f}`);
  const c = ev.candidates[0]!;
  for (const k of ["seat", "card_id", "raw_lean", "calibrated_conf", "health", "family", "survived_fold", "counted_as_support"]) assert.ok(k in c, `candidate.${k}`);
});

// ---------------------------------------------------------------------------
// Baseline is read, never recomputed; the real path is called exactly once.
// ---------------------------------------------------------------------------

test("the baseline is the production Chair as handed in, nothing in the input is mutated, and the path runs once per tick in order", () => {
  const s = snap();
  const chair = waitChair();
  const callLog = [{ id: "x", t: now - 60_000, ticker: "OTHER", close_time: now + 900_000, lean: "UP" as const, cents: 85, settle: null, flipped: false }];
  const deps = depsFor(twoCandidates, twoFamilies);
  const before = JSON.stringify({ s, chair, learner, callLog });
  const ev = evaluateMidRecovery(input(s, { chair, call_log: callLog, audit: { eligible: false, checks: [{ id: "direction", pass: false }] } }), deps);
  assert.equal(JSON.stringify({ s, chair, learner, callLog }), before);
  assert.deepEqual(deps.calls, ["bots", "project", "chair"]);
  assert.equal(ev.baseline.lean, "WAIT");
  assert.equal(ev.baseline.state, "WAIT");
  assert.equal(ev.baseline.confidence, 76);
  assert.equal(ev.baseline.selective_eligible, false);
  assert.equal(ev.baseline.blocker, "direction");
  assert.equal(ev.baseline.booked, null, "no production booking is invented for another window");
  assert.equal(ev.flags.wait_to_directional, true);
  assert.equal(ev.recovered.state, "DIRECTIONAL");
});

test("the production selective gate's own reason is the baseline blocker; a production booking is mirrored only from the paper log", () => {
  const s = snap();
  const chair = chairOf(twoFamilies, { gates: [{ id: "bar", label: "bar", pass: true, hard: true, value: "" }, { id: "selective", label: "Paper entry", hard: false, pass: false, value: "waiting for three confirming observations over at least eight seconds" }] });
  const ev = run(s, depsFor(twoCandidates, twoFamilies), { chair, audit: { eligible: false, checks: [] } });
  assert.equal(ev.baseline.state, "DIRECTIONAL");
  assert.equal(ev.baseline.blocker, "waiting for three confirming observations over at least eight seconds");
  assert.deepEqual(ev.baseline.supporters, ["STREAK", "CHAIN"]);
  assert.equal(ev.flags.recovered_agrees_with_baseline, true);
  assert.equal(ev.flags.wait_to_directional, false);
  const booked = run(s, depsFor(twoCandidates, twoFamilies), { chair, call_log: [{ id: "p", t: now - 20_000, ticker: s.ticker, close_time: s.close_time, lean: "UP", cents: 84, settle: null, flipped: false }] });
  assert.deepEqual(booked.baseline.booked, { side: "UP", ask_cents: 84, decided_ms: now - 20_000 });
});

// ---------------------------------------------------------------------------
// Every production rule still gates the recovered read. Nothing is lowered.
// ---------------------------------------------------------------------------

test("a recovered read that clears every rule is eligible but not yet confirmed, and nothing is booked on one tick", () => {
  const ev = run(snap());
  assert.equal(ev.recovered.eligible, true);
  assert.equal(ev.recovered.blocker, null);
  assert.deepEqual(ev.recovered.families, ["book", "derivs"]);
  assert.equal(ev.confirmation.frames, 1);
  assert.equal(ev.confirmation.confirmed, false);
  assert.equal(ev.simulated.qualified, false);
  assert.equal(ev.simulated.booked, false);
  assert.equal(ev.flags.funnel_stage, "eligible");
  assert.deepEqual(ev.economics, {
    side: "UP", ask_cents: 85, bid_cents: 84, spread_cents: 1, touch_size: 40, fee_cents: feeCents(85), model_edge_cents: 5, fair_yes: 91, index_fair_yes: 92,
    index_margin_cents: 92 - 85 - feeCents(85), breakeven_pct: 85 + feeCents(85), floor_cents: 80, floor_ok: true, ceiling_ok: true, spread_ok: true, size_ok: true, feeds_ok: true,
  });
});

test("the 80¢ floor holds: a 79¢ favourite cannot recover, an 80¢ one can", () => {
  const low = run(snap({ yes_ask: 79, yes_bid: 78, no_ask: 22, no_bid: 21 }));
  assert.equal(low.recovered.eligible, false);
  assert.equal(low.economics.floor_ok, false);
  assert.equal(check(low, "quote"), false);
  assert.equal(low.flags.funnel_stage, "support");
  assert.match(low.recovered.blocker ?? "", /80¢/);
  const at = run(snap({ yes_ask: 80, yes_bid: 79, no_ask: 21, no_bid: 20 }));
  assert.equal(at.economics.floor_ok, true);
  assert.equal(check(at, "quote"), true);
});

test("ceiling, spread and resting size gate exactly as production does", () => {
  assert.equal(run(snap({ yes_ask: 99, yes_bid: 98, no_ask: 2, no_bid: 1, lab_fair_yes: 99.5 })).economics.ceiling_ok, false);
  assert.equal(check(run(snap({ yes_ask: 99, yes_bid: 98, no_ask: 2, no_bid: 1 })), "quote"), false);
  const wide = run(snap({ yes_bid: 82 }));
  assert.equal(wide.economics.spread_ok, false);
  assert.equal(check(wide, "quote"), false);
  const thin = run(snap({ no_bid_size: 0 }));
  assert.equal(thin.economics.size_ok, false);
  assert.equal(check(thin, "quote"), false);
  assert.equal(thin.recovered.eligible, false);
});

test("fees and the settlement index gate the recovered side: the margin is fair − ask − taker fee and must exceed the deployed minimum", () => {
  const fee = feeCents(85);
  assert.ok(fee >= 1);
  const covered = run(snap({ lab_fair_yes: 85 + fee + 1 }));
  assert.equal(covered.economics.index_margin_cents, 1);
  assert.equal(check(covered, "index_edge"), true);
  const uncovered = run(snap({ lab_fair_yes: 85 + fee }));
  assert.equal(uncovered.economics.index_margin_cents, 0);
  assert.equal(check(uncovered, "index_edge"), false);
  assert.equal(uncovered.recovered.eligible, false);
  assert.equal(uncovered.flags.funnel_stage, "quote");
  const staleIndex = run(snap({ lab_age_s: SELECTIVE_PARAMS.max_index_age_s + 1 }));
  assert.equal(check(staleIndex, "index_fresh"), false);
  assert.equal(staleIndex.recovered.eligible, false);
  const thinEdge = run(snap({ edge_up: SELECTIVE_PARAMS.min_edge_cents - 1 }));
  assert.equal(check(thinEdge, "model_edge"), false);
  assert.equal(thinEdge.recovered.eligible, false);
});

test("stale or inconsistent feeds block the recovered read", () => {
  const stale = run(snap({ health: { ...snap().health, spot: "STALE" } }));
  assert.equal(stale.economics.feeds_ok, false, "a STALE source blocks even when its age is inside the limit");
  assert.equal(stale.recovered.eligible, false);
  assert.equal(stale.flags.funnel_stage, "quote");
  const old = run(snap({ spot_age_s: SELECTIVE_PARAMS.max_spot_age_s + 1 }));
  assert.equal(old.economics.feeds_ok, false);
  const kalshiStale = run(snap({ health: { ...snap().health, kalshi: "STALE" } }));
  assert.equal(kalshiStale.economics.feeds_ok, false);
  const gap = run(snap({ obs: { receipt_ts: now - 1000, gap: "missing" } } as unknown as Partial<Snapshot>));
  assert.equal(gap.economics.feeds_ok, false);
});

test("no opposition: one healthy opposing seat blocks the recovered read", () => {
  const rows = [...twoFamilies, seatRow("STRIKE", "DOWN")];
  const ev = run(snap(), depsFor(twoCandidates, rows));
  assert.equal(ev.recovered.opposition, 1);
  assert.equal(check(ev, "opposition"), false);
  assert.equal(ev.recovered.eligible, false);
  assert.equal(ev.flags.funnel_stage, "team");
});

test("family de-duplication counts STREAK as a book read: STREAK + STRIKE is one family here even though production would count two", () => {
  const rows = [seatRow("STREAK", "UP"), seatRow("STRIKE", "UP"), seatRow("DRIFT", "WAIT")];
  const cands = [twoCandidates[0]!, { seat: "STRIKE" as SeatId, card_id: "STRIKE.itm_time", vote: vote("STRIKE", "STRIKE.itm_time", "UP") }];
  const ev = run(snap(), depsFor(cands, rows));
  assert.equal(check(ev, "families"), true, "the production families check (history + book) would pass");
  assert.deepEqual(ev.recovered.families, ["book"]);
  assert.equal(ev.recovered.families_ok, false);
  assert.equal(ev.recovered.eligible, false);
  assert.match(ev.recovered.blocker ?? "", /STREAK counted as a book read/);
  assert.equal(ev.flags.funnel_stage, "team");
});

test("a folded, forced-sit, stale or zero-weight recovered row cannot count as support and cannot inflate the quorum", () => {
  const rows = [seatRow("STREAK", "UP"), seatRow("CHAIN", "UP", { folded: true, status: "FOLDED" }), seatRow("CARRY", "UP", { health: "STALE" }), seatRow("STRIKE", "UP", { forced_sit: true, lean: "WAIT" }), seatRow("DRIFT", "UP", { weight: 0 })];
  const cands = [...twoCandidates, { seat: "CARRY" as SeatId, card_id: "CARRY.trend_carry", vote: vote("CARRY", "CARRY.trend_carry", "UP", 70, { health: "STALE" }) }];
  const ev = run(snap(), depsFor(cands, rows));
  assert.deepEqual(ev.recovered.supporters, ["STREAK"]);
  assert.equal(check(ev, "supporters"), false);
  assert.equal(ev.recovered.eligible, false);
  const chain = ev.candidates.find((c) => c.seat === "CHAIN")!;
  assert.equal(chain.survived_fold, false);
  assert.equal(chain.counted_as_support, false);
  assert.equal(ev.candidates.find((c) => c.seat === "CARRY")!.counted_as_support, false);
});

test("the team check is the production one: a hard Chair failure or a losing quorum stays failed", () => {
  const hard = run(snap(), depsFor(twoCandidates, twoFamilies, { hard_fail: true }));
  assert.equal(check(hard, "team"), false);
  assert.equal(hard.recovered.eligible, false);
  assert.equal(hard.flags.funnel_stage, "directional");
  const oneSupporter = run(snap(), depsFor([twoCandidates[0]!], [seatRow("STREAK", "UP"), seatRow("DRIFT", "WAIT")]));
  assert.equal(check(oneSupporter, "team"), false, "BOOK_MIN_SPEAKING is two");
});

test("explicit holds and correlated roster cards are reported, not recovered", () => {
  const held = vote("STRIKE", "SIT", "WAIT", 70, { hypothesis: "clock-owned window", skill_status: "SIT" });
  const dup = vote("CHAIN", "CHAIN.oi_with_price", "UP");
  const ev = run(snap(), depsFor(twoCandidates, twoFamilies, {}, [vote("STRIKE", "STRIKE.itm_time", "UP"), { ...dup, skill_used: "DRIFT.pullback_in_trend", seat: "DRIFT" }, vote("DRIFT", "DRIFT.aligned_3h", "UP"), vote("WICK", "WICK.other", "UP")], [held]));
  assert.deepEqual(ev.recovery.held_seats, ["STRIKE"]);
  assert.deepEqual(ev.recovery.correlated_cards_dropped, ["DRIFT.pullback_in_trend", "DRIFT.aligned_3h"], "directional roster cards that lost the one-per-seat rule; a held seat's card and a non-roster card are not counted");
});

// ---------------------------------------------------------------------------
// Confirmation, the simulated booking, and no state leak.
// ---------------------------------------------------------------------------

test("confirmation needs three genuine frames over at least eight seconds; only then is a simulated booking recorded, with settlement left null", () => {
  const s0 = snap();
  const two = confirmOver(s0, 2, 4_000);
  assert.equal(two.confirmation.frames, 2);
  assert.equal(two.confirmation.confirmed, false);
  assert.equal(two.simulated.booked, false);
  const fast = confirmOver(s0, 3, 2_000);
  assert.equal(fast.confirmation.frames, 3);
  assert.equal(fast.confirmation.seconds, 4);
  assert.equal(fast.confirmation.confirmed, false, "three frames in four seconds is not eight seconds");
  const ev = confirmOver(s0, 3, 4_000);
  assert.equal(ev.confirmation.confirmed, true);
  assert.equal(ev.simulated.qualified, true);
  assert.equal(ev.simulated.booked, true);
  assert.deepEqual(ev.simulated, { qualified: true, booked: true, side: "UP", price_cents: 85, fee_cents: feeCents(85), settlement: null, win: null, net_cents: null, authority: "research-only-simulated" });
  assert.equal(ev.flags.funnel_stage, "simulated_booked");
  assert.equal(ev.confirmation.need_frames, SELECTIVE_PARAMS.confirmation_frames);
  assert.equal(ev.confirmation.need_seconds, SELECTIVE_PARAMS.confirmation_seconds);
});

test("the latch never leaks across windows or sides, and a repeated timestamp is not a new frame", () => {
  const s = snap();
  const other = { key: "OTHER|1", side: "UP" as const, since: s.as_of - 20_000, last: s.as_of - 4_000, frames: 5, mode: "normal" as const };
  assert.equal(run(s, undefined, { watch: other }).confirmation.frames, 1);
  const flipped = { key: `${s.ticker}|${s.close_time}`, side: "DOWN" as const, since: s.as_of - 20_000, last: s.as_of - 4_000, frames: 5, mode: "normal" as const };
  assert.equal(run(s, undefined, { watch: flipped }).confirmation.frames, 1);
  const same = { key: `${s.ticker}|${s.close_time}`, side: "UP" as const, since: s.as_of - 8_000, last: s.as_of, frames: 2, mode: "normal" as const };
  const ev = run(s, undefined, { watch: same });
  assert.equal(ev.confirmation.frames, 2, "the same as_of does not count as a genuine new observation");
  assert.equal(ev.confirmation.confirmed, false);
  const notEligible = run(snap({ yes_ask: 79, yes_bid: 78, no_ask: 22, no_bid: 21 }), undefined, { watch: same });
  assert.equal(notEligible.confirmation.watch, null, "a failed gate drops the latch: the next eligible tick starts over");
});

test("a window the recovered arm already holds is never booked twice", () => {
  const s = snap();
  const held = [{ id: "r", t: now - 30_000, ticker: s.ticker, close_time: s.close_time, lean: "UP" as const, cents: 85, settle: null, flipped: false }];
  const watch = { key: `${s.ticker}|${s.close_time}`, side: "UP" as const, since: s.as_of - 10_000, last: s.as_of - 2_000, frames: 3, mode: "normal" as const };
  const ev = run(s, undefined, { recovered_calls: held, watch });
  assert.equal(ev.simulated.qualified, false);
  assert.equal(ev.simulated.booked, false);
});

test("day risk is the arm's own: an open unsettled simulated fill from an earlier window blocks admission", () => {
  const s = snap();
  const open = [{ id: "r", t: now - 1_800_000, ticker: "PRIOR", close_time: now - 900_000, lean: "UP" as const, cents: 85, settle: null, flipped: false }];
  const ev = run(s, undefined, { recovered_calls: open });
  assert.equal(check(ev, "daily_risk"), false);
  assert.equal(ev.recovered.eligible, false);
});

// ---------------------------------------------------------------------------
// NULL_FAV_80 and the agreement flags.
// ---------------------------------------------------------------------------

test("NULL_FAV_80 is the existing favourite rule at the same identity; agreement flags read null when a side is missing", () => {
  const s = snap();
  const ev = run(s);
  const nf = nullFavIntention(s, 80)!;
  assert.deepEqual({ side: ev.null_fav.side, ask: ev.null_fav.ask_cents, fee: ev.null_fav.fee_cents, size: ev.null_fav.size_at_ask, spread: ev.null_fav.spread_cents }, { side: nf.side, ask: nf.ask_cents, fee: nf.fee_cents, size: nf.size_at_ask, spread: nf.spread_cents });
  assert.equal(ev.null_fav.settlement, null);
  assert.equal(ev.null_fav.net_cents, null);
  assert.equal(ev.flags.recovered_agrees_with_favourite, true);
  assert.equal(ev.flags.baseline_agrees_with_favourite, null);
  const cheap = run(snap({ yes_ask: 79, yes_bid: 78, no_ask: 22, no_bid: 21 }));
  assert.equal(cheap.null_fav.eligible, false);
  assert.equal(cheap.flags.recovered_agrees_with_favourite, null);
});

// ---------------------------------------------------------------------------
// Reading the receipts back.
// ---------------------------------------------------------------------------

const ARMS = MID_RECOVERY_EXPERIMENT.arms;
const row = (arm: string, w: number, kind: MidRecoveryRow["kind"], extra: Partial<MidRecoveryRow> = {}): MidRecoveryRow => ({
  arm, ticker: `W${w}`, close_ms: w, kind, decided_ms: w - 300_000, side: null, ask_cents: null, fee_cents: null, official_winner: null, net_cents: null, payload: null, ...extra,
});
const cand = (seat: string, card_id: string, family: string, support: boolean) => ({ seat, card_id, family, survived_fold: true, counted_as_support: support });
const fill = (arm: string, w: number, side: "UP" | "DOWN", ask: number, winner: "UP" | "DOWN" | null, payload: Record<string, unknown> = {}) =>
  row(arm, w, "fill", { side, ask_cents: ask, fee_cents: feeCents(ask), official_winner: winner, net_cents: winner == null ? null : winner === side ? 100 - ask - feeCents(ask) : -ask - feeCents(ask), payload });
const stagePayload = (stage: number, baseSide: "UP" | "DOWN" | null, recSide: "UP" | "DOWN" | null, candidates: unknown[] = []) =>
  ({ funnel_stage_index: stage, funnel_stage: MID_RECOVERY_STAGES[stage], baseline: { side: baseSide }, recovered: { side: recSide }, candidates });

test("the summary builds the funnel, the quality statistics, the NULL comparison and the breakdown from receipts alone, never inventing a settlement", () => {
  const c = [cand("STREAK", "STREAK.continue_young", "book", true), cand("CHAIN", "CHAIN.oi_with_price", "derivs", true)];
  const rows: MidRecoveryRow[] = [
    // w1: recovered simulated fill, won; null fill same side, won; baseline sat.
    fill(ARMS.recovered, 1, "UP", 85, "UP", stagePayload(9, null, "UP", c)), fill(ARMS.null_fav, 1, "UP", 85, "UP"), row(ARMS.baseline, 1, "no_fill", { payload: { baseline: { side: null } } }),
    // w2: recovered fill, lost; null fill other side, won.
    fill(ARMS.recovered, 2, "DOWN", 82, "UP", stagePayload(9, "DOWN", "DOWN", c)), fill(ARMS.null_fav, 2, "UP", 84, "UP"), fill(ARMS.baseline, 2, "DOWN", 82, "UP"),
    // w3: recovered fill still unsettled; null sat.
    fill(ARMS.recovered, 3, "UP", 88, null, stagePayload(9, null, "UP", c)), row(ARMS.null_fav, 3, "no_fill"),
    // w4: recovered reached "quote" only; w5: candidate only; w6: observed only; each with an intention where it applies.
    row(ARMS.recovered, 4, "intention", { side: "UP", ask_cents: 85, payload: stagePayload(7, null, "UP", c) }), row(ARMS.recovered, 4, "no_fill", { payload: stagePayload(5, null, "UP", c) }),
    row(ARMS.recovered, 5, "no_fill", { payload: stagePayload(1, "UP", null, [c[0]]) }), row(ARMS.recovered, 6, "no_fill", { payload: stagePayload(0, null, null) }),
    fill(ARMS.null_fav, 6, "DOWN", 90, "DOWN"),
  ];
  const s = summarizeMidRecovery(rows);
  assert.equal(s.experiment, "MID_RECOVERY_V1_INACTIVE");
  assert.equal(s.observed_windows, 6);
  assert.deepEqual(s.funnel.map((f) => [f.stage, f.windows]), [["observed", 6], ["candidate", 5], ["directional", 4], ["team", 4], ["support", 4], ["quote", 4], ["economics", 4], ["eligible", 4], ["confirmed", 3], ["simulated_booked", 3]]);
  assert.equal(s.funnel[0]!.conversion_pct, null);
  assert.equal(s.funnel[1]!.conversion_pct, 83.3);
  assert.equal(s.funnel[6]!.conversion_pct, 100);
  assert.equal(s.funnel[8]!.conversion_pct, 75);
  assert.deepEqual(s.window_flow, { baseline_wait: 4, baseline_directional: 2, baseline_filled: 1, recovered_directional: 4, wait_to_directional: 3, recovered_eligible: 4, recovered_confirmed: 3, recovered_simulated_booked: 3, recovered_agrees_with_baseline: 1, recovered_disagrees_with_baseline: 0 });
  const q = s.quality.recovered;
  assert.equal(q.fills, 3);
  assert.equal(q.settled, 2);
  assert.equal(q.unsettled, 1);
  assert.equal(q.wins, 1);
  assert.equal(q.losses, 1);
  assert.equal(q.win_rate_pct, 50);
  assert.equal(q.avg_ask_cents, 85);
  assert.equal(q.net_cents, (100 - 85 - feeCents(85)) + (-82 - feeCents(82)));
  assert.equal(q.max_drawdown_cents, -(82 + feeCents(82)));
  assert.ok(q.needed_win_rate_pct! > 80);
  assert.equal(q.brier_confidence, null);
  assert.ok(q.brier_market_implied! > 0);
  assert.equal(s.quality.baseline.fills, 1);
  assert.equal(s.quality.baseline.losses, 1);
  assert.equal(s.quality.null_fav.fills, 3);
  assert.equal(s.quality.null_fav.wins, 3);
  const n = s.null_comparison;
  assert.equal(n.overlap_windows, 2);
  assert.equal(n.side_agreement, 1);
  assert.equal(n.side_agreement_pct, 50);
  assert.equal(n.settled_overlap, 2);
  assert.equal(n.incremental_net_cents, n.recovered_net_on_overlap! - n.null_net_on_overlap!);
  assert.equal(n.recovered_only_windows, 1);
  assert.equal(n.recovered_only_net_cents, null, "the unsettled recovered-only fill contributes nothing until the official result exists");
  assert.equal(n.null_only_windows, 1);
  assert.deepEqual(s.breakdown.by_seat.map((r) => [r.seat, r.candidate_windows, r.counted_as_support, r.in_simulated_fills, r.settled_fills, r.wins]), [["CHAIN", 4, 4, 3, 2, 1], ["STREAK", 5, 5, 3, 2, 1]]);
  assert.deepEqual(s.breakdown.by_family.map((r) => r.family), ["book", "derivs"]);
  assert.equal(s.breakdown.by_card.find((r) => r.card_id === "STREAK.continue_young")!.net_cents, q.net_cents);
  assert.equal(s.promotion.auto_promotion, false);
});

test("an arm with no settled fill reports nulls, not zeros; a T-3 sit is a window observed at stage zero", () => {
  const q = armQuality(ARMS.recovered, [fill(ARMS.recovered, 1, "UP", 85, null)]);
  assert.deepEqual({ fills: q.fills, settled: q.settled, wins: q.wins, wr: q.win_rate_pct, net: q.net_cents, dd: q.max_drawdown_cents, brier: q.brier_market_implied }, { fills: 1, settled: 0, wins: 0, wr: null, net: null, dd: null, brier: null });
  const s = summarizeMidRecovery([row(ARMS.recovered, 1, "no_fill", { payload: { checkpoint: 180, receipt_only: true } })]);
  assert.equal(s.observed_windows, 1);
  assert.equal(s.funnel[0]!.windows, 1);
  assert.equal(s.funnel[1]!.windows, 0);
  assert.equal(summarizeMidRecovery([]).windows, 0);
});
