import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_TOLERANCE_MS,
  faultLine,
  matchSettle,
  onGrid,
  tickerAgrees,
  tickerCloseMs,
  WINDOW_GRID_MS,
  type SettleLike,
} from "./window-identity.ts";

const ms = (iso: string) => Date.parse(iso);
const settle = (ticker: string, close: string, lean: "UP" | "DOWN" = "UP"): SettleLike => ({
  ticker,
  close_time: ms(close),
  lean,
});

// ---------------------------------------------------------------------------
// The ticker's own embedded close time, checked against the real encoding.
// ---------------------------------------------------------------------------

test("a ticker decodes to its close in Eastern time", () => {
  // Verified against clean ledger rows: KXBTC15M-26SEP110800-00 is the market
  // closing 08:00 America/New_York, which in September is 12:00 UTC.
  assert.equal(tickerCloseMs("KXBTC15M-26SEP110800-00"), ms("2026-09-11T12:00:00Z"));
  assert.equal(tickerCloseMs("KXBTC15M-26SEP110745-45"), ms("2026-09-11T11:45:00Z"));
  assert.equal(tickerCloseMs("KXBTC15M-26SEP100300-00"), ms("2026-09-10T07:00:00Z"));
});

test("the minute suffix is a strike bucket, not a second time", () => {
  // -15 and -45 are strike buckets; the embedded time is what decides.
  assert.equal(tickerCloseMs("KXBTC15M-26SEP110715-15"), ms("2026-09-11T11:15:00Z"));
  assert.equal(tickerCloseMs("KXBTC15M-26SEP110730-30"), ms("2026-09-11T11:30:00Z"));
});

test("the Eastern offset is resolved per date, not assumed", () => {
  // January is EST (UTC-5), September is EDT (UTC-4). A fixed offset would put
  // one of these an hour wrong.
  assert.equal(tickerCloseMs("KXBTC15M-26JAN150800-00"), ms("2026-01-15T13:00:00Z"));
  assert.equal(tickerCloseMs("KXBTC15M-26SEP150800-00"), ms("2026-09-15T12:00:00Z"));
});

test("an unparseable ticker is not a disagreement", () => {
  // The format belongs to the exchange. A renamed series must degrade to the
  // other checks rather than stop the desk grading anything at all.
  assert.equal(tickerCloseMs("SOMETHING-ELSE"), null);
  assert.equal(tickerAgrees("SOMETHING-ELSE", ms("2026-09-11T12:00:00Z")), null);
  assert.equal(tickerCloseMs("KXBTC15M-26XXX110800-00"), null, "a bad month is unparseable, not month 0");
});

test("grid check accepts quarter hours only", () => {
  assert.equal(onGrid(ms("2026-09-11T12:00:00Z")), true);
  assert.equal(onGrid(ms("2026-09-11T12:15:00Z")), true);
  assert.equal(onGrid(ms("2026-09-11T12:07:00Z")), false);
  assert.equal(onGrid(ms("2026-09-11T12:15:01Z")), false);
  assert.equal(onGrid(0), false);
  assert.equal(WINDOW_GRID_MS, 900_000);
});

// ---------------------------------------------------------------------------
// THE REGRESSION. The 2026-09-10 07:15–09:00 failure, reproduced.
// ---------------------------------------------------------------------------

test("REGRESSION: one ticker's settle cannot grade eight later windows", () => {
  // Production, 2026-09-10: the feed stopped advancing the ticker, so every
  // pending window carried KXBTC15M-26SEP100300-00 (the 07:00 market) and the
  // old matcher handed that market's settlement to all of them. Nine ledger rows
  // ended up with one ticker and one official_value.
  const stale = "KXBTC15M-26SEP100300-00";
  const settles = [settle(stale, "2026-09-10T07:00:00Z")];

  // The legitimate window still grades.
  const good = matchSettle(settles, stale, ms("2026-09-10T07:00:00Z"));
  assert.equal(good.ok, true, "the 07:00 window is the one this settle belongs to");

  // Every later quarter-hour is refused.
  const corrupted = [
    "2026-09-10T07:15:00Z", "2026-09-10T07:30:00Z", "2026-09-10T07:45:00Z", "2026-09-10T08:00:00Z",
    "2026-09-10T08:15:00Z", "2026-09-10T08:30:00Z", "2026-09-10T08:45:00Z", "2026-09-10T09:00:00Z",
  ];
  assert.equal(corrupted.length, 8, "the known bad block is eight rows");
  for (const iso of corrupted) {
    const v = matchSettle(settles, stale, ms(iso));
    assert.equal(v.ok, false, `${iso} must not grade from the 07:00 market`);
    assert.equal(v.ok === false && v.fault, "ticker-close-time-mismatch");
    assert.equal(v.checks.ticker_time_ok, false);
  }
});

test("REGRESSION: a settle is no longer matched on ticker alone", () => {
  // Branch 1 of the old matcher ignored close_time entirely. Here the ticker is
  // unparseable, so the ticker-time witness abstains and only the settle's own
  // close_time can catch it — which the old code never consulted on this path.
  const tk = "OPAQUE-SERIES-A";
  const settles = [settle(tk, "2026-09-10T07:00:00Z")];
  const v = matchSettle(settles, tk, ms("2026-09-10T08:45:00Z"));
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.fault, "close-time-mismatch");
  assert.equal(v.checks.ticker_time_ok, null, "an opaque ticker abstains rather than vetoing");
  assert.equal(v.checks.ticker_seen, true);
  assert.equal(v.checks.close_ok, false);
});

test("REGRESSION: a settle is no longer matched on close time alone", () => {
  // Branch 2 of the old matcher ignored the ticker: any settle closing within
  // 90s would do. A different market's result must never grade this window.
  const settles = [settle("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z", "DOWN")];
  const v = matchSettle(settles, "KXETH15M-26SEP110800-00", ms("2026-09-11T12:00:00Z"));
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.fault, "no-settle-for-window");
});

// ---------------------------------------------------------------------------
// The ordinary paths still work.
// ---------------------------------------------------------------------------

test("the matching settle grades the window", () => {
  const tk = "KXBTC15M-26SEP110800-00";
  const v = matchSettle([settle(tk, "2026-09-11T12:00:00Z", "DOWN")], tk, ms("2026-09-11T12:00:00Z"));
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.settle.lean, "DOWN");
  assert.deepEqual(v.checks, { on_grid: true, ticker_time_ok: true, ticker_seen: true, close_ok: true });
});

test("clock skew inside the tolerance still grades", () => {
  // The tolerance is unchanged from the matcher this replaces: it was never the
  // bug. Kalshi's reported close can drift a few seconds from ours.
  const tk = "KXBTC15M-26SEP110800-00";
  const skewed = { ticker: tk, close_time: ms("2026-09-11T12:00:00Z") + 45_000, lean: "UP" as const };
  assert.equal(matchSettle([skewed], tk, ms("2026-09-11T12:00:00Z")).ok, true);
  const tooFar = { ...skewed, close_time: ms("2026-09-11T12:00:00Z") + CLOSE_TOLERANCE_MS + 1 };
  assert.equal(matchSettle([tooFar], tk, ms("2026-09-11T12:00:00Z")).ok, false);
});

test("the right settle is chosen out of a crowded bundle", () => {
  const want = "KXBTC15M-26SEP110800-00";
  const settles = [
    settle("KXBTC15M-26SEP110715-15", "2026-09-11T11:15:00Z", "DOWN"),
    settle("KXBTC15M-26SEP110730-30", "2026-09-11T11:30:00Z", "UP"),
    settle(want, "2026-09-11T12:00:00Z", "DOWN"),
    settle("KXBTC15M-26SEP110745-45", "2026-09-11T11:45:00Z", "UP"),
  ];
  const v = matchSettle(settles, want, ms("2026-09-11T12:00:00Z"));
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.settle.ticker, want);
  assert.equal(v.ok === true && v.settle.lean, "DOWN");
});

test("a window still awaiting its result is pending, not a fault in the data", () => {
  const tk = "KXBTC15M-26SEP110800-00";
  const v = matchSettle([], tk, ms("2026-09-11T12:00:00Z"));
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.fault, "no-settle-for-window");
  assert.equal(v.checks.ticker_time_ok, true, "the window itself is sound; the result has not arrived");
});

test("a settle with no usable lean is ignored", () => {
  const tk = "KXBTC15M-26SEP110800-00";
  const junk = [{ ticker: tk, close_time: ms("2026-09-11T12:00:00Z"), lean: "WAIT" as unknown as "UP" }];
  assert.equal(matchSettle(junk, tk, ms("2026-09-11T12:00:00Z")).ok, false);
});

test("an off-grid or keyless window is refused before any settle is read", () => {
  const tk = "KXBTC15M-26SEP110800-00";
  const off = matchSettle([settle(tk, "2026-09-11T12:07:00Z")], tk, ms("2026-09-11T12:07:00Z"));
  assert.equal(off.ok === false && off.fault, "window-off-grid");
  const none = matchSettle([], "", ms("2026-09-11T12:00:00Z"));
  assert.equal(none.ok === false && none.fault, "unusable-window-key");
  const zero = matchSettle([], tk, 0);
  assert.equal(zero.ok === false && zero.fault, "unusable-window-key");
});

test("the fault line names the window, the fault and why", () => {
  const line = faultLine("KXBTC15M-26SEP100300-00", ms("2026-09-10T08:45:00Z"), "ticker-close-time-mismatch", "x");
  assert.match(line, /^IDENTITY 08:45 KXBTC15M-26SEP100300-00/);
  assert.match(line, /not graded, not taught/);
});
