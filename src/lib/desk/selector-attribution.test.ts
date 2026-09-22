import assert from "node:assert/strict";
import test from "node:test";
import { feeCents } from "./fee-engine.ts";
import {
  ATTRIBUTION_FLOOR_CENTS, CAP_COUNTERFACTUAL_CENTS, blankTrack, blindEligibleRow, blindOpportunity, chairFillRow, chairState, classify, contextFromFrame,
  counterfactualFlags, holdNet, indexMargin, noteTick, settleAttribution, sideQuote, windowRow,
} from "./selector-attribution.ts";
import type { ChairResult, SeatRow, Snapshot } from "./types";

const now = Date.parse("2026-10-01T15:00:00Z") - 450_000;
const close = now + 450_000;
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: close, ticker: "KXBTC15M-26OCT011100-00", mins_left: 7.5, secs_left: 450, spot: 86_550, strike: 86_457.64, atr: 60,
  yes_ask: 90, yes_bid: 89, no_ask: 11, no_bid: 10, no_bid_size: 40, yes_bid_size: 30, spot_age_s: 1, quote_age_s: 1,
  yes_ask_exact: 90.1, yes_bid_exact: 89.4, no_ask_exact: 10.6, no_bid_exact: 9.9, no_bid_size_exact: 7, yes_bid_size_exact: 5,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  edge_up: 4.2, edge_down: -30, fair_yes: 96.2, yes_mid: 89.5, lab_fair_yes: 95, lab_age_s: 2, fee_yes: 1, fee_no: 2, regime_key: "r",
  ...extra,
} as unknown as Snapshot);

const row = (seat: SeatRow["seat"], lean: SeatRow["lean"], status: SeatRow["status"] = "LIVE"): SeatRow =>
  ({ seat, lean, status, health: "LIVE", conf: 70, weight: 1, skill_used: `${seat}.x`, folded: false, forced_sit: false, callsign: seat, rank: 1, wilson_rank: 1, contrib_rank: 1, scalp_avg: null, scalp_n: 0, calib_n: 0, calib: 0, calls: 0, base_w: 1, listen: 1, signed: 0, contribution: 0, shadow_lean: null, why: "" }) as SeatRow;

const chair = (lean: ChairResult["lean"] = "UP", rows: SeatRow[] = [row("STRIKE", "UP"), row("CHAIN", "UP"), row("WICK", "WAIT")]): ChairResult =>
  ({ lean, confidence: 71, score: 0.6, bar: 0.4, vs_bar: 0.55, dir_mass: 2, sit_mass: 0.3, hard_fail: false, gates: [], quorum: { up: rows.filter((r) => r.lean === "UP").length, down: rows.filter((r) => r.lean === "DOWN").length, wait: rows.filter((r) => r.lean === "WAIT").length }, rows }) as unknown as ChairResult;

test("the blind opportunity is the NULL_FAV rule at the deployed 80¢ floor, decided on the whole-cent lane and priced on the exact lane", () => {
  assert.equal(ATTRIBUTION_FLOOR_CENTS, 80);
  const o = blindOpportunity(snap())!;
  assert.equal(o.side, "UP");
  assert.deepEqual({ exact: o.quote.ask_exact, whole: o.quote.ask_whole, size: o.quote.size_exact, present: o.quote.exact_lane_present }, { exact: 90.1, whole: 90, size: 7, present: true });
  assert.equal(o.fee_exact, feeCents(90.1));
  assert.equal(blindOpportunity(snap({ yes_ask: 79, yes_bid: 78 })), null, "under the floor there is no blind opportunity");
  assert.equal(blindOpportunity(snap({ yes_bid: 86 })), null, "a 4¢ spread is not eligible");
  const noExact = blindOpportunity(snap({ yes_ask_exact: undefined, yes_bid_exact: undefined, no_bid_size_exact: undefined }))!;
  assert.deepEqual({ exact: noExact.quote.ask_exact, present: noExact.quote.exact_lane_present, size: noExact.quote.size_exact }, { exact: 90, present: false, size: 40 }, "without the exact lane the whole-cent lane is used and labelled absent");
});

test("counterfactual flags: the 92¢ cap, the flat-3¢ vs price-aware gates, chalk and the lane difference are recorded at decision time", () => {
  const q = sideQuote(snap(), "UP");
  const cf = counterfactualFlags(snap(), q, 4.2);
  assert.equal(cf.cap_cents, CAP_COUNTERFACTUAL_CENTS);
  assert.equal(cf.cap_blocked, false);
  assert.equal(counterfactualFlags(snap({ yes_ask: 93, yes_ask_exact: 92.4 }), sideQuote(snap({ yes_ask: 93, yes_ask_exact: 92.4 }), "UP"), 4.2).cap_blocked, true);
  const byId = Object.fromEntries(cf.gate_variants.map((v) => [v.id, v]));
  assert.equal(byId.FLAT_3C!.threshold_cents, 3);
  assert.equal(byId.FLAT_3C!.pass, true);
  assert.equal(byId.FEE_PLUS_2!.threshold_cents, feeCents(90) + 2);
  assert.equal(byId.QUARTER_OF_WIN!.threshold_cents, Math.round(0.25 * (100 - 90 - feeCents(90)) * 1000) / 1000);
  assert.equal(counterfactualFlags(snap(), q, null).gate_variants[0]!.pass, null, "no edge recorded → not evaluable, never passed");
  assert.equal(cf.chalk, false);
  assert.equal(counterfactualFlags(snap({ yes_ask: 99 }), q, 4.2).chalk, true);
  assert.deepEqual({ d: cf.price_lane.exact_minus_whole, fe: cf.price_lane.fee_exact, fw: cf.price_lane.fee_whole }, { d: 0.1, fe: feeCents(90.1), fw: feeCents(90) });
});

test("chair state carries what the Chair had: seats, eligible supporters by side, evidence groups, quorum state, feeds, the deployed gate and its binding reason", () => {
  const c = chair("UP");
  const ctx = contextFromFrame([], { ready: true, start: 0 })!;
  const s = chairState(snap(), c, ctx, { checks: [{ id: "direction", label: "d", pass: true }], positioned: false, eligible: false, mode: "normal" });
  assert.equal(s.lean, "UP");
  assert.deepEqual(s.eligible_seats, { up: ["STRIKE", "CHAIN"], down: [] });
  assert.deepEqual(s.directional_votes, { up: ["STRIKE", "CHAIN"], down: [], wait: ["WICK"] });
  assert.deepEqual(s.evidence_groups.up.sort(), ["book", "derivs"]);
  assert.equal(s.quorum_state!.up.reachable, true);
  assert.equal(s.quorum_state!.down.reachable, false);
  assert.equal(s.feeds.ok, true);
  assert.ok(s.gate, "the deployed gate vector is evaluated");
  assert.equal(s.gate!.positioned, false);
  assert.ok(s.gate!.failed.includes("confirmation"), "confirmation cannot pass without the engine watch: reported failed, never guessed; production_audit carries the engine's own verdict");
  assert.equal(typeof s.gate!.binding_reason === "string" || s.gate!.binding_reason === null, true);
  assert.equal(s.production_audit!.eligible, false);
  assert.equal(s.model_fair_yes, 96.2);
  assert.equal(s.market_yes_mid, 89.5);
  assert.equal(chairState(snap(), c, null).gate, null, "without a context the gate is not guessed");
  assert.equal(contextFromFrame([], undefined), null);
  assert.equal(indexMargin(snap(), "UP", 90), Math.round((95 - 90 - feeCents(90)) * 1000) / 1000);
  assert.equal(indexMargin(snap({ lab_fair_yes: null }), "UP", 90), null);
});

test("the BLIND_ELIGIBLE row prices the exact lane, keeps the whole-cent lane beside it, and records the Chair's read and rejection reason at that tick", () => {
  const o = blindOpportunity(snap())!;
  const s = chairState(snap(), chair("WAIT", [row("WICK", "WAIT")]), contextFromFrame([], { ready: true, start: 0 }));
  const r = blindEligibleRow(snap(), o, s);
  assert.equal(r.kind, "BLIND_ELIGIBLE");
  assert.deepEqual({ side: r.side, ask: r.ask_cents, whole: r.ask_whole_cents, fee: r.fee_cents, lean: r.chair_lean }, { side: "UP", ask: 90.1, whole: 90, fee: feeCents(90.1), lean: "WAIT" });
  assert.equal(r.model_edge_cents, 4.2);
  assert.equal(r.index_margin_cents, indexMargin(snap(), "UP", 90));
  assert.equal(r.rejection_reason, "waiting for a directional setup");
  assert.equal(r.payload.chair_same_side, false);
  assert.equal((r.counterfactual as { price_lane: { exact_minus_whole: number } }).price_lane.exact_minus_whole, 0.1);
});

test("the CHAIR_FILL row keeps the booked whole-cent ask as the ledger's price and labels the exact ask as observed after the fact", () => {
  const s = chairState(snap(), chair("UP"), contextFromFrame([{ id: "x", t: now - 2000, ticker: "KXBTC15M-26OCT011100-00", close_time: close, lean: "UP", cents: 90, settle: null, flipped: false }], { ready: true, start: 0 }));
  const r = chairFillRow(snap(), { lean: "UP", cents: 90, t: now - 2000 }, s, { side: "UP", ask_exact: 90.1, decided_ms: now - 4000 });
  assert.equal(r.kind, "CHAIR_FILL");
  assert.deepEqual({ ask: r.ask_cents, whole: r.ask_whole_cents, lag: r.payload.observed_lag_ms, blindSame: r.payload.blind_same_side }, { ask: 90.1, whole: 90, lag: 2000, blindSame: true });
  assert.equal(r.cap_blocked, false);
  assert.equal(s.gate!.positioned, true, "the gate sees the position through the call log");
});

test("the window track classifies the divergence and keeps the chalk-adjusted WAIT facts at the frozen checkpoints", () => {
  const t = blankTrack(snap());
  noteTick(t, snap(), "WAIT");
  noteTick(t, snap({ as_of: close - 300_000, yes_ask: 99, yes_ask_exact: 99.2 }), "WAIT");
  noteTick(t, snap({ as_of: close - 290_000 }), "UP");
  assert.deepEqual(t.leans, ["WAIT", "UP"]);
  assert.deepEqual(t.checkpoints.map((c) => [c.secs, c.chair_lean, c.chalk]), [[450, "WAIT", false], [300, "WAIT", true]]);
  assert.equal(classify(t), "NEITHER");
  t.blind = { side: "UP", ask_exact: 90.1, ask_whole: 90, fee_exact: 1, decided_ms: now, chair_lean_at: "WAIT", rejection_reason: "waiting for a directional setup", eligible_at: false };
  assert.equal(classify(t), "BLIND_ONLY");
  t.chair = { side: "DOWN", cents: 85, booked_ms: now + 1000, observed_ms: now + 2000, ask_exact_observed: 85 };
  assert.equal(classify(t), "BOTH_OPPOSITE");
  t.chair.side = "UP";
  assert.equal(classify(t), "BOTH_SAME_SIDE");
  t.blind = null;
  assert.equal(classify(t), "CHAIR_ONLY");
  const w = windowRow(t);
  assert.equal(w.kind, "WINDOW");
  assert.equal(w.divergence, "CHAIR_ONLY");
  assert.deepEqual((w.counterfactual as { chalk_adjusted_wait: unknown }).chalk_adjusted_wait, { wait_450: true, chalk_450: false, wait_300: true, chalk_300: true });
  assert.equal(w.chalk, true);
});

test("settlement: net at the exact ask, the cap and gate-variant counterfactual nets, the whole-cent lane, and the divergence's realized delta", () => {
  assert.equal(holdNet(90.1, 1, true), 8.9);
  assert.equal(holdNet(90.1, 1, false), -91.1);
  const o = blindOpportunity(snap())!;
  const r = blindEligibleRow(snap(), o, chairState(snap(), chair("WAIT", [row("WICK", "WAIT")]), null));
  const win = settleAttribution(r, "UP");
  assert.equal(win.net_cents, holdNet(90.1, feeCents(90.1), true));
  const st = win.counterfactual.settled as Record<string, unknown>;
  assert.equal(st.net_whole_lane, holdNet(90, feeCents(90), true));
  assert.equal(st.net_under_cap, win.net_cents, "not blocked by the cap: unchanged");
  assert.deepEqual(st.gate_variants, { FLAT_3C: win.net_cents, QUARTER_OF_WIN: win.net_cents, FEE_PLUS_2: win.net_cents });
  const loss = settleAttribution({ ...r, cap_blocked: true }, "DOWN");
  assert.equal((loss.counterfactual.settled as Record<string, unknown>).net_under_cap, 0, "a capped opportunity nets 0, and the change is recorded");
  assert.equal((loss.counterfactual.settled as Record<string, unknown>).cap_change, -loss.net_cents!);

  const t = blankTrack(snap());
  t.blind = { side: "UP", ask_exact: 90.1, ask_whole: 90, fee_exact: 1, decided_ms: now, chair_lean_at: "WAIT", rejection_reason: null, eligible_at: false };
  t.chair = { side: "UP", cents: 85, booked_ms: now, observed_ms: now, ask_exact_observed: 85 };
  const w = settleAttribution(windowRow(t), "DOWN");
  const ws = w.counterfactual.settled as Record<string, number>;
  assert.deepEqual({ blind: ws.blind_net, chair: ws.chair_net, delta: ws.chair_minus_blind }, { blind: -91.1, chair: -85 - feeCents(85), delta: Math.round((-85 - feeCents(85) + 91.1) * 1000) / 1000 });
  assert.equal(settleAttribution({ kind: "WINDOW", side: null, ask_cents: null, fee_cents: null, cap_blocked: null, counterfactual: {} }, "UP").net_cents, null, "a NEITHER window has no net");
});
