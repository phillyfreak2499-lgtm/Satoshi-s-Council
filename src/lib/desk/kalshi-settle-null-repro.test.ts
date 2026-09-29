import assert from "node:assert/strict";
import test from "node:test";
import { parseKalshiResult } from "./kalshi-settle.ts";
test("an undetermined market whose legacy settlement_value is null or empty must not grade DOWN", () => {
  assert.equal(parseKalshiResult({ ticker: "KXBTC15M-26SEP290045-45", result: "", settlement_value: null as unknown as string }), null);
  assert.equal(parseKalshiResult({ ticker: "KXBTC15M-26SEP290045-45", result: "", settlement_value: "" }), null);
  assert.equal(parseKalshiResult({ ticker: "KXBTC15M-26SEP290045-45", result: "", settlement_value: " " }), null);
});
