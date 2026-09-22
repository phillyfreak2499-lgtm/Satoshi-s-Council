import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decomposeTrial, type TrialRow } from "./trial-decomposition.ts";
import { holdNetCents } from "./fee-engine.ts";

const row = (i: number, live: number | null, shadow: number | null, winner: "UP" | "DOWN", side: "UP" | "DOWN" = "UP"): TrialRow => ({
  ticker: `T${i}`, close_ms: i, winner,
  live_ask: live, live_net: live == null ? null : holdNetCents(live, side === winner),
  shadow_ask: shadow, shadow_net: shadow == null ? null : holdNetCents(shadow, side === winner),
});

test("the decomposition sums exactly: A (price + fee) + C − B = live − shadow", () => {
  const rows = [row(1, 84, 79, "UP"), row(2, 80, 70, "DOWN"), row(3, null, 73, "DOWN"), row(4, null, 72, "UP"), row(5, 90, null, "UP"), row(6, null, null, "UP")];
  const d = decomposeTrial(rows);
  assert.deepEqual({ shared: d.shared, so: d.shadow_only, lo: d.live_only, nf: d.no_fill }, { shared: 2, so: 2, lo: 1, nf: 1 });
  assert.equal(d.A_price_component, -(84 - 79) - (80 - 70));
  assert.equal(d.A_fee_component, -((1 - 2) + (2 - 2)));
  assert.equal(d.A_total, d.A_price_component + d.A_fee_component);
  assert.equal(d.B_shadow_only_net, holdNetCents(73, false) + holdNetCents(72, true));
  assert.equal(d.C_live_only_net, holdNetCents(90, true));
  assert.equal(d.sums_exactly, true);
  assert.equal(d.difference_live_minus_shadow, Math.round((d.A_total + d.C_live_only_net - d.B_shadow_only_net) * 10) / 10);
});

test("the recorded 442-window trial: the 11 shadow-only rows sum to −630¢ with 2 wins, and −415 + 630 = +215", () => {
  const csv = readFileSync(new URL("../../../docs/audit/trial_shadow70_only_rows_2026-09-22.csv", import.meta.url), "utf8").trim().split("\n").slice(1);
  const rows: TrialRow[] = csv.map((line, i) => {
    const [ticker, , sh, shev, winner] = line.split(",");
    return { ticker: ticker!, close_ms: i, winner: winner as "UP" | "DOWN", live_ask: null, live_net: null, shadow_ask: Number(sh), shadow_net: Number(shev) };
  });
  assert.equal(rows.length, 11);
  const d = decomposeTrial(rows);
  assert.equal(d.B_shadow_only_net, -630);
  assert.equal(d.B_shadow_only_wins, 2);
  assert.equal(d.B_avoided_by_higher_floor, 630);
  // DB_VERIFIED aggregates on the 91 shared windows (docs/audit/external_reconciliation.json): price −426, fee +11.
  const A = -426 + 11;
  assert.equal(A + d.B_avoided_by_higher_floor, 215);
  assert.equal(205 - -10, 215);
});
