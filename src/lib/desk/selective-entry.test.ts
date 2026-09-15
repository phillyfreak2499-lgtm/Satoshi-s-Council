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
  profitRiskBlock,
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
  // Recorded public call whose window is also listed missing by /status on Sep 15.
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
  assert.equal(dailyAdmission(e.riskCalls, s.close_time + 1000).net_cents, -84);
  assert.equal(dailyAdmission(e.riskCalls, s.close_time + 1000).reason, null);
});
test("failed durable save publishes no call and disables new admission", async () => {
  const { api, events } = bookingHarness(false); const e = engine();
  await api.noteCall(e, snap(), chair());
  assert.deepEqual(events, ["saved"]); assert.equal(e.riskReady, false);
});
test("net-based policy has no fixed call quota or one-loss stop", () => {
  assert.equal("max_calls_per_day" in SELECTIVE_PARAMS, false);
  assert.equal("max_losses_per_day" in SELECTIVE_PARAMS, false);
  assert.equal(SELECTIVE_PARAMS.floor_cents, 80);
  assert.equal(Object.isFrozen(SELECTIVE_PARAMS), true);
});

const history = (prices: number[], results: number[] = prices.map(() => 100)) => prices.map((cents, i) => ({
  ...row(now - (prices.length - i + 1) * 900_000, results[i]), cents,
}));
const tightChair = () => chair({ quorum: { up: 4, down: 0, wait: 14 },
  rows: [...chair().rows, { ...chair().rows[0]!, seat: "WICK" }] });

test("five small wins cannot be followed by a call that wipes out the green day", () => {
  const calls = history([90, 90, 90, 90, 90]); // +9¢ each after the paper fee.
  const d = dailyAdmission(calls, now);
  assert.equal(d.wins, 5); assert.equal(d.net_cents, 45); assert.equal(d.profit_protected, true);
  assert.match(selectiveBlock(snap(), chair(), ctx({ calls }))!, /protecting today's profit/);
  assert.match(profitRiskBlock(d, NaN)!, /valid ask/);
});

test("five wins with enough reserve allow another call and preserve a positive worst case", () => {
  const calls = history([80, 80, 80, 80, 80]); // +90¢; candidate 82¢ plus fee costs 84¢.
  assert.equal(dailyAdmission(calls, now).net_cents, 90);
  assert.equal(selectiveBlock(snap(), chair(), ctx({ calls })), null);
  const afterLoss = [...calls, { ...row(now - 900_000, 0), cents: 82 }];
  assert.equal(dailyAdmission(afterLoss, now).net_cents, 6);
  assert.match(selectiveBlock(snap(), chair(), ctx({ calls: afterLoss }))!, /protecting today's profit/);
});

test("+100¢ arms profit protection before five wins; fees and pending exposure are reserved", () => {
  const d = dailyAdmission(history([73, 73, 73, 73]), now); // Historical prices: 4 × 25¢.
  assert.equal(d.wins, 4); assert.equal(d.net_cents, 100); assert.equal(d.profit_protected, true);
  assert.equal(profitRiskBlock(d, 82), null);
  assert.notEqual(profitRiskBlock({ ...d, open_risk_cents: 18 }, 82), null);
  assert.notEqual(profitRiskBlock({ ...d, net_cents: 84 }, 82), null); // Flat is not positive.
  const open = { ...row(now - 1_000, null), close_time: now + 300_000, cents: 82 };
  assert.equal(dailyAdmission([...history([73, 73, 73, 73]), open], now).open_risk_cents, 84);
});

test("tightening begins exactly at -100¢ net and survives recovery and a restart", () => {
  assert.equal(dailyAdmission(history([98.9], [0]), now).tightened, false);
  assert.equal(dailyAdmission(history([99], [0]), now).tightened, true);
  const calls = history([82, 82, 80, 80, 80, 80, 80], [0, 0, 100, 100, 100, 100, 100]);
  const d = dailyAdmission(restoreRiskCalls(JSON.parse(JSON.stringify(calls)), []).calls, now);
  assert.equal(d.net_cents, -78); assert.equal(d.tightened, true); assert.equal(d.profit_protected, false);
  assert.equal(dailyAdmission(calls, now + 86_400_000).tightened, false);
  assert.equal(dailyAdmission(calls, now + 86_400_000).profit_protected, false);
});

test("after -100¢ strong entries remain possible; ordinary entries fail the tighter team and edges", () => {
  const context = ctx({ calls: history([82, 82], [0, 0]) });
  assert.match(selectiveBlock(snap(), chair(), context)!, /four healthy/);
  assert.equal(selectiveBlock(snap(), tightChair(), context), null);
  assert.match(selectiveBlock(snap({ edge_up: 4.99 }), tightChair(), context)!, /5¢/);
  assert.match(selectiveBlock(snap({ lab_fair_yes: 86 }), tightChair(), context)!, /exceed 2¢/);
});

test("tighter confirmation requires five qualifying observations over twenty seconds", () => {
  let context = ctx({ calls: history([82, 82], [0, 0]) });
  for (const elapsed of [0, 5000, 10000, 15000, 20000]) {
    const s = snap({ as_of: now + elapsed, obs: { ...snap().obs, receipt_ts: now + elapsed - 1000 } });
    const result = selectiveChair(s, tightChair(), context);
    assert.equal(result.chair.lean, elapsed === 20000 ? "UP" : "WAIT");
    context = { ...context, watch: result.watch };
    assert.equal(selectiveBookOk(s, result.chair, context), elapsed === 20000);
  }
  const old = { ...context, watch: { ...context.watch!, mode: "normal" as const } };
  assert.equal(selectiveChair(snap({ as_of: now + 20000, obs: { ...snap().obs, receipt_ts: now + 19000 } }), tightChair(), old).watch?.frames, 1);
});

test("many settled calls with sufficient cents are not blocked by a hidden quota", () => {
  const calls = history(Array(12).fill(80));
  assert.equal(dailyAdmission(calls, now).calls, 12);
  assert.equal(selectiveBlock(snap(), chair(), ctx({ calls })), null);
});

test("production booking boundary enforces profit reserve after confirmation", async () => {
  const { api, events } = bookingHarness(); const e = engine();
  e.riskCalls = history([90, 90, 90, 90, 90]);
  await api.noteCall(e, snap(), chair());
  assert.equal(e.callLog.length, 0); assert.deepEqual(events, []);
});

test("production booking after a single loss remains possible when the setup qualifies", async () => {
  const { api, events } = bookingHarness(); const e = engine();
  e.riskCalls = history([82], [0]);
  await api.noteCall(e, snap(), chair());
  assert.equal(e.callLog.length, 1); assert.deepEqual(events, ["saved", "notified"]);
});

test("DOWN profit protection reserves the DOWN ask and fee, not the cheap UP quote", () => {
  const c = chair({ lean: "DOWN", score: -0.8, quorum: { up: 0, down: 3, wait: 15 },
    rows: chair().rows.map(r => ({ ...r, lean: "DOWN" })) });
  const s = snap({ no_ask: 82, no_bid: 81, yes_ask: 19, yes_bid: 18, edge_down: 6, lab_fair_yes: 10 });
  assert.match(selectiveBlock(s, c, ctx({ calls: history([90, 90, 90, 90, 90]) }))!, /protecting today's profit/);
});

test("a midnight settlement counts cents on the close day, including its fee", () => {
  const midnight = Date.parse("2026-09-16T05:00:00Z");
  const call = { ...row(midnight - 300_000), close_time: midnight };
  const d = dailyAdmission([call], midnight + 1000);
  assert.equal(d.calls, 0); assert.equal(d.wins, 1); assert.equal(d.net_cents, 16);
  assert.notEqual(dailyAdmission([call], NaN).reason, null);
});
