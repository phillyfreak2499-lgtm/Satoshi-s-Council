import assert from "node:assert/strict";
import test from "node:test";
import { auditAdmission } from "./admission-audit.ts";
import { DEPLOYED_POLICY, OWNER_REFERENCE_POLICY, gateVector, maxReachableQuorum, reachableQuorum, supporterRows } from "./gate-vector.ts";
import { SELECTIVE_PARAMS } from "./floor-policy.ts";
import { selectiveBlock, type SelectiveContext } from "./selective-entry.ts";
import type { ChairResult, SeatId, SeatRow, Snapshot } from "./types";

const now = Date.parse("2026-09-21T15:05:00Z");
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: now + 420_000, ticker: "KXBTC15M-26SEP211012-15", mins_left: 7, secs_left: 420,
  yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, no_bid_size: 40, yes_bid_size: 30,
  edge_up: 5, edge_down: -9, fair_yes: 91, fee_yes: 1, fee_no: 2,
  spread_cents: 1, leftover_cents: -1, spot_age_s: 1, lab_fair_yes: 92, lab_age_s: 1,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  ...extra,
} as Snapshot);
const seatRow = (seat: SeatId, lean: "UP" | "DOWN" | "WAIT", extra: Partial<SeatRow> = {}): SeatRow =>
  ({ seat, lean, health: "LIVE", status: "LIVE", folded: false, weight: 0.1, ...extra }) as SeatRow;
const chair = (rows: SeatRow[], extra: Partial<ChairResult> = {}): ChairResult => ({
  lean: "UP", score: 0.8, bar: 0.5, hard_fail: false, confidence: 80, calc: "test", gates: [{ id: "bar", label: "bar", pass: true, hard: true, value: "" }],
  quorum: { up: rows.filter((r) => r.lean === "UP" && !r.forced_sit).length, down: rows.filter((r) => r.lean === "DOWN" && !r.forced_sit).length, wait: rows.filter((r) => r.lean === "WAIT").length },
  rows, ...extra,
} as ChairResult);
const ctx = (extra: Partial<SelectiveContext> = {}): SelectiveContext => ({ calls: [], ready: true, start: now - 86_400_000, watch: null, ...extra });
const confirmed = (s: Snapshot): SelectiveContext => ctx({ watch: { key: `${s.ticker}|${s.close_time}`, side: "UP", since: s.as_of - 9000, last: s.as_of, frames: 3, mode: "normal" } });

const threeFamilies = [seatRow("STREAK", "UP"), seatRow("CHAIN", "UP"), seatRow("STRIKE", "UP"), seatRow("WICK", "WAIT"), seatRow("TAPE", "WAIT")];

test("the two policies are named and differ only in the supporter count", () => {
  assert.equal(DEPLOYED_POLICY.params.min_speaking, 2);
  assert.equal(OWNER_REFERENCE_POLICY.params.min_speaking, 3);
  assert.equal(DEPLOYED_POLICY.params, SELECTIVE_PARAMS);
  assert.deepEqual({ ...OWNER_REFERENCE_POLICY.params, min_speaking: 2 }, { ...SELECTIVE_PARAMS });
});

test("a synthetic fully qualified case passes every gate under BOTH policies (no gate is permanently false)", () => {
  const s = snap();
  for (const policy of [DEPLOYED_POLICY, OWNER_REFERENCE_POLICY]) {
    const v = gateVector(s, chair(threeFamilies), confirmed(s), policy);
    assert.deepEqual(v.failed, [], `${policy.id}: ${JSON.stringify(v.checks.filter((k) => k.pass !== true))}`);
    assert.deepEqual(v.not_evaluable, []);
    assert.equal(v.binding_reason, null);
    assert.equal(v.eligible_ignoring_confirmation, true);
  }
});

test("two supporters from two groups pass the deployed policy and fail ONLY the supporter check under the owner reference", () => {
  const s = snap();
  const rows = [seatRow("STREAK", "UP"), seatRow("CHAIN", "UP"), seatRow("WICK", "WAIT")];
  const dep = gateVector(s, chair(rows), confirmed(s), DEPLOYED_POLICY);
  assert.deepEqual(dep.failed, []);
  const own = gateVector(s, chair(rows), confirmed(s), OWNER_REFERENCE_POLICY);
  assert.deepEqual(own.failed, ["supporters"]);
  assert.equal(own.binding_reason, "at least 3 healthy supporters");
  assert.equal(own.checks.find((k) => k.id === "supporters")?.binding, true);
});

test("every check is evaluated even when the Chair is WAIT: side-dependent checks read null, the rest still report", () => {
  const s = snap();
  const v = gateVector(s, chair([seatRow("WICK", "WAIT"), seatRow("STREAK", "WAIT")], { lean: "WAIT", quorum: { up: 0, down: 0, wait: 2 } }), ctx(), DEPLOYED_POLICY);
  assert.equal(v.side, null);
  assert.equal(v.binding_reason, "waiting for a directional setup");
  assert.deepEqual(v.failed, ["direction"]);
  assert.ok(v.not_evaluable.includes("supporters") && v.not_evaluable.includes("quote"));
  assert.equal(v.checks.find((k) => k.id === "time")?.pass, true);
  assert.equal(v.checks.find((k) => k.id === "feeds")?.pass, true);
  assert.equal(v.checks.find((k) => k.id === "index_fresh")?.pass, true);
});

test("the family fold retains one eligible representative and excludes correlated members", () => {
  const rows = [seatRow("STRIKE", "UP"), seatRow("INDEX", "UP", { folded: true, status: "FOLDED" }), seatRow("WICK", "WAIT")];
  const q = reachableQuorum(chair(rows), "UP", DEPLOYED_POLICY, "normal");
  assert.deepEqual(q.supporters, ["STRIKE"]);
  assert.deepEqual(q.folded_excluded, ["INDEX"]);
  assert.equal(q.reachable, false);
  assert.equal(q.deficit.supporters, 1);
  assert.deepEqual(supporterRows(chair(rows), "UP").map((r) => r.seat), ["STRIKE"]);
});

test("support eligibility is distinct, fail-closed, and treats a live FADED row consistently", () => {
  const rows = [
    seatRow("STRIKE", "UP", { status: "FADED", weight: 0.03 }),
    seatRow("STRIKE", "UP", { status: "LIVE", weight: 0.04 }),
    seatRow("INDEX", "UP", { status: "LIVE", weight: 0 }),
    seatRow("DRIFT", "UP", { status: "INVERT", weight: 0.1 }),
    seatRow("STREAK", "UP", { forced_sit: true, weight: 0.1 }),
    seatRow("CHAIN", "UP", { health: "STALE", weight: 0.1 }),
  ];
  const q = reachableQuorum(chair(rows), "UP", DEPLOYED_POLICY, "normal");
  assert.deepEqual(q.supporters, ["STRIKE"]);
  assert.equal(q.status_excluded.includes("STRIKE"), false, "a counted representative is not also excluded");
  assert.deepEqual(supporterRows(chair(rows), "UP").map((r) => r.seat), ["STRIKE"]);
});

test("admission, gate diagnostics, and audit reject every invalid weight shape", () => {
  const badWeights: unknown[] = [undefined, null, "0.1", true, NaN, Infinity, -Infinity, 0, -0.01];
  const rows = [seatRow("STRIKE", "UP", { status: "FADED", weight: 0.03 })];
  const seats = ["INDEX", "DRIFT", "STREAK", "CHAIN", "WICK", "PULSE", "TAPE", "WHALE", "CARRY"] as SeatId[];
  badWeights.forEach((weight, i) => rows.push(seatRow(seats[i]!, "UP", { weight: weight as number })));
  const c = chair(rows);
  const context = confirmed(snap());
  const q = reachableQuorum(c, "UP", DEPLOYED_POLICY, "normal");
  assert.deepEqual(q.supporters, ["STRIKE"], "only the positive numeric FADED row counts");
  assert.match(selectiveBlock(snap(), c, context)!, /two healthy supporters/);
  assert.equal(gateVector(snap(), c, context).checks.find((check) => check.id === "supporters")?.pass, false);
  assert.equal(auditAdmission(snap(), c, context).checks.find((check) => check.id === "supporters")?.pass, false);
});

test("admission, gate diagnostics, and audit accept positive LIVE and FADED weights", () => {
  const c = chair([
    seatRow("STRIKE", "UP", { status: "FADED", weight: 0.03 }),
    seatRow("STREAK", "UP", { status: "LIVE", weight: 0.04 }),
  ]);
  const context = confirmed(snap());
  assert.deepEqual(supporterRows(c, "UP").map((row) => row.seat), ["STRIKE", "STREAK"]);
  assert.equal(selectiveBlock(snap(), c, context), null);
  assert.equal(gateVector(snap(), c, context).checks.find((check) => check.id === "supporters")?.pass, true);
  assert.equal(auditAdmission(snap(), c, context).checks.find((check) => check.id === "supporters")?.pass, true);
});

test("pit crew and CLOCK never count; forced sits are authority exclusions; opposition blocks", () => {
  const rows = [seatRow("STREAK", "UP"), seatRow("ORBIT", "UP"), seatRow("CLOCK", "UP"), seatRow("CASCADE", "WAIT", { forced_sit: true }), seatRow("TAPE", "DOWN")];
  const q = reachableQuorum(chair(rows), "UP", DEPLOYED_POLICY, "normal");
  assert.deepEqual(q.supporters, ["STREAK"]);
  assert.deepEqual(q.context_excluded, ["ORBIT", "CLOCK"]);
  assert.deepEqual(q.authority_excluded, ["CASCADE"]);
  assert.equal(q.opposition, 1);
  assert.equal(q.reachable, false);
  assert.deepEqual(q.deficit, { supporters: 1, families: 1, opposition: 1 });
});

test("uncalibrated and stale seats are status exclusions; tight mode raises the bar to 4 from 3", () => {
  const rows = [seatRow("STREAK", "UP", { status: "UNCALIBRATED" }), seatRow("CHAIN", "UP", { health: "STALE" }), seatRow("STRIKE", "UP"), seatRow("DRIFT", "UP")];
  const normal = reachableQuorum(chair(rows), "UP", DEPLOYED_POLICY, "normal");
  assert.deepEqual(normal.status_excluded, ["STREAK", "CHAIN"]);
  assert.deepEqual(normal.supporters, ["STRIKE", "DRIFT"]);
  assert.equal(normal.reachable, true);
  const tight = reachableQuorum(chair(rows), "UP", DEPLOYED_POLICY, "tight");
  assert.deepEqual(tight.required, { supporters: 4, families: 3, max_opposing: 0 });
  assert.equal(tight.reachable, false);
});

test("maxReachableQuorum reports the closer side on a WAIT table", () => {
  const rows = [seatRow("STREAK", "DOWN"), seatRow("CHAIN", "DOWN"), seatRow("STRIKE", "UP")];
  const m = maxReachableQuorum(chair(rows, { lean: "WAIT" }), DEPLOYED_POLICY, "normal");
  assert.equal(m.best.side, "DOWN");
  assert.equal(m.best.reachable, false, "opposition of one blocks even a two-family DOWN");
  assert.equal(m.best.deficit.opposition, 1);
});

test("stale quotes, missing size, an ask under the floor and a chalk book each fail their own check, not a generic one", () => {
  const s = snap();
  const c = chair(threeFamilies);
  assert.deepEqual(gateVector(snap({ yes_ask: 79, yes_bid: 78 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["quote"]);
  assert.deepEqual(gateVector(snap({ no_bid_size: 0 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["quote"]);
  // Chalk fails the quote check AND the index margin independently: both are reported, not the first only.
  assert.deepEqual(gateVector(snap({ yes_ask: 99, yes_bid: 98 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["quote", "index_edge"]);
  assert.deepEqual(gateVector(snap({ spot_age_s: 20 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["feeds"]);
  assert.deepEqual(gateVector(snap({ edge_up: 2 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["model_edge"]);
  assert.deepEqual(gateVector(snap({ lab_fair_yes: 85 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["index_edge"]);
  assert.deepEqual(gateVector(snap({ lab_age_s: 9 }), c, confirmed(s), DEPLOYED_POLICY).failed, ["index_fresh"]);
  const late = snap({ close_time: now + 120_000 });
  assert.deepEqual(gateVector(late, c, confirmed(late), DEPLOYED_POLICY).failed, ["time"]);
  const unconfirmed = gateVector(s, c, ctx(), DEPLOYED_POLICY);
  assert.deepEqual(unconfirmed.failed, ["confirmation"]);
  assert.equal(unconfirmed.eligible_ignoring_confirmation, true);
});
