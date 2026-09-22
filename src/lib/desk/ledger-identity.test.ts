import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyRow, eraOf, type LedgerRow } from "./economics-book.ts";
import { holdNetCents } from "./fee-engine.ts";

/** The 190 booked rows as exported on 2026-09-22 (docs/audit/ledger_190_rows_2026-09-22.csv). */
function rows(): Array<Record<string, string>> {
  const text = readFileSync(new URL("../../../docs/audit/ledger_190_rows_2026-09-22.csv", import.meta.url), "utf8").trim().split("\n");
  const head = text[0]!.split(",");
  return text.slice(1).map((line) => Object.fromEntries(line.split(",").map((v, i) => [head[i]!, v])));
}
const toRow = (r: Record<string, string>): LedgerRow => ({
  id: Number(r.ledger_id), ticker: r.ticker!, close_ms: Date.parse(r.close_utc!), graded_ms: null, winner: r.official_winner as "UP" | "DOWN", official_value: null,
  research_quality: r.research_quality!, chair_lean: "WAIT", entry_cents: Number(r.entry_ask_cents), settle_cents: r.settlement_value_cents ? Number(r.settlement_value_cents) : Number(r.exit_price_cents),
  ev_cents: Number(r.stored_pnl_cents), entry_lean: null, entry_secs_left: null, shadow_entry_cents: null, shadow_ev_cents: null,
});

test("HOLD identity holds on every one of the 137 policy-era one-contract rows and on 166 of 190 overall", () => {
  const all = rows();
  assert.equal(all.length, 190);
  const classified = all.map((r) => ({ r, c: classifyRow(toRow(r)) }));
  const policyEra = classified.filter((x) => eraOf(Date.parse(x.r.close_utc!)) !== "A0_pre_floor");
  assert.equal(policyEra.length, 137);
  assert.ok(policyEra.every((x) => x.c.event === "booked_settled" && x.c.hold_identity === true));
  assert.equal(policyEra.filter((x) => x.c.official_win).length, 117);
  const cost = policyEra.reduce((s, x) => s + (x.c.all_in_cost ?? 0), 0);
  const net = policyEra.reduce((s, x) => s + Number(x.r.stored_pnl_cents), 0);
  assert.equal(cost, 11_474);
  assert.equal(net, 226);
  assert.equal(100 * 117 - cost, net, "net = 100·wins − Σ(ask + fee), to the cent");
  assert.equal(classified.filter((x) => x.c.hold_identity === true).length, 166);
});

test("the 24 legacy rows carry exit prices and are never priced with HOLD arithmetic", () => {
  const legacy = rows().map((r) => ({ r, c: classifyRow(toRow(r)) })).filter((x) => x.c.hold_identity === false);
  assert.equal(legacy.length, 24);
  assert.ok(legacy.every((x) => eraOf(Date.parse(x.r.close_utc!)) === "A0_pre_floor"));
  assert.ok(legacy.every((x) => x.c.event === "booked_legacy_exit" || x.c.event === "scratch"));
  assert.ok(legacy.every((x) => x.c.official_win === null), "a legacy row has no official win in the HOLD sense");
  for (const x of legacy) {
    const hold = holdNetCents(Number(x.r.entry_ask_cents), x.r.official_winner === x.r.booked_side);
    assert.notEqual(Number(x.r.stored_pnl_cents), hold, `${x.r.ledger_id}: stored pnl is an exit result, not a HOLD result`);
  }
  assert.equal(legacy.filter((x) => x.c.event === "scratch").length, 3);
  assert.equal(legacy.reduce((s, x) => s + Number(x.r.stored_pnl_cents), 0), -118);
});

test("the external implied-average-ask formula fails on this ledger because its 'wins' were positive-net rows and its fee was flat", () => {
  const all = rows();
  const n = all.length;
  const evPos = all.filter((r) => Number(r.stored_pnl_cents) > 0).length;
  const official = all.filter((r) => r.official_win === "1").length;
  const avgAsk = all.reduce((s, r) => s + Number(r.entry_ask_cents), 0) / n;
  const net = all.reduce((s, r) => s + Number(r.stored_pnl_cents), 0);
  assert.equal(evPos, 149);
  assert.equal(official, 140);
  assert.equal(Math.round(avgAsk * 100) / 100, 79.72);
  assert.equal(net, 92);
  const impliedFromEvPos = (100 * evPos) / n - 1 - net / n; // the external arithmetic: WR − fee(1) − net/fill
  assert.ok(Math.abs(impliedFromEvPos - 76.94) < 0.01);
  assert.ok(Math.abs(impliedFromEvPos - avgAsk) > 2.5, "the implied ask is 2.8¢ below the true average: the formula's inputs are the wrong population");
});

test("ledger isolation: shadow-70 fills live in their own columns and never enter the main-paper event kinds", () => {
  const r = toRow(rows()[100]!);
  const withShadow: LedgerRow = { ...r, entry_cents: null, settle_cents: null, ev_cents: null, shadow_entry_cents: 73, shadow_ev_cents: -75 };
  assert.equal(classifyRow(withShadow).event, "no_decision", "a shadow-only window is not a main-paper fill");
});
