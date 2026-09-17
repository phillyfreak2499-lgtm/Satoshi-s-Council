import assert from "node:assert/strict";
import test from "node:test";
import { selectOpenKalshiMarket } from "./kalshi-market";

const now = Date.parse("2026-09-17T12:00:05Z");

test("skips a stale open market and selects the nearest valid future window", () => {
  const stale = { ticker: "KXBTC15M-26SEP170800-00", close_time: "2026-09-17T12:00:00Z" };
  const next = { ticker: "KXBTC15M-26SEP170815-15", close_time: "2026-09-17T12:15:00Z" };
  const later = { ticker: "KXBTC15M-26SEP170830-30", close_time: "2026-09-17T12:30:00Z" };
  assert.equal(selectOpenKalshiMarket([stale, later, next], now), next);
});

test("fails closed when ticker and provider close time disagree", () => {
  const mismatched = { ticker: "KXBTC15M-26SEP170800-00", close_time: "2026-09-17T12:15:00Z" };
  assert.equal(selectOpenKalshiMarket([mismatched], now), null);
});

test("fails closed when no future market is available", () => {
  const stale = { ticker: "KXBTC15M-26SEP170800-00", close_time: "2026-09-17T12:00:00Z" };
  assert.equal(selectOpenKalshiMarket([stale], now), null);
});
