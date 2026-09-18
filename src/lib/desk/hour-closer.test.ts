/**
 * The hourly closer — frozen fixtures.
 *
 * Each closed hour is graded from its own whole ladder: a settled KXBTCD
 * hour becomes one WAIT sit on the rung nearest the official close; an
 * incomplete ladder, an unsettled rung, a missing official value or an
 * official value off the ladder is a skip; nothing is a fill; the same
 * ladder graded twice yields the same row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeHourLadder,
  HOUR_CLOSER_LOOKBACK_MS,
  HOUR_CLOSER_SOURCE,
  hourEventsInLookback,
  hourEventTicker,
  isSettled,
  officialValue,
  postureAtClose,
  settledSide,
  type HourEvent,
} from "./hour-closer.ts";
import type { HourMarketRow } from "./hour.ts";

// 2026-09-18 16:20 UTC = 12:20 PM Eastern (EDT). The noon hour (16:00 UTC) closed twenty minutes ago.
const NOW = Date.parse("2026-09-18T16:20:00.000Z");

function hour(hh: string): HourEvent {
  const close_ms = Date.parse(`2026-09-18T${String(Number(hh) + 4).padStart(2, "0")}:00:00Z`);
  return { event_ticker: `KXBTCD-26SEP18${hh}`, close_ms, close_time: new Date(close_ms).toISOString() };
}

/** A rung: "$strike or above" on the hour ending at `hh` Eastern on Sept 18. */
function rung(hh: string, strike: number, result: "yes" | "no" | "", official: string | undefined, over: Partial<HourMarketRow> = {}): HourMarketRow {
  return {
    ticker: `KXBTCD-26SEP18${hh}-T${strike}`,
    event_ticker: `KXBTCD-26SEP18${hh}`,
    close_time: hour(hh).close_time,
    status: result ? "settled" : "closed",
    result,
    floor_strike: strike,
    strike_type: "greater",
    title: `Bitcoin price at ${Number(hh) > 12 ? Number(hh) - 12 : hh}${Number(hh) >= 12 ? "pm" : "am"} EDT?`,
    yes_sub_title: `$${strike.toLocaleString("en-US")} or above`,
    expiration_value: official,
    ...over,
  };
}

/** A full production-sized ladder: 188 rungs, $50 apart, settled against one official close. */
function ladderOf(hh: string, official: number, from = 74_000, rungs = 188, step = 50): HourMarketRow[] {
  return Array.from({ length: rungs }, (_, i) => {
    const strike = from + i * step + 0.01;
    return rung(hh, strike, official >= strike ? "yes" : "no", String(official));
  });
}

test("the closed hours in the lookback are named the way Kalshi names its events, Eastern date and hour", () => {
  const hours = hourEventsInLookback(NOW);
  assert.deepEqual(hours.map((h) => h.event_ticker), ["KXBTCD-26SEP1812", "KXBTCD-26SEP1811", "KXBTCD-26SEP1810"], "16:00, 15:00 and 14:00 UTC closed inside the last three hours; 13:00 did not");
  assert.equal(hours[0]!.close_time, "2026-09-18T16:00:00.000Z", "noon Eastern is 16:00 UTC in September");
  assert.equal(hours[2]!.close_time, "2026-09-18T14:00:00.000Z");
  assert.equal(HOUR_CLOSER_LOOKBACK_MS, 3 * 60 * 60 * 1000);
  assert.equal(hourEventTicker(Date.parse("2026-12-01T14:00:00Z")), "KXBTCD-26DEC0109", "9 AM EST is 14:00 UTC in December");
  assert.equal(hourEventTicker(Date.parse("2026-09-18T04:00:00Z")), "KXBTCD-26SEP1800", "midnight Eastern is hour 00");
});

test("a full 188-rung ladder yields exactly one WAIT sit on the rung nearest the official close, with no fill", () => {
  const out = closeHourLadder(hour("12"), { markets: ladderOf("12", 78_123.45), complete: true });
  assert.ok(out.row, "graded");
  const r = out.row;
  assert.equal(r.ticker, "KXBTCD-26SEP1812-T78100.01", "78,100.01 is the rung nearest 78,123.45 on a $50 ladder");
  assert.equal(r.strike, 78_100.01);
  assert.equal(r.event_ticker, "KXBTCD-26SEP1812");
  assert.equal(r.close_time, "2026-09-18T16:00:00.000Z");
  assert.equal(r.chair_lean, "WAIT");
  assert.equal(r.result, "YES", "78,123.45 is at or above 78,100.01, and Kalshi said yes");
  assert.equal(r.official_value, 78_123.45);
  assert.equal(r.source, HOUR_CLOSER_SOURCE);
  assert.equal(r.authority, "none");
  assert.equal(r.pick, "nearest-official");
  assert.equal(r.ladder, 188);
  for (const k of ["entry_side", "entry_cents", "entry_fee_cents", "settle_cents", "ev_cents"] as const) assert.equal(r[k], null, `${k} is never invented`);
  assert.doesNotMatch(JSON.stringify(r), /"UP"|"DOWN"/, "a strike ladder, never the 15-minute sides");
});

test("more than 200 settled markets across three hours grade to one row per hour, each on its own nearest rung", () => {
  const hours = [hour("10"), hour("11"), hour("12")];
  const officials = { "10": 77_996.09, "11": 76_240.5, "12": 78_123.45 } as const;
  const rows = hours.map((h) => {
    const hh = h.event_ticker.slice(-2) as keyof typeof officials;
    const out = closeHourLadder(h, { markets: ladderOf(hh, officials[hh]), complete: true });
    assert.ok(out.row, `${h.event_ticker} graded`);
    return out.row;
  });
  assert.equal(3 * 188, 564, "the fixture is well past the old 200-market cap");
  assert.deepEqual(rows.map((r) => r.ticker), ["KXBTCD-26SEP1810-T78000.01", "KXBTCD-26SEP1811-T76250.01", "KXBTCD-26SEP1812-T78100.01"]);
  assert.deepEqual(rows.map((r) => r.official_value), [77_996.09, 76_240.5, 78_123.45]);
  for (const r of rows) assert.ok(Math.abs(r.strike - r.official_value) <= 25, `${r.ticker} sits within half a rung of the official close`);
});

test("the far strike production wrote is impossible once the ladder is complete: 84,699.99 against 77,996.09 loses to 78,000.01", () => {
  const partial = ladderOf("08", 77_996.09, 84_000, 20); // only the top of the ladder came back, as the 200-cap list did
  const far = closeHourLadder({ event_ticker: "KXBTCD-26SEP1808", close_ms: Date.parse("2026-09-18T12:00:00Z"), close_time: "2026-09-18T12:00:00.000Z" }, { markets: partial, complete: true });
  assert.equal(far.skip?.reason, "off-ladder", "the official close is below every rung that arrived, so nothing is chosen");
  const whole = closeHourLadder({ event_ticker: "KXBTCD-26SEP1808", close_ms: Date.parse("2026-09-18T12:00:00Z"), close_time: "2026-09-18T12:00:00.000Z" }, { markets: ladderOf("08", 77_996.09), complete: true });
  assert.equal(whole.row?.ticker, "KXBTCD-26SEP1808-T78000.01");
});

test("an incomplete ladder is skipped, never a far strike", () => {
  const out = closeHourLadder(hour("12"), { markets: ladderOf("12", 78_123.45), complete: false });
  assert.equal(out.skip?.reason, "incomplete");
  assert.equal(closeHourLadder(hour("12"), { markets: [], complete: true }).skip?.reason, "empty");
});

test("an unsettled rung, a missing result, a missing official value, and an official value off the ladder are all skips", () => {
  const full = ladderOf("12", 78_123.45);
  const oneOpen = [...full.slice(0, 100), { ...full[100]!, status: "closed", result: "" }, ...full.slice(101)];
  assert.equal(closeHourLadder(hour("12"), { markets: oneOpen, complete: true }).skip?.reason, "unsettled");
  const noResult = full.map((m) => ({ ...m, status: "settled", result: "" }));
  assert.equal(closeHourLadder(hour("12"), { markets: noResult, complete: true }).skip?.reason, "no-result");
  const noOfficial = full.map((m) => ({ ...m, expiration_value: undefined }));
  assert.equal(closeHourLadder(hour("12"), { markets: noOfficial, complete: true }).skip?.reason, "no-official");
  const crashed = full.map((m) => ({ ...m, expiration_value: "60000" }));
  assert.equal(closeHourLadder(hour("12"), { markets: crashed, complete: true }).skip?.reason, "off-ladder");
});

test("rungs from another hour, the 15-minute series, drifted provider clocks and between-buckets are not on this hour's ladder", () => {
  const full = ladderOf("12", 78_123.45);
  const noise: HourMarketRow[] = [
    ...ladderOf("11", 76_240.5, 74_000, 10),
    { ticker: "KXBTC15M-26SEP181615-45", close_time: "2026-09-18T16:15:00Z", status: "settled", result: "yes" },
    rung("12", 78_120, "yes", "78123.45", { close_time: "2026-09-18T20:00:00Z" }),
    { ...rung("12", 78_110, "yes", "78123.45"), ticker: "KXBTCD-26SEP1812-B78110" },
  ];
  const out = closeHourLadder(hour("12"), { markets: [...noise, ...full], complete: true });
  assert.equal(out.row?.ticker, "KXBTCD-26SEP1812-T78100.01", "the drifted 78,120 rung and the between-bucket are not candidates");
  assert.equal(out.row?.ladder, 188);
});

test("the closer is deterministic: the same ladder in any order yields the same row", () => {
  const a = closeHourLadder(hour("12"), { markets: ladderOf("12", 78_123.45), complete: true });
  const b = closeHourLadder(hour("12"), { markets: [...ladderOf("12", 78_123.45)].reverse(), complete: true });
  assert.deepEqual(a.row, b.row);
});

test("the posture at close is WAIT while no hourly rule is frozen and marked live, and settlement is read from Kalshi's own fields", () => {
  assert.equal(postureAtClose(), "WAIT");
  assert.equal(settledSide({ result: "yes" }), "YES");
  assert.equal(settledSide({ result: "NO" }), "NO");
  assert.equal(settledSide({ result: "" }), null);
  assert.equal(settledSide({ status: "settled" }), null, "a settled status with no result is not a side");
  assert.equal(isSettled({ status: "finalized" }), true);
  assert.equal(isSettled({ status: "open" }), false);
  assert.equal(officialValue({ expiration_value: "0" }), null);
  assert.equal(officialValue({ expiration_value: 78000.5 }), 78000.5);
});
