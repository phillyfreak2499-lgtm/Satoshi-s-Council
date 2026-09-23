/**
 * Family-fold vs selective-entry supporter accounting.
 *
 * Fixtures use production seat IDs and EVIDENCE_OF families. They are labelled
 * synthetic: they prove current module behavior, not a historical fill.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { paperBookTeamOk } from "./book-floor.ts";
import {
  authorizedBeforeFold,
  familySupport,
  pickAuthorizedRepresentative,
} from "./family-support.ts";
import { EVIDENCE_OF } from "./seats.ts";
import {
  admissionRequirements,
  dailyAdmission,
  selectiveBlock,
  selectiveBookOk,
  selectiveChair,
  type SelectiveContext,
} from "./selective-entry.ts";
import type { CallLogRow, ChairResult, SeatId, SeatRow, Snapshot } from "./types.ts";

const now = Date.parse("2026-09-16T15:05:00Z");

const snap = (extra: Partial<Snapshot> = {}): Snapshot =>
  ({
    as_of: now,
    close_time: now + 600_000,
    ticker: "KXBTC15M-26SEP161015-15",
    mins_left: 10,
    secs_left: 600,
    yes_ask: 82,
    yes_bid: 81,
    no_ask: 19,
    no_bid: 18,
    no_bid_size: 5,
    yes_bid_size: 7,
    edge_up: 6,
    edge_down: -8,
    fair_yes: 90,
    fee_yes: 2,
    fee_no: 2,
    spread_cents: 1,
    leftover_cents: -1,
    spot_age_s: 1,
    lab_fair_yes: 90,
    lab_age_s: 1,
    obs: { receipt_ts: now - 1000, gap: "ok" },
    health: {
      spot_ok: true,
      kalshi_ok: true,
      spot: "LIVE",
      kalshi: "LIVE",
      spot_divergent: false,
      basis_wide: false,
    },
    ...extra,
  }) as Snapshot;

const row = (
  seat: SeatId,
  extra: Partial<SeatRow> = {},
): SeatRow =>
  ({
    seat,
    lean: "UP",
    health: "LIVE",
    status: "LIVE",
    folded: false,
    ...extra,
  }) as SeatRow;

const chairOf = (
  rows: SeatRow[],
  extra: Partial<ChairResult> = {},
): ChairResult =>
  ({
    lean: "UP",
    score: 0.8,
    bar: 0.5,
    hard_fail: false,
    confidence: 80,
    calc: "synthetic-family-support",
    gates: [{ id: "bar", label: "bar", hard: true, pass: true, value: "pass" }],
    quorum: { up: Math.max(rows.filter((r) => r.lean === "UP").length, 2), down: 0, wait: 15 },
    rows,
    ...extra,
  }) as ChairResult;

const ctx = (extra: Partial<SelectiveContext> = {}): SelectiveContext => ({
  calls: [],
  ready: true,
  start: now - 86_400_000,
  watch: null,
  ...extra,
});

test("fold groups and entry families are not the same map", () => {
  assert.equal(EVIDENCE_OF.CARRY, "derivs");
  assert.equal(EVIDENCE_OF.CHAIN, "derivs");
  assert.equal(EVIDENCE_OF.STREAK, "history");
  assert.equal(EVIDENCE_OF.STRIKE, "book");
  assert.equal(EVIDENCE_OF.DRIFT, "candle");
  assert.equal(EVIDENCE_OF.WICK, "candle");
  assert.equal(EVIDENCE_OF.ORBIT, "context");
});

test("synthetic A1+B1 two families remain two supporters / two families", () => {
  const support = familySupport([row("CARRY"), row("STREAK")], "UP");
  assert.equal(support.supporterCount, 2);
  assert.equal(support.familyCount, 2);
  assert.deepEqual(support.families.sort(), ["derivs", "history"]);
  assert.equal(selectiveBlock(snap(), chairOf([row("CARRY"), row("STREAK")]), ctx()), null);
});

test("adding an agreeing same-family specialist does not erase the family", () => {
  const afterFold = [
    row("CARRY", { folded: true, status: "LIVE" }),
    row("CHAIN", { folded: true, status: "FOLDED" }),
    row("STREAK"),
  ];
  const support = familySupport(afterFold, "UP");
  assert.equal(support.supporterCount, 2);
  assert.equal(support.familyCount, 2);
  assert.ok(support.seats.includes("CARRY"));
  assert.ok(!support.seats.includes("CHAIN"));
  assert.equal(selectiveBlock(snap(), chairOf(afterFold), ctx()), null);
});

test("correlated specialists alone never satisfy the independent-family requirement", () => {
  const onlyDerivs = [
    row("CARRY", { folded: true, status: "LIVE" }),
    row("CHAIN", { folded: true, status: "FOLDED" }),
  ];
  const support = familySupport(onlyDerivs, "UP");
  assert.equal(support.supporterCount, 1);
  assert.equal(support.familyCount, 1);
  assert.match(selectiveBlock(snap(), chairOf(onlyDerivs), ctx())!, /two evidence groups/);
});

test("legacy all-FOLDED status still contributes zero supporters — the reported defect", () => {
  const erased = [
    row("CARRY", { folded: true, status: "FOLDED" }),
    row("CHAIN", { folded: true, status: "FOLDED" }),
    row("STREAK", { folded: true, status: "FOLDED" }),
  ];
  const support = familySupport(erased, "UP");
  assert.equal(support.supporterCount, 0);
  assert.equal(support.familyCount, 0);
  assert.notEqual(selectiveBlock(snap(), chairOf(erased), ctx()), null);
});

test("ineligible members do not restore or inflate support", () => {
  const mixed = [
    row("CARRY", { folded: true, status: "LIVE" }),
    row("CHAIN", { folded: true, status: "UNCALIBRATED" }),
    row("CASCADE", { health: "DOWN", status: "DOWN" }),
    row("ORBIT", { status: "LIVE" }),
    row("WARDEN", { status: "LIVE" }),
    row("STREAK"),
  ];
  const support = familySupport(mixed, "UP");
  assert.equal(support.supporterCount, 2);
  assert.equal(support.familyCount, 2);
  assert.deepEqual(support.seats.sort(), ["CARRY", "STREAK"]);
  assert.equal(selectiveBlock(snap(), chairOf(mixed), ctx()), null);

  const onlyUncalibratedFamily = [
    row("CARRY", { status: "UNCALIBRATED", folded: true }),
    row("CHAIN", { status: "FOLDED", folded: true }),
    row("STREAK"),
  ];
  const one = familySupport(onlyUncalibratedFamily, "UP");
  assert.equal(one.supporterCount, 1);
  assert.equal(one.familyCount, 1);
  assert.match(selectiveBlock(snap(), chairOf(onlyUncalibratedFamily), ctx())!, /two evidence groups/);
});

test("a FOLDED label is not itself authorization", () => {
  assert.equal(authorizedBeforeFold(row("CARRY", { status: "FOLDED", folded: true })), false);
  assert.equal(authorizedBeforeFold(row("CARRY", { status: "UNCALIBRATED" })), false);
  assert.equal(authorizedBeforeFold(row("CARRY", { health: "STALE", status: "LIVE" })), false);
  assert.equal(authorizedBeforeFold(row("ORBIT")), false);
  assert.equal(authorizedBeforeFold(row("CARRY")), true);
});

test("representative selection is deterministic under reorder and duplicate rows", () => {
  const members = [
    { seat: "CHAIN" as SeatId, w: 0.4, status: "LIVE" as const, health: "LIVE" as const },
    { seat: "CARRY" as SeatId, w: 0.4, status: "LIVE" as const, health: "LIVE" as const },
    { seat: "CASCADE" as SeatId, w: 0.2, status: "LIVE" as const, health: "LIVE" as const },
  ];
  const pick = (list: typeof members) =>
    pickAuthorizedRepresentative(list, {
      authorized: (m) => m.status === "LIVE" && m.health === "LIVE",
      weight: (m) => m.w,
      seat: (m) => m.seat,
    })?.seat;
  assert.equal(pick(members), "CARRY");
  assert.equal(pick([...members].reverse()), "CARRY");

  const dup = [row("STREAK"), row("STREAK"), row("CARRY"), row("CARRY")];
  const support = familySupport(dup.reverse(), "UP");
  assert.deepEqual(support.seats, ["CARRY", "STREAK"]);
  assert.equal(support.supporterCount, 2);
  assert.equal(selectiveBlock(snap(), chairOf(dup), ctx()), null);
});

test("opposing votes still block when policy requires zero opposition", () => {
  const rows = [row("CARRY", { folded: true }), row("STREAK")];
  const opposed = chairOf(rows, { quorum: { up: 2, down: 1, wait: 14 } });
  assert.match(selectiveBlock(snap(), opposed, ctx())!, /no opposing vote/);
});

test("normal and tightened mode keep their configured requirements", () => {
  const loss: CallLogRow = {
    id: "loss",
    ticker: "window-loss",
    t: now - 3_600_000,
    close_time: now - 2_700_000,
    lean: "UP",
    cents: 82,
    settle: 0,
    flipped: false,
  };
  const tightDay = dailyAdmission(
    [
      loss,
      { ...loss, id: "loss-2", t: now - 2_400_000, close_time: now - 1_500_000, ticker: "window-loss-2" },
    ],
    now,
  );
  assert.equal(tightDay.tightened, true);
  const req = admissionRequirements(tightDay);
  assert.equal(req.min_speaking, 4);
  assert.equal(req.min_families, 3);

  const twoFamily = chairOf([
    row("CARRY", { folded: true, status: "LIVE" }),
    row("CHAIN", { folded: true, status: "FOLDED" }),
    row("STREAK"),
  ]);
  assert.match(selectiveBlock(snap(), twoFamily, ctx({ calls: [loss, { ...loss, id: "loss-2", t: now - 2_400_000, close_time: now - 1_500_000, ticker: "window-loss-2" }] }))!, /tighter mode/);

  const fourFamily = chairOf([
    row("CARRY"),
    row("STREAK"),
    row("STRIKE"),
    row("DRIFT"),
  ], { quorum: { up: 4, down: 0, wait: 14 } });
  assert.equal(familySupport(fourFamily.rows, "UP").familyCount, 4);
});

test("supporter failure is distinct from other entry gates", () => {
  const team = chairOf([row("CARRY", { folded: true }), row("STREAK")]);
  assert.equal(selectiveBlock(snap(), team, ctx()), null);
  assert.match(selectiveBlock(snap({ close_time: now + 86_000 }), team, ctx())!, /3–10 minutes/);
  assert.match(selectiveBlock(snap({ edge_up: 1 }), team, ctx())!, /model edge/);
  assert.notEqual(paperBookTeamOk(chairOf([row("STREAK")], { quorum: { up: 1, down: 0, wait: 17 } }), "UP"), true);
});

test("confirmation and book latch still refuse a sub-180s observation", () => {
  const team = chairOf([row("CARRY", { folded: true }), row("STREAK")]);
  const late = snap({ close_time: now + 179_000, secs_left: 179 });
  assert.notEqual(selectiveBlock(late, team, ctx()), null);
  assert.equal(selectiveBookOk(late, team, ctx()), false);
  const held = snap();
  const open: CallLogRow = {
    id: "open",
    ticker: held.ticker,
    t: held.as_of - 10_000,
    close_time: held.close_time,
    lean: "UP",
    cents: 82,
    settle: null,
    flipped: false,
  };
  const paused = selectiveChair(held, chairOf(team.rows, { lean: "WAIT" }), ctx({ calls: [open] }));
  assert.equal(paused.chair.lean, "WAIT");
  assert.equal(paused.watch, null);
});

test("matched valid fixture keeps the supplied Chair score and lean", () => {
  const c = chairOf([row("CARRY", { folded: true }), row("STREAK")], { score: -0.5120924410467451, lean: "DOWN", quorum: { up: 0, down: 2, wait: 16 } });
  const downRows = c.rows.map((r) => ({ ...r, lean: "DOWN" as const }));
  const downChair = chairOf(downRows, { lean: "DOWN", score: -0.5120924410467451, quorum: { up: 0, down: 2, wait: 16 } });
  const s = snap({ no_ask: 82, no_bid: 81, yes_ask: 19, yes_bid: 18, edge_down: 6, lab_fair_yes: 10 });
  assert.equal(selectiveBlock(s, downChair, ctx()), null);
  const after = selectiveChair(s, downChair, ctx());
  assert.equal(after.chair.score, -0.5120924410467451);
  assert.equal(after.chair.lean, "DOWN");
});
