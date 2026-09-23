import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { bookable, bookableShadow, paperBookEdgeOk, paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { markSide } from "./scalp.ts";
import { captureEntrySkillRoster } from "./entry-skill-roster.ts";
import {
  chicagoDay, dailyAdmission, hasPaperPosition, restoreRiskCalls, selectiveBlock, selectiveBookOk,
  selectiveChair, settleRiskCalls, SELECTIVE_PARAMS, type SelectiveContext,
  profitRiskBlock,
} from "./selective-entry.ts";
import type { CallLogRow, ChairResult, SeatId, Snapshot, Vote } from "./types";

const now = Date.parse("2026-09-16T15:05:00Z");
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: now + 600_000, ticker: "KXBTC15M-26SEP161015-15", mins_left: 10, secs_left: 600,
  yes_ask: 82, yes_bid: 81, no_ask: 19, no_bid: 18, no_bid_size: 5, yes_bid_size: 7,
  edge_up: 6, edge_down: -8, fair_yes: 90, fee_yes: 2, fee_no: 2,
  spread_cents: 1, leftover_cents: -1, spot_age_s: 1, lab_fair_yes: 90, lab_age_s: 1,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  ...extra,
} as Snapshot);
const chair = (extra: Partial<ChairResult> = {}): ChairResult => ({
  lean: "UP", score: 0.8, bar: 0.5, hard_fail: false, confidence: 80, calc: "test", gates: [],
  quorum: { up: 3, down: 0, wait: 15 },
  rows: (["STREAK", "STRIKE", "CARRY"] as SeatId[]).map(seat => ({ seat, lean: "UP", health: "LIVE", status: "LIVE", folded: false })),
  ...extra,
} as ChairResult);
const ctx = (extra: Partial<SelectiveContext> = {}): SelectiveContext => ({ calls: [], ready: true, start: now - 86_400_000, watch: null, ...extra });
const row = (t = now - 3_600_000, settle: number | null = 100): CallLogRow => ({
  id: `id-${t}`, ticker: `window-${t}`, t, close_time: t + 900_000, lean: "UP", cents: 82, settle, flipped: false,
});
const confirmed = (s = snap()): SelectiveContext => ctx({ watch: {
  key: `${s.ticker}|${s.close_time}`, side: "UP", since: s.as_of - 8000, last: s.as_of, frames: 3, mode: "normal",
} });

test("a supported, fresh, positive-edge entry can pass; confidence is not used as a win probability", () => {
  assert.equal(selectiveBlock(snap(), chair(), ctx()), null);
  assert.equal(selectiveBookOk(snap(), chair({ confidence: 60 }), confirmed()), true);
});
test("three wins do not impose a daily quota; duplicate restored entries count once", () => {
  const calls = [row(), row(now - 2_400_000), row(now - 1_200_000)];
  assert.equal(dailyAdmission(calls, now).calls, 3);
  assert.equal(dailyAdmission(calls, now).reason, null);
  assert.equal(selectiveBlock(snap(), chair(), ctx({ calls })), null);
  assert.equal(dailyAdmission([...calls, calls[0]!], now).calls, 3);
});
test("one loss does not stop the Central day; net cents determine tightening", () => {
  const calls = [row(undefined, 0), row(now - 2_400_000), row(now - 1_200_000)];
  assert.equal(dailyAdmission(calls, now).losses, 1);
  assert.equal(dailyAdmission(calls, now).reason, null);
  assert.equal(dailyAdmission(calls, now).net_cents, -52);
  assert.equal(dailyAdmission(calls, now).tightened, false);
  assert.equal(selectiveBlock(snap(), chair(), ctx({ calls })), null);
  assert.equal(dailyAdmission(calls, now + 86_400_000).reason, null);
});
test("Central calendar boundary respects daylight saving time", () => {
  assert.equal(chicagoDay(Date.parse("2026-09-16T04:59:59Z")), "2026-09-15");
  assert.equal(chicagoDay(Date.parse("2026-09-16T05:00:00Z")), "2026-09-16");
  assert.equal(chicagoDay(Date.parse("2026-12-16T05:59:59Z")), "2026-12-15");
  assert.equal(chicagoDay(Date.parse("2026-12-16T06:00:00Z")), "2026-12-16");
});
test("a current-day past window with no result blocks another entry rather than guessing it won", () => {
  assert.match(dailyAdmission([row(undefined, null)], now).reason!, /previous paper result/);
});

test("an earlier-day missing grade stays visible and uncounted without stopping every later day", () => {
  const missing: CallLogRow = { t: 1789389418506, id: "1789389900000-DOWN-1789389418506",
    lean: "DOWN", cents: 85, settle: null, ticker: "KXBTC15M-26SEP140845-45",
    flipped: false, close_time: 1789389900000 };
  const before = JSON.stringify(missing);
  const d = dailyAdmission([missing], Date.parse("2026-09-15T15:35:00Z"));
  assert.equal(d.reason, null);
  assert.equal(d.calls, 0); assert.equal(d.wins, 0); assert.equal(d.losses, 0);
  assert.equal(d.net_cents, 0); assert.equal(d.open_risk_cents, 0);
  assert.deepEqual(d.missing_prior_days, [{ ticker: missing.ticker, close_time: missing.close_time, status: "MISSING" }]);
  assert.equal(JSON.stringify(missing), before);
  assert.equal(restoreRiskCalls([missing], []).calls[0]!.settle, null);
  assert.equal(selectiveBlock(snap(), chair(), ctx({ calls: [missing] })), null);
});

test("missing-grade day boundary uses Central time in summer and winter", () => {
  for (const midnight of [Date.parse("2026-09-16T05:00:00Z"), Date.parse("2026-12-16T06:00:00Z")]) {
    const missing = { ...row(midnight - 1_800_000, null), close_time: midnight - 900_000 };
    assert.match(dailyAdmission([missing], midnight - 1).reason!, /previous paper result/);
    assert.equal(dailyAdmission([missing], midnight).reason, null);
    assert.equal(dailyAdmission([missing], midnight).missing_prior_days.length, 1);
    const closingNow = { ...missing, close_time: midnight };
    assert.match(dailyAdmission([closingNow], midnight).reason!, /previous paper result/);
    assert.equal(dailyAdmission([closingNow], midnight).missing_prior_days.length, 0);
  }
});

test("an older gap cannot hide current unresolved exposure or its admission block", () => {
  const older = row(now - 86_400_000, null);
  const today = row(now - 3_600_000, null);
  const future = row(now, null);
  const d = dailyAdmission([older, today, future], now);
  assert.equal(d.missing_prior_days.length, 1);
  assert.equal(d.open_risk_cents, 168);
  assert.match(d.reason!, /previous paper result/);
});
test("durable risk history survives JSON restart and clearing the display log", () => {
  const calls = [row(undefined, 0), row(now - 2_400_000, 0)];
  const restored = restoreRiskCalls(JSON.parse(JSON.stringify(calls)), []);
  assert.equal(restored.valid, true);
  assert.equal(dailyAdmission(restored.calls, now).tightened, true);
  assert.equal(dailyAdmission(restored.calls, now).net_cents, -168);
  assert.equal(restoreRiskCalls(calls, calls).calls.length, 2);
  assert.equal(restoreRiskCalls({ broken: true }, []).valid, false);
  assert.equal(restoreRiskCalls([{ ...row(), cents: NaN }], []).valid, false);
  assert.match(selectiveBlock(snap(), chair(), ctx({ ready: false }))!, /durable risk history/);
});
test("risk settlement needs exact window identity and never replaces a known result", () => {
  const r = row(undefined, null);
  assert.equal(settleRiskCalls([r], r.ticker, r.close_time + 1, "DOWN")[0]!.settle, null);
  const settled = settleRiskCalls([r], r.ticker, r.close_time, "DOWN");
  assert.equal(settled[0]!.settle, 0);
  assert.equal(settleRiskCalls(settled, r.ticker, r.close_time, "UP")[0]!.settle, 0);
});
test("one seat, disagreement, folded or uncalibrated seats cannot manufacture a team", () => {
  for (const c of [chair({ quorum: { up: 1, down: 0, wait: 17 } }),
    chair({ quorum: { up: 3, down: 1, wait: 14 } }),
    chair({ rows: chair().rows.map(r => ({ ...r, folded: true, status: "FOLDED" })) }),
    chair({ rows: chair().rows.map(r => ({ ...r, status: "UNCALIBRATED" })) }),
    chair({ rows: [chair().rows[0]!, chair().rows[0]!, chair().rows[0]!] })]) {
    assert.notEqual(selectiveBlock(snap(), c, ctx()), null);
  }
});
test("two healthy supporters from two evidence groups clear normal quorum", () => {
  assert.equal(selectiveBlock(snap(), chair({ rows: chair().rows.slice(0, 2) }), ctx()), null);
});
test("three correlated candle seats are only one evidence group", () => {
  const rows = (["WICK", "DRIFT", "PULSE"] as SeatId[]).map(seat => ({ ...chair().rows[0]!, seat }));
  assert.match(selectiveBlock(snap(), chair({ rows }), ctx())!, /two evidence groups/);
});
test("current failed gates block a sticky UP even when its score remains high", () => {
  assert.notEqual(selectiveBlock(snap(), chair({ hard_fail: true }), ctx()), null);
  assert.notEqual(selectiveBlock(snap(), chair({ gates: [{ id: "bar", label: "bar", hard: true, pass: false, value: "failed" }] }), ctx()), null);
});
test("paper team guard honors the Chair's own bar gate instead of recomputing raw score", () => {
  const passed = { id: "bar", label: "bar", hard: true, pass: true, value: "passed with aggressiveness" };
  const failed = { ...passed, pass: false, value: "failed" };
  assert.equal(paperBookTeamOk(chair({ score: 0.49, bar: 0.54, gates: [passed] }), "UP"), true);
  assert.equal(paperBookTeamOk(chair({ score: 0.80, bar: 0.54, gates: [failed] }), "UP"), false);
});
test("no opening chase or final-three-minute entry; remaining time comes from the clock", () => {
  for (const seconds of [601, 179, 86, 0, -1, NaN]) {
    assert.notEqual(selectiveBlock(snap({ close_time: now + seconds * 1000 }), chair(), ctx()), null);
  }
  assert.equal(selectiveBlock(snap({ close_time: now + 180_000 }), chair(), ctx()), null);
  assert.match(selectiveBlock(snap(), chair(), ctx({ start: now }))!, /complete market window/);
});
test("stale receipt, unhealthy spot, missing ask, crossed book, spread and empty size fail closed", () => {
  const bad: Partial<Snapshot>[] = [
    { spot_age_s: 16 }, { spot_age_s: NaN }, { yes_ask: 0, yes_mid: 82 }, { yes_bid: 83 },
    { yes_bid: 78 }, { no_bid_size: 0 }, { yes_ask: 99 }, { no_ask: 10 },
    { obs: { ...snap().obs, receipt_ts: now - 11_000 } }, { obs: { ...snap().obs, gap: "held" } },
    { health: { ...snap().health, spot_ok: false } },
  ];
  for (const s of bad) assert.notEqual(selectiveBlock(snap(s), chair(), ctx()), null, JSON.stringify(s));
});
test("main-model margin and BRTI margin are distinct; a stale or missing index never falls back to spot", () => {
  for (const s of [{ edge_up: 2.99 }, { edge_up: NaN }, { lab_fair_yes: 84 }, { lab_fair_yes: null },
    { lab_fair_yes: NaN }, { lab_age_s: 6 }, { lab_age_s: -1 }, { lab_fair_yes: 77.7 }]) {
    assert.notEqual(selectiveBlock(snap(s), chair(), ctx()), null);
  }
  assert.equal(selectiveBlock(snap({ edge_up: 3, lab_fair_yes: 84.1 }), chair(), ctx()), null);
});
test("DOWN uses its own ask, YES resting size, own edge and complementary index probability", () => {
  const c = chair({ lean: "DOWN", score: -0.8, quorum: { up: 0, down: 3, wait: 15 },
    rows: chair().rows.map(r => ({ ...r, lean: "DOWN" })) });
  const s = snap({ no_ask: 82, no_bid: 81, yes_ask: 19, yes_bid: 18, edge_down: 6, lab_fair_yes: 10 });
  assert.equal(selectiveBlock(s, c, ctx()), null);
  assert.notEqual(selectiveBlock({ ...s, yes_bid_size: 0 }, c, ctx()), null);
  assert.notEqual(selectiveBlock({ ...s, lab_fair_yes: 90 }, c, ctx()), null);
});
test("confirmation gates paper entry without rewriting the Chair's directional read", () => {
  let context = ctx();
  for (const elapsed of [0, 0, 4000]) {
    const s = snap({ as_of: now + elapsed });
    const result = selectiveChair(s, chair(), context);
    assert.equal(result.chair.lean, "UP");
    assert.equal(result.chair.gates.find(g => g.id === "selective")?.pass, false);
    context = { ...context, watch: result.watch };
  }
  const s = snap({ as_of: now + 8000, obs: { ...snap().obs, receipt_ts: now + 7000 } });
  const admitted = selectiveChair(s, chair(), context);
  assert.equal(admitted.chair.lean, "UP");
  assert.equal(admitted.chair.gates.find(g => g.id === "selective")?.pass, true);
  assert.equal(admitted.chair.gates.find(g => g.id === "selective")?.hard, false);
  assert.equal(selectiveBookOk(s, admitted.chair, { ...context, watch: admitted.watch }), true);
  assert.equal(selectiveBookOk({ ...s, lab_fair_yes: 80 }, admitted.chair, { ...context, watch: admitted.watch }), false);
  assert.equal(selectiveChair(s, chair({ lean: "WAIT" }), context).watch, null);
});
test("entry restrictions never exit or reopen an existing paper position", () => {
  const s = snap();
  const c = chair({ lean: "WAIT" });
  const calls = [{ ...row(), ticker: s.ticker, close_time: s.close_time, settle: null }];
  assert.equal(hasPaperPosition(calls, s), true);
  assert.equal(selectiveChair(s, c, ctx({ calls })).chair, c);
});
