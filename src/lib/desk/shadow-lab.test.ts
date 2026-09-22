import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_MIN } from "./promotion-gates.ts";
import {
  SHADOW_FUTILITY_LOOK_FILLS, SHADOW_HARD_DD_STOP_CENTS, armDayState, futilityLook, manifestFingerprint, pairUniverse, pairedMetrics, promotionVerdict,
  receiptKey, riskStop, settleReceipt, type ArmOutcome, type ShadowReceipt,
} from "./shadow-lab.ts";
import { E1_UNMUTE_DEDUP_SHELF_V1, E2_WARDEN_JUMP_VETO_V1, E3_SETTLE_BASIS_MEASURED_V1, E4_MIRROR_35_V1, INITIAL_SHADOW_COLLECTION_IDS, SHADOW_MANIFESTS, SHADOW_MANIFEST_FINGERPRINTS } from "./shadow-manifests.ts";

const day = (i: number) => `2026-10-${String(1 + Math.floor(i / 20)).padStart(2, "0")}`;
const outcome = (net: number | null, filled = net != null && net !== 0, i = 0): ArmOutcome => ({ net, filled, qualified: filled, day: day(i) });

test("receipt keys are one per (experiment, arm, window, kind) and a settle prices at the receipt's own ask", () => {
  const r: ShadowReceipt = { experiment: "E", arm: "A", ticker: "T", close_ms: 1, kind: "fill", decided_ms: 0, side: "UP", ask_cents: 85, fee_engine: "KALSHI_TAKER_7PCT_CEIL_CENT_V1", fee_cents: 1, size_at_ask: 5, spread_cents: 1, feeds_ok: true, hittable_150ms: null, hittable_500ms: null, official_winner: null, net_cents: null, note: null };
  assert.equal(receiptKey(r), "E|A|T|1|fill");
  const repoll: ShadowReceipt = { ...r, decided_ms: 99, ask_cents: 90 };
  assert.equal(receiptKey(repoll), receiptKey(r), "a re-poll with a different ask produces the same key");
  assert.equal(settleReceipt(r, "UP").net_cents, 14);
  assert.equal(settleReceipt(r, "DOWN").net_cents, -86);
  assert.equal(settleReceipt({ ...r, kind: "wait", side: null, ask_cents: null }, "UP").net_cents, null);
});

test("pairing on the predeclared universe: WAIT is zero and pairs; missing data is unavailable and never pairs", () => {
  const universe = ["w1", "w2", "w3", "w4", "w5"];
  const cand = new Map<string, ArmOutcome>([["w1", outcome(14)], ["w2", outcome(0, false)], ["w3", outcome(-86)], ["w4", outcome(null)]]);
  const ctrl = new Map<string, ArmOutcome>([["w1", outcome(14)], ["w2", outcome(-86)], ["w3", outcome(null)], ["w5", outcome(9)]]);
  const p = pairUniverse(universe, cand, ctrl);
  assert.deepEqual({ shared: p.shared, candidate_only: p.candidate_only, control_only: p.control_only, unavailable: p.unavailable }, { shared: 2, candidate_only: 1, control_only: 1, unavailable: 1 });
  assert.equal(p.paired_control_losses, 1);
  assert.equal(p.candidate_fills, 2);
  assert.deepEqual(p.candidate_nets, [14, 0]);
});

test("paired metrics normalise per 100 universe windows and per Chicago week; the CI needs two days", () => {
  const universe = Array.from({ length: 200 }, (_, i) => `w${i}`);
  const cand = new Map<string, ArmOutcome>(), ctrl = new Map<string, ArmOutcome>();
  for (let i = 0; i < 200; i += 1) { cand.set(`w${i}`, outcome(i % 5 === 0 ? 14 : 0, i % 5 === 0, i)); ctrl.set(`w${i}`, outcome(i % 5 === 0 ? 9 : 0, i % 5 === 0, i)); }
  const p = pairUniverse(universe, cand, ctrl);
  const m = pairedMetrics(p, 3);
  assert.equal(m.n_pairs, 200);
  assert.equal(m.delta_per_100_windows, 100); // 40 pairs × 5¢ / 200 × 100
  assert.ok(m.ci && m.ci.days === 10);
  assert.ok(Math.abs(m.alpha - 0.05 / 3) < 1e-12);
  assert.equal(m.candidate_abs_net, 560);
  assert.equal(m.candidate_net_per_fill, 14);
});

test("the futility look fires only at 150 qualified fills and can bench, never promote", () => {
  const universe = Array.from({ length: 160 }, (_, i) => `w${i}`);
  const cand = new Map<string, ArmOutcome>(), ctrl = new Map<string, ArmOutcome>();
  for (let i = 0; i < 160; i += 1) { cand.set(`w${i}`, outcome(-1, true, i)); ctrl.set(`w${i}`, outcome(0, false, i)); }
  const p = pairUniverse(universe, cand, ctrl);
  const f = futilityLook(p, pairedMetrics(p, 3));
  assert.equal(SHADOW_FUTILITY_LOOK_FILLS, 150);
  assert.equal(f.due, true);
  assert.equal(f.verdict, "bench");
  const short = pairUniverse(universe.slice(0, 100), cand, ctrl);
  assert.equal(futilityLook(short, pairedMetrics(short, 3)).verdict, "not_due");
});

test("risk stop: −258¢ hard stop, 50¢ worse than control, −150¢ operator alert only", () => {
  const base = { n_pairs: 1, universe: 1, delta_per_100_windows: 0, delta_per_week_mean: 0, weeks: 1, ci: null, alpha: 0.05, candidate_abs_net: 0, control_abs_net: 0, candidate_cvar10: null, control_cvar10: null, candidate_net_per_fill: null };
  assert.equal(riskStop({ ...base, candidate_dd: -258, control_dd: -100 }).breached, true);
  assert.equal(riskStop({ ...base, candidate_dd: -160, control_dd: -100 }).breached, true);
  const alert = riskStop({ ...base, candidate_dd: -150, control_dd: -120 });
  assert.equal(alert.breached, false);
  assert.equal(alert.operator_alert, true);
  assert.equal(SHADOW_HARD_DD_STOP_CENTS, -258);
});

test("the verdict AND-s every frozen gate: too little evidence is BLOCKED with named insufficiencies, never a verdict", () => {
  const universe = Array.from({ length: 60 }, (_, i) => `w${i}`);
  const cand = new Map<string, ArmOutcome>(), ctrl = new Map<string, ArmOutcome>();
  for (let i = 0; i < 60; i += 1) { cand.set(`w${i}`, outcome(i % 10 === 9 ? -86 : 14, true, i)); ctrl.set(`w${i}`, outcome(i % 10 === 9 ? -86 : 9, true, i)); }
  const p = pairUniverse(universe, cand, ctrl);
  const m = pairedMetrics(p, 3);
  const v = promotionVerdict({ primary: p, primary_metrics: m, vs_chair_hold: p, vs_chair_hold_metrics: m, invalidations: [] });
  assert.equal(v.status, "BLOCKED");
  assert.ok(v.blocked_by.includes("fills") && v.blocked_by.includes("days") && v.blocked_by.includes("control_losses"));
  assert.equal(v.gates.find((g) => g.id === "fills")?.state, "insufficient");
  assert.equal(COMPONENT_MIN.fills, 250);
  const bad = promotionVerdict({ primary: p, primary_metrics: m, vs_chair_hold: p, vs_chair_hold_metrics: m, invalidations: ["mid-price fill detected"] });
  assert.equal(bad.status, "INVALID");
});

test("a zero control drawdown makes the ratio gate undefined (insufficient), not passed; losing less than a losing control is not +EV", () => {
  const universe = Array.from({ length: 300 }, (_, i) => `w${i}`);
  const cand = new Map<string, ArmOutcome>(), ctrl = new Map<string, ArmOutcome>();
  for (let i = 0; i < 300; i += 1) { cand.set(`w${i}`, outcome(-0.1, true, i)); ctrl.set(`w${i}`, outcome(-0.3, true, i)); }
  const p = pairUniverse(universe, cand, ctrl);
  const m = pairedMetrics(p, 3);
  const v = promotionVerdict({ primary: p, primary_metrics: m, vs_chair_hold: p, vs_chair_hold_metrics: m, invalidations: [] });
  assert.equal(v.status, "BLOCKED");
  assert.equal(v.gates.find((g) => g.id === "absolute_net")?.state, "fail");
  const flat = new Map<string, ArmOutcome>();
  for (let i = 0; i < 300; i += 1) flat.set(`w${i}`, outcome(0, false, i));
  const p2 = pairUniverse(universe, cand, flat);
  const m2 = pairedMetrics(p2, 3);
  assert.equal(promotionVerdict({ primary: p2, primary_metrics: m2, vs_chair_hold: p2, vs_chair_hold_metrics: m2, invalidations: [] }).gates.find((g) => g.id === "drawdown")?.state, "insufficient");
});

test("each arm carries its own causal day state; pending fills reserve their full loss", () => {
  const fill = (arm: string, close: string, ask: number, net: number | null): ShadowReceipt => ({ experiment: "E", arm, ticker: close, close_ms: Date.parse(close), kind: "fill", decided_ms: 0, side: "UP", ask_cents: ask, fee_engine: "KALSHI_TAKER_7PCT_CEIL_CENT_V1", fee_cents: 1, size_at_ask: 1, spread_cents: 1, feeds_ok: true, hittable_150ms: true, hittable_500ms: true, official_winner: net == null ? null : net > 0 ? "UP" : "DOWN", net_cents: net, note: null });
  const receipts = [
    fill("A", "2026-09-21T14:00:00Z", 85, 14), fill("A", "2026-09-21T15:00:00Z", 85, -86), fill("A", "2026-09-21T16:00:00Z", 85, -86), fill("A", "2026-09-21T17:00:00Z", 85, null),
    fill("B", "2026-09-21T14:00:00Z", 85, 14), fill("B", "2026-09-21T15:00:00Z", 85, 14), fill("B", "2026-09-21T16:00:00Z", 85, 14), fill("B", "2026-09-21T17:00:00Z", 85, 14), fill("B", "2026-09-21T18:00:00Z", 85, 14),
  ];
  const a = armDayState(receipts, "A", "2026-09-21");
  assert.deepEqual({ net: a.settled_net, tightened: a.tightened, pending: a.pending_full_loss_exposure, protected: a.profit_protected }, { net: -158, tightened: true, pending: 86, protected: false });
  const b = armDayState(receipts, "B", "2026-09-21");
  assert.deepEqual({ net: b.settled_net, tightened: b.tightened, protected: b.profit_protected }, { net: 70, tightened: false, protected: true });
});

test("the four manifests are frozen, CANDIDATE or CANDIDATE_NOT_COLLECTING, authority none, with null prospective start and pinned fingerprints", () => {
  assert.equal(SHADOW_MANIFESTS.length, 4);
  for (const m of SHADOW_MANIFESTS) {
    assert.ok(m.status === "CANDIDATE" || m.status === "CANDIDATE_NOT_COLLECTING");
    assert.equal(m.authority, "none");
    assert.equal(m.prospective_start_at, null);
    assert.equal(m.gates.min_fills, 250); assert.equal(m.gates.min_days, 30); assert.equal(m.gates.min_paired_control_losses, 25);
    assert.equal(m.risk.hard_dd_stop_cents, -258);
    assert.ok(m.arms.some((a) => a.id === m.primary_contrast.candidate && a.promotable));
    assert.ok(m.arms.some((a) => a.id === m.primary_contrast.control && !a.promotable));
    assert.ok(Object.isFrozen(m) && Object.isFrozen(m.arms));
  }
  assert.deepEqual(SHADOW_MANIFEST_FINGERPRINTS, {
    UNMUTE_DEDUP_SHELF_V1: manifestFingerprint(E1_UNMUTE_DEDUP_SHELF_V1),
    WARDEN_JUMP_VETO_V1: manifestFingerprint(E2_WARDEN_JUMP_VETO_V1),
    SETTLE_BASIS_MEASURED_V1: manifestFingerprint(E3_SETTLE_BASIS_MEASURED_V1),
    MIRROR_35_V1: manifestFingerprint(E4_MIRROR_35_V1),
  });
  // Pinned exactly: fee provenance or any frozen parameter/time change is a new fingerprint.
  assert.equal(SHADOW_MANIFEST_FINGERPRINTS.UNMUTE_DEDUP_SHELF_V1, "UNMUTE_DEDUP_SHELF_V1|v1|612f23b9|8arms");
  assert.equal(SHADOW_MANIFEST_FINGERPRINTS.WARDEN_JUMP_VETO_V1, "WARDEN_JUMP_VETO_V1|v1|ae4a57cc|5arms");
  assert.equal(SHADOW_MANIFEST_FINGERPRINTS.SETTLE_BASIS_MEASURED_V1, "SETTLE_BASIS_MEASURED_V1|v1|e1c9d3b1|4arms");
  assert.equal(SHADOW_MANIFEST_FINGERPRINTS.MIRROR_35_V1, "MIRROR_35_V1|v1|15d0f9d4|3arms");
  assert.notEqual(manifestFingerprint({ ...E1_UNMUTE_DEDUP_SHELF_V1, arms: E1_UNMUTE_DEDUP_SHELF_V1.arms.map((a) => a.id === "PKG_85" ? { ...a, params: { ...a.params, floor_cents: 86 } } : a) }), SHADOW_MANIFEST_FINGERPRINTS.UNMUTE_DEDUP_SHELF_V1);
});


test("initial prospective activation set is explicit, exactly three, and excludes MIRROR-35", () => {
  assert.deepEqual([...INITIAL_SHADOW_COLLECTION_IDS], [
    "UNMUTE_DEDUP_SHELF_V1",
    "WARDEN_JUMP_VETO_V1",
    "SETTLE_BASIS_MEASURED_V1",
  ]);
  assert.equal(INITIAL_SHADOW_COLLECTION_IDS.length, 3);
  assert.equal(INITIAL_SHADOW_COLLECTION_IDS.includes("MIRROR_35_V1"), false);
  for (const id of INITIAL_SHADOW_COLLECTION_IDS) {
    const m = SHADOW_MANIFESTS.find((x) => x.id === id);
    assert.equal(m?.status, "CANDIDATE");
    assert.equal(m?.prospective_start_at, null);
  }
});
