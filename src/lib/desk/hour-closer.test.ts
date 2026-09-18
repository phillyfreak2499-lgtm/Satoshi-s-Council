/**
 * The hourly closer — frozen fixtures.
 *
 * A settled KXBTCD hour becomes one WAIT sit on the rung nearest the official
 * close; an unsettled hour is skipped and left missing; nothing is a fill;
 * the same record run twice produces the same rows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeHourWindows,
  HOUR_CLOSER_LOOKBACK_MS,
  HOUR_CLOSER_SOURCE,
  isSettled,
  officialValue,
  postureAtClose,
  settledSide,
} from "./hour-closer.ts";
import type { HourMarketRow } from "./hour.ts";

// 2026-09-18 16:20 UTC = 12:20 PM Eastern (EDT). The noon hour (16:00 UTC) closed twenty minutes ago.
const NOW = Date.parse("2026-09-18T16:20:00.000Z");

/** A settled rung: "$strike or above" on the hour ending at `hh` Eastern on Sept 18. */
function rung(hh: string, strike: number, result: "yes" | "no" | "", over: Partial<HourMarketRow> = {}): HourMarketRow {
  const closeUtc = `2026-09-18T${String(Number(hh) + 4).padStart(2, "0")}:00:00Z`;
  return {
    ticker: `KXBTCD-26SEP18${hh}-T${strike}`,
    event_ticker: `KXBTCD-26SEP18${hh}`,
    close_time: closeUtc,
    status: result ? "settled" : "closed",
    result,
    floor_strike: strike,
    strike_type: "greater",
    title: `Bitcoin price at ${Number(hh) > 12 ? Number(hh) - 12 : hh}${Number(hh) >= 12 ? "pm" : "am"} EDT?`,
    yes_sub_title: `$${strike.toLocaleString("en-US")} or above`,
    expiration_value: result ? "78123.45" : undefined,
    ...over,
  };
}

// The noon hour: official close 78,123.45. Rungs at 77,500 / 78,000 / 78,500 / 79,000.
const NOON = [rung("12", 77500, "yes"), rung("12", 78000, "yes"), rung("12", 78500, "no"), rung("12", 79000, "no")];

test("a settled hour becomes exactly one WAIT sit on the rung nearest the official close, with no fill", () => {
  const pass = closeHourWindows(NOON, NOW);
  assert.equal(pass.rows.length, 1);
  assert.deepEqual(pass.skipped, []);
  const r = pass.rows[0]!;
  assert.equal(r.ticker, "KXBTCD-26SEP1812-T78000", "78,000 is the rung nearest 78,123.45");
  assert.equal(r.event_ticker, "KXBTCD-26SEP1812");
  assert.equal(r.close_time, "2026-09-18T16:00:00.000Z", "noon Eastern is 16:00 UTC in September");
  assert.equal(r.strike, 78000);
  assert.equal(r.chair_lean, "WAIT");
  assert.equal(r.result, "YES", "78,123.45 is at or above 78,000, and Kalshi said yes");
  assert.equal(r.official_value, 78123.45);
  assert.equal(r.source, HOUR_CLOSER_SOURCE);
  assert.equal(r.authority, "none");
  assert.equal(r.pick, "nearest-official");
  assert.equal(r.ladder, 4);
  assert.equal(r.question, "Bitcoin price at 12pm EDT: yes pays if $78,000 or above.");
  for (const k of ["entry_side", "entry_cents", "entry_fee_cents", "settle_cents", "ev_cents"] as const) assert.equal(r[k], null, `${k} is never invented`);
  assert.doesNotMatch(JSON.stringify(r), /"UP"|"DOWN"/, "a strike ladder, never the 15-minute sides");
});

test("the posture at close is WAIT while no hourly rule is frozen and marked live", () => {
  assert.equal(postureAtClose(), "WAIT");
});

test("an unsettled hour is skipped and left missing; a settled hour with no result is skipped too; nothing is guessed", () => {
  const eleven = [rung("11", 78000, ""), rung("11", 78500, "")];
  const ten = [rung("10", 78000, "", { status: "settled" }), rung("10", 78500, "", { status: "settled" })];
  const pass = closeHourWindows([...eleven, ...ten, ...NOON], NOW);
  assert.equal(pass.rows.length, 1);
  assert.equal(pass.rows[0]!.event_ticker, "KXBTCD-26SEP1812");
  assert.deepEqual(pass.skipped, [
    { event_ticker: "KXBTCD-26SEP1810", close_time: "2026-09-18T14:00:00.000Z", reason: "no-result" },
    { event_ticker: "KXBTCD-26SEP1811", close_time: "2026-09-18T15:00:00.000Z", reason: "unsettled" },
  ]);
});

test("hours outside the lookback, hours still in the future, and the 15-minute series are never graded", () => {
  const old = [rung("08", 78000, "yes")]; // 12:00 UTC, more than three hours before NOW
  const future = [rung("13", 78000, "yes")]; // 17:00 UTC, not closed yet
  const fifteen: HourMarketRow[] = [{ ticker: "KXBTC15M-26SEP181615-45", close_time: "2026-09-18T16:15:00Z", status: "settled", result: "yes" }];
  const pass = closeHourWindows([...old, ...future, ...fifteen, ...NOON], NOW);
  assert.deepEqual(pass.rows.map((r) => r.event_ticker), ["KXBTCD-26SEP1812"]);
  assert.equal(HOUR_CLOSER_LOOKBACK_MS, 3 * 60 * 60 * 1000);
  assert.equal(closeHourWindows(undefined, NOW).rows.length, 0);
});

test("a rung whose provider close disagrees with its ticker is distrusted, and the middle rung is used when no official value is exposed", () => {
  const drift = rung("12", 78000, "yes", { close_time: "2026-09-18T20:00:00Z" });
  const noValue = [rung("12", 77500, "yes", { expiration_value: undefined }), rung("12", 78500, "no", { expiration_value: undefined }), rung("12", 79000, "no", { expiration_value: undefined })];
  const pass = closeHourWindows([drift, ...noValue], NOW);
  assert.equal(pass.rows.length, 1);
  const r = pass.rows[0]!;
  assert.equal(r.pick, "middle-rung");
  assert.equal(r.ticker, "KXBTCD-26SEP1812-T78500");
  assert.equal(r.official_value, null);
  assert.equal(r.result, "NO");
  assert.equal(r.ladder, 3, "the drifted rung is not on the ladder");
});

test("the closer is deterministic: the same settled record yields the same rows, so a rerun writes nothing new", () => {
  const a = closeHourWindows(NOON, NOW);
  const b = closeHourWindows([...NOON].reverse(), NOW + 60_000);
  assert.deepEqual(a.rows, b.rows);
});

test("settlement is read from Kalshi's own result field only", () => {
  assert.equal(settledSide({ result: "yes" }), "YES");
  assert.equal(settledSide({ result: "NO" }), "NO");
  assert.equal(settledSide({ result: "" }), null);
  assert.equal(settledSide({ status: "settled" }), null, "a settled status with no result is not a side");
  assert.equal(isSettled({ status: "finalized" }), true);
  assert.equal(isSettled({ status: "open" }), false);
  assert.equal(officialValue({ expiration_value: "0" }), null);
  assert.equal(officialValue({ expiration_value: 78000.5 }), 78000.5);
});
