import { test } from "node:test";
import assert from "node:assert/strict";
import { missingCanonicalSide, sourceLagMs, takerBookSide, takerOutcomeSide, tradeSourceMs, wireMs } from "./kalshi-wire.ts";

test("canonical taker_outcome_side is read for both YES and NO takers", () => {
  // Shape of a real trade frame off the production websocket.
  assert.equal(
    takerOutcomeSide({ taker_outcome_side: "no", taker_side: "no", taker_book_side: "ask" }),
    "no",
  );
  assert.equal(
    takerOutcomeSide({ taker_outcome_side: "yes", taker_side: "yes", taker_book_side: "bid" }),
    "yes",
  );
});

test("the legacy taker_side still parses when canonical is absent", () => {
  assert.equal(takerOutcomeSide({ taker_side: "yes" }), "yes");
  assert.equal(takerOutcomeSide({ taker_side: "no" }), "no");
});

test("canonical wins when the two fields disagree, and YES/NO is never reversed", () => {
  assert.equal(takerOutcomeSide({ taker_outcome_side: "yes", taker_side: "no" }), "yes");
  assert.equal(takerOutcomeSide({ taker_outcome_side: "no", taker_side: "yes" }), "no");
});

test("an unreadable direction is null, never a guess", () => {
  assert.equal(takerOutcomeSide({}), null);
  assert.equal(takerOutcomeSide({ taker_outcome_side: "" }), null);
  assert.equal(takerOutcomeSide({ taker_outcome_side: "maybe" }), null);
  // A book side is not a direction: an aggressor hitting the ask is not "no".
  assert.equal(takerOutcomeSide({ taker_book_side: "ask" }), null);
  assert.equal(takerOutcomeSide({ yes_price_dollars: "0.67" }), null);
});

test("case and whitespace on the wire do not change the side", () => {
  assert.equal(takerOutcomeSide({ taker_outcome_side: "YES" }), "yes");
  assert.equal(takerOutcomeSide({ taker_outcome_side: " No " }), "no");
});

test("a payload without the canonical field is flagged for WARDEN", () => {
  assert.equal(missingCanonicalSide({ taker_outcome_side: "yes" }), false);
  assert.equal(missingCanonicalSide({ taker_side: "yes" }), true);
  assert.equal(missingCanonicalSide({}), true);
});

test("the resting book side is read separately and stays context", () => {
  assert.equal(takerBookSide({ taker_book_side: "ask" }), "ask");
  assert.equal(takerBookSide({ taker_book_side: "bid" }), "bid");
  assert.equal(takerBookSide({ taker_outcome_side: "yes" }), null);
});

test("event time comes from the exchange, in ms, whatever unit the wire used", () => {
  assert.equal(wireMs(1789064221508), 1789064221508);
  assert.equal(wireMs(1789064221), 1789064221000);
  assert.equal(wireMs("1789064221508"), 1789064221508);
  assert.equal(wireMs("2026-09-10T18:17:01.508Z"), Date.parse("2026-09-10T18:17:01.508Z"));
  assert.equal(wireMs(""), 0);
  assert.equal(wireMs(null), 0);
  assert.equal(wireMs("not a time"), 0);
});

test("ts_ms is preferred over second precision and over created_time", () => {
  assert.equal(tradeSourceMs({ ts_ms: 1789064221508, ts: 1789064221, created_time: "2026-09-10T00:00:00Z" }), 1789064221508);
  assert.equal(tradeSourceMs({ ts: 1789064221 }), 1789064221000);
  assert.equal(tradeSourceMs({ created_time: "2026-09-10T18:17:01.000Z" }), Date.parse("2026-09-10T18:17:01.000Z"));
  assert.equal(tradeSourceMs({}), 0);
});

test("receipt time is never substituted for event time", () => {
  // 40 ms of real feed lag stays visible as 40 ms.
  assert.equal(sourceLagMs(1789064221508, 1789064221548), 40);
  // No event time on the wire: claim nothing rather than claiming zero lag.
  assert.equal(sourceLagMs(0, 1789064221548), null);
  assert.equal(sourceLagMs(1789064221508, 0), null);
  // Clock skew cannot produce a negative age.
  assert.equal(sourceLagMs(1789064221548, 1789064221508), 0);
});
