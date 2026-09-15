import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { bookable, bookableShadow, paperBookEdgeOk, paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { markSide } from "./scalp.ts";
import {
  chicagoDay, dailyAdmission, hasPaperPosition, restoreRiskCalls, selectiveBlock, selectiveBookOk,
  selectiveChair, settleRiskCalls, SELECTIVE_PARAMS, type SelectiveContext,
} from "./selective-entry.ts";
import type { CallLogRow, ChairResult, SeatId, Snapshot } from "./types";

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
  key: `${s.ticker}|${s.close_time}`, side: "UP", since: s.as_of - 8000, last: s.as_of, frames: 3,
} });

test("a supported, fresh, positive-edge entry can pass; confidence is not used as a win probability", () => {
  assert.equal(selectiveBlock(snap(), chair(), ctx()), null);
  assert.equal(selectiveBookOk(snap(), chair({ confidence: 60 }), confirmed()), true);
});
test("three wins exhaust the daily allowance; duplicate restored entries count once", () => {
  const calls = [row(), row(now - 2_400_000), row(now - 1_200_000)];
  assert.equal(dailyAdmission(calls, now).calls, 3);
  assert.match(dailyAdmission(calls, now).reason!, /daily limit/);
  assert.equal(dailyAdmission([...calls, calls[0]!], now).calls, 3);
});
test("first net loss pauses the Central day, even after two subsequent wins", () => {
  const calls = [row(undefined, 0), row(now - 2_400_000), row(now - 1_200_000)];
  assert.equal(dailyAdmission(calls, now).losses, 1);
  assert.match(dailyAdmission(calls, now).reason!, /after a loss/);
  assert.equal(dailyAdmission(calls, now + 86_400_000).reason, null);
});
test("Central calendar boundary respects daylight saving time", () => {
  assert.equal(chicagoDay(Date.parse("2026-09-16T04:59:59Z")), "2026-09-15");
  assert.equal(chicagoDay(Date.parse("2026-09-16T05:00:00Z")), "2026-09-16");
  assert.equal(chicagoDay(Date.parse("2026-12-16T05:59:59Z")), "2026-12-15");
  assert.equal(chicagoDay(Date.parse("2026-12-16T06:00:00Z")), "2026-12-16");
});
test("a past window with no result blocks another entry rather than guessing it won", () => {
  assert.match(dailyAdmission([row(undefined, null)], now).reason!, /previous paper result/);
});
test("durable risk history survives JSON restart and clearing the display log", () => {
  const calls = [row(undefined, 0)];
  const restored = restoreRiskCalls(JSON.parse(JSON.stringify(calls)), []);
  assert.equal(restored.valid, true);
  assert.match(dailyAdmission(restored.calls, now).reason!, /after a loss/);
  assert.equal(restoreRiskCalls(calls, calls).calls.length, 1);
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
test("one or two seats, disagreement, folded or uncalibrated seats cannot manufacture a team", () => {
  for (const c of [chair({ quorum: { up: 1, down: 0, wait: 17 } }),
    chair({ rows: chair().rows.slice(0, 2) }), chair({ quorum: { up: 3, down: 1, wait: 14 } }),
    chair({ rows: chair().rows.map(r => ({ ...r, folded: true })) }),
    chair({ rows: chair().rows.map(r => ({ ...r, status: "UNCALIBRATED" })) }),
    chair({ rows: [chair().rows[0]!, chair().rows[0]!, chair().rows[0]!] })]) {
    assert.notEqual(selectiveBlock(snap(), c, ctx()), null);
  }
});
test("three correlated candle seats are only one evidence group", () => {
  const rows = (["WICK", "DRIFT", "PULSE"] as SeatId[]).map(seat => ({ ...chair().rows[0]!, seat }));
  assert.match(selectiveBlock(snap(), chair({ rows }), ctx())!, /two evidence groups/);
});
test("current failed gates block a sticky UP even when its score remains high", () => {
  assert.notEqual(selectiveBlock(snap(), chair({ hard_fail: true }), ctx()), null);
  assert.notEqual(selectiveBlock(snap(), chair({ gates: [{ id: "bar", label: "bar", hard: true, pass: false, value: "failed" }] }), ctx()), null);
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
test("confirmation requires three distinct observations and eight seconds; any invalid tick resets it", () => {
  let context = ctx();
  for (const elapsed of [0, 0, 4000]) {
    const s = snap({ as_of: now + elapsed });
    const result = selectiveChair(s, chair(), context);
    assert.equal(result.chair.lean, "WAIT");
    context = { ...context, watch: result.watch };
  }
  const s = snap({ as_of: now + 8000, obs: { ...snap().obs, receipt_ts: now + 7000 } });
  const admitted = selectiveChair(s, chair(), context);
  assert.equal(admitted.chair.lean, "UP");
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

// Execute the production booking functions, substituting I/O only. This catches an unwired guard.
function bookingHarness(saveOk = true) {
  const source = readFileSync(new URL("./server-engine.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("server-engine.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["noteCall", "noteEntryState", "noteShadowFill", "windowKey", "runningBuildSha", "settleCallLog"]);
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.has(n.name.text));
  assert.equal(functions.length, names.size);
  const events: string[] = [];
  const scope = { bookable, bookableShadow, paperBookEdgeOk, paperBookTeamOk, selectiveBookOk,
    hasPaperPosition, restoreRiskCalls, settleRiskCalls, markSide, takerFeeCents,
    process: { env: {} }, persistState: async () => { events.push("saved"); return saveOk; },
    notifyCall: () => events.push("notified"),
  };
  const code = ts.transpileModule(functions.map(n => n.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const api = vm.runInNewContext(`${code}\n({noteCall,settleCallLog})`, scope) as {
    noteCall: (e: ReturnType<typeof engine>, s: Snapshot, c: ChairResult) => Promise<void>;
    settleCallLog: (e: ReturnType<typeof engine>, ticker: string, close: number, winner: string) => void;
  };
  return { api, events };
}
const engine = () => ({ callLog: [] as CallLogRow[], riskCalls: [] as CallLogRow[], baselineCalls: [] as CallLogRow[],
  lastCall: null, shadowFills: {}, entryState: {}, riskReady: true, selectiveStart: now - 86_400_000, entryWatch: confirmed().watch });

test("actual booking path refuses the single-seat regression with positive model edge", async () => {
  const { api, events } = bookingHarness(); const e = engine();
  await api.noteCall(e, snap(), chair({ quorum: { up: 1, down: 0, wait: 17 } }));
  assert.equal(e.callLog.length, 0); assert.equal(e.riskCalls.length, 0);
  assert.deepEqual(Object.keys(e.shadowFills), []); assert.deepEqual(events, []);
});
test("actual booking path rejects a deteriorated index quote after confirmation", async () => {
  const { api, events } = bookingHarness(); const e = engine();
  await api.noteCall(e, snap({ lab_fair_yes: 80 }), chair());
  assert.equal(e.callLog.length, 0); assert.deepEqual(events, []);
});
test("actual booking records and saves once before notification; clear display cannot reopen the position", async () => {
  const { api, events } = bookingHarness(); const e = engine(); const s = snap();
  await api.noteCall(e, s, chair());
  assert.equal(e.callLog.length, 1); assert.equal(e.riskCalls.length, 1);
  assert.deepEqual(events, ["saved", "notified"]);
  e.callLog = []; e.lastCall = null;
  await api.noteCall(e, s, chair());
  assert.equal(e.callLog.length, 0); assert.equal(e.riskCalls.length, 1);
  api.settleCallLog(e, s.ticker, s.close_time, "DOWN");
  assert.equal(e.riskCalls[0]!.settle, 0);
  assert.match(dailyAdmission(e.riskCalls, s.close_time + 1000).reason!, /after a loss/);
});
test("failed durable save publishes no call and disables new admission", async () => {
  const { api, events } = bookingHarness(false); const e = engine();
  await api.noteCall(e, snap(), chair());
  assert.deepEqual(events, ["saved"]); assert.equal(e.riskReady, false);
});
test("frozen policy prefers fewer calls and contains no zero-loss claim", () => {
  assert.equal(SELECTIVE_PARAMS.max_calls_per_day, 3);
  assert.equal(SELECTIVE_PARAMS.max_losses_per_day, 1);
  assert.equal(Object.isFrozen(SELECTIVE_PARAMS), true);
});
