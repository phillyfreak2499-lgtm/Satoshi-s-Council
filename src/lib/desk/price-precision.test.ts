import assert from "node:assert/strict";
import test from "node:test";
import { FEE_PROVENANCE, feeForContracts, feeCents } from "./fee-engine.ts";
import { PRICE_PRECISION_CONTRACT, deciCentEconomics, describeStoredPrecision, onTickGrid, storedAskUncertaintyCents } from "./price-precision.ts";
import { interpretKalshiBook } from "./kalshi-book.ts";

test("one contract is NOT 1¢ at every price: the charged fee is 2¢ from 18¢ to 82¢ and 1¢ elsewhere; 100 contracts pay ~7·p(1−p)¢ each", () => {
  const prices = [50, 70, 75, 80, 81, 82, 83, 85, 90, 92, 95, 99];
  const expectC1: Record<number, number> = { 50: 2, 70: 2, 75: 2, 80: 2, 81: 2, 82: 2, 83: 1, 85: 1, 90: 1, 92: 1, 95: 1, 99: 1 };
  for (const p of prices) {
    const c1 = feeForContracts(p, 1), c100 = feeForContracts(p, 100);
    assert.equal(c1.charged_cents, expectC1[p], `C=1 at ${p}`);
    assert.equal(c1.charged_cents, feeCents(p), `engine parity at ${p}`);
    assert.equal(c1.matches_c1_engine, true);
    assert.equal(c100.charged_cents, Math.ceil(7 * 100 * (p / 100) * (1 - p / 100) - 1e-9), `C=100 at ${p}`);
    assert.ok(c100.per_contract_cents <= c1.charged_cents + 1e-9, `order rounding never charges more per contract than C=1 at ${p}`);
  }
  assert.equal(feeForContracts(50, 1).raw_cents, 1.75);
  assert.equal(feeForContracts(83, 1).raw_cents, 0.9877);
  assert.equal(feeForContracts(82, 1).raw_cents, 1.0332);
  assert.equal(feeForContracts(83, 100).charged_cents, 99);
  assert.equal(feeForContracts(83, 100).per_contract_cents, 0.99);
  assert.equal(FEE_PROVENANCE.fetched_at, null, "provenance stays ASSUMED until a venue record is fetched");
});

test("deci-cent asks round-trip through the economics without a second rounding", () => {
  for (const [ask, fee] of [[90.1, 1], [90.4, 1], [90.9, 1], [95.5, 1], [99.1, 1]] as const) {
    const e = deciCentEconomics(ask, true);
    assert.equal(e.ask, ask);
    assert.equal(e.fee, fee);
    assert.equal(e.all_in, Math.round((ask + fee) * 1000) / 1000);
    assert.equal(e.net, Math.round((100 - ask - fee) * 1000) / 1000);
    assert.equal(e.on_grid, true, `${ask} is on the 0.1¢ grid above 90¢`);
  }
  assert.equal(deciCentEconomics(90.4, false).net, -91.4);
  assert.equal(onTickGrid(85.5), false, "no 0.1¢ ticks between 10¢ and 90¢");
  assert.equal(onTickGrid(9.6), true);
  assert.equal(onTickGrid(100), false);
});

test("stored precision is named honestly: whole-cent stores are UNKNOWN to ±0.5¢ where the market ticks in deci-cents", () => {
  assert.equal(describeStoredPrecision(92, "ledger"), "whole_cent_coerced_unknown_fraction");
  assert.equal(describeStoredPrecision(85, "ledger"), "whole_cent_exact");
  assert.equal(describeStoredPrecision(92.5, "raw_book"), "exact_deci_cent");
  assert.equal(storedAskUncertaintyCents(92), 0.5);
  assert.equal(storedAskUncertaintyCents(85), 0);
  assert.ok(PRICE_PRECISION_CONTRACT.coercion_sites.some((s) => s.includes("server-feeds.ts")));
});


test("exact quote lane preserves deci-cent top/depth without changing legacy whole-cent production quote", () => {
  const q = interpretKalshiBook(
    {
      orderbook_fp: {
        yes_dollars: [["0.901", 4], ["0.904", 7]],
        no_dollars: [["0.096", 3], ["0.099", 5]],
      },
    },
    { yes_bid: 90, yes_ask: 90, no_bid: 10, no_ask: 10, yes_bid_exact: 90.4, yes_ask_exact: 90.1, no_bid_exact: 9.9, no_ask_exact: 9.6 },
  );

  // Legacy chooser compares rounded cents, so production behavior is preserved.
  assert.equal(q.yes_bid, 90);
  assert.equal(q.no_bid, 10);
  assert.equal(q.yes_ask, 90);
  assert.equal(q.no_ask, 10);
  assert.equal(q.yes_bid_size, 4);
  assert.equal(q.no_bid_size, 3);

  // Measurement chooser sees the actual top level and its depth.
  assert.equal(q.yes_bid_exact, 90.4);
  assert.equal(q.no_bid_exact, 9.9);
  assert.equal(q.yes_ask_exact, 90.1);
  assert.equal(q.no_ask_exact, 9.6);
  assert.equal(q.yes_bid_size_exact, 7);
  assert.equal(q.no_bid_size_exact, 5);
});


test("exact lane retains extreme venue levels while legacy rounding keeps its historical collapse/reject semantics", () => {
  const q = interpretKalshiBook(
    {
      orderbook_fp: {
        yes_dollars: [["0.004", 2], ["0.999", 8]],
        no_dollars: [["0.006", 3], ["0.995", 9]],
      },
    },
    { yes_bid: 0, yes_ask: 0, no_bid: 0, no_ask: 0 },
  );

  // Old production parser: 0.4¢ rounds to 0 and is rejected; 0.6¢ rounds to
  // 1¢ and survives; 99.5/99.9¢ round to 100 and are rejected. Keep exactly that.
  assert.equal(q.yes_bid, 0);
  assert.equal(q.no_bid, 1);
  assert.equal(q.yes_ask, 99);
  assert.equal(q.no_ask, 0);
  assert.equal(q.yes_bid_size, 0);
  assert.equal(q.no_bid_size, 3);

  // Measurement lane keeps the true venue top and corresponding ask.
  assert.equal(q.yes_bid_exact, 99.9);
  assert.equal(q.no_bid_exact, 99.5);
  assert.equal(q.yes_bid_size_exact, 8);
  assert.equal(q.no_bid_size_exact, 9);
  assert.equal(q.yes_ask_exact, 0.5);
  assert.equal(q.no_ask_exact, 0.1);
});


test("unavailable exact sentinels fall back to the executable legacy quote instead of becoming 0¢ prices", () => {
  const q = interpretKalshiBook(null, {
    yes_bid: 84,
    yes_ask: 85,
    no_bid: 15,
    no_ask: 16,
    yes_bid_exact: 0,
    yes_ask_exact: 0,
    no_bid_exact: 0,
    no_ask_exact: 0,
  });
  assert.equal(q.yes_bid_exact, 84);
  assert.equal(q.yes_ask_exact, 85);
  assert.equal(q.no_bid_exact, 15);
  assert.equal(q.no_ask_exact, 16);
});
