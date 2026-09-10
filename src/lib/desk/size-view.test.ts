import { test } from "node:test";
import assert from "node:assert/strict";
import { GAVEL_SIZES, evCentsAt, fmtCentsAt, isGavelSize, takerFeeCentsAt } from "./size-view.ts";

test("the fee at size is rounded once per order, not per contract", () => {
  // One contract at 70¢: 1.47¢ rounds up to 2¢ — the desk's own bookkeeping.
  assert.equal(takerFeeCentsAt(70, 1), 2);
  // A hundred at 70¢: 147¢ exactly, not 100 × 2¢.
  assert.equal(takerFeeCentsAt(70, 100), 147);
  assert.equal(takerFeeCentsAt(70, 10), 15);
  assert.equal(takerFeeCentsAt(90, 100), 63);
  assert.equal(takerFeeCentsAt(50, 1000), 1750);
  // Tenths of a cent are honoured, not dropped.
  assert.equal(takerFeeCentsAt(71.5, 100), 143);
});

test("at one contract the size view matches the ledger's own arithmetic", () => {
  for (const entry of [52, 60, 70, 71.5, 75, 82, 85, 90, 97]) {
    const p = entry / 100;
    const ledgerFee = Math.ceil(7 * p * (1 - p));
    assert.equal(takerFeeCentsAt(entry, 1), ledgerFee, `fee at ${entry}¢`);
    assert.equal(evCentsAt(entry, 100, 1), Math.round((100 - entry - ledgerFee) * 10) / 10, `win at ${entry}¢`);
    assert.equal(evCentsAt(entry, 0, 1), Math.round((-entry - ledgerFee) * 10) / 10, `loss at ${entry}¢`);
  }
});

test("a fill at size scales the result and charges the fee once", () => {
  // 70¢ winner: 100 × 30¢ − 147¢.
  assert.equal(evCentsAt(70, 100, 100), 2853);
  // 70¢ loser: −100 × 70¢ − 147¢.
  assert.equal(evCentsAt(70, 0, 100), -7147);
  // An old cut price still reads at size.
  assert.equal(evCentsAt(70, 61, 10), -105);
});

test("one contract reads in cents, size reads in dollars", () => {
  assert.equal(fmtCentsAt(28, 1), "+28.0¢");
  assert.equal(fmtCentsAt(-72, 1), "-72.0¢");
  assert.equal(fmtCentsAt(2853, 100), "+$28.53");
  assert.equal(fmtCentsAt(-7147, 100), "-$71.47");
  assert.equal(fmtCentsAt(0, 50), "$0.00");
  assert.equal(fmtCentsAt(285300, 1000), "+$2,853.00");
});

test("the size list runs from one contract to a thousand", () => {
  assert.equal(GAVEL_SIZES[0], 1);
  assert.equal(GAVEL_SIZES[GAVEL_SIZES.length - 1], 1000);
  assert.ok(isGavelSize(100));
  assert.ok(!isGavelSize(7));
});
