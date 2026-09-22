import assert from "node:assert/strict";
import test from "node:test";
import { GATE_VARIANTS, capCounterfactual, gateVariants, oracleCeiling, type Opportunity } from "./counterfactuals.ts";

const opp = (ask: number, win: boolean, edge: number | null = 5, booked = true): Opportunity => ({ ticker: `T${ask}${win}`, close_ms: 0, side: "UP", ask, edge_cents: edge, booked, official_winner: win ? "UP" : "DOWN" });

test("a 92¢ cap blocks only asks above 92 and reports both books, the blocked net and both drawdowns", () => {
  const opps = [opp(85, true), opp(95, true), opp(97, false), opp(92, true), opp(93, true)];
  const c = capCounterfactual(opps, 92);
  assert.deepEqual({ considered: c.considered, blocked: c.blocked, kept: c.kept }, { considered: 5, blocked: 3, kept: 2 });
  assert.equal(c.blocked_wins, 2);
  assert.equal(c.blocked_net, 4 + -98 + 6);
  assert.equal(c.net_change, -c.blocked_net);
  assert.ok(c.dd_with_cap >= c.dd_without_cap);
});

test("gate variants: the flat 3¢ production rule is the first variant and price-aware thresholds are computed beside it, never instead", () => {
  assert.equal(GATE_VARIANTS[0]!.id, "FLAT_3C");
  assert.equal(GATE_VARIANTS[0]!.threshold(95), 3);
  const opps = [opp(85, true, 3.5), opp(95, true, 3.5), opp(80, false, 2)];
  const v = gateVariants(opps);
  assert.equal(v.find((x) => x.id === "FLAT_3C")!.admitted, 2);
  assert.equal(v.find((x) => x.id === "QUARTER_OF_WIN")!.admitted, 2, "25% of 14 = 3.5 at 85¢; 25% of 4 = 1 at 95¢");
  assert.equal(v.find((x) => x.id === "FEE_PLUS_2")!.admitted, 2);
});

test("the oracle ceiling is an evaluation statistic: it needs official results and reports actual as a share of the ceiling", () => {
  const o = oracleCeiling([opp(85, true), opp(85, false)]);
  assert.deepEqual(o, { n: 2, ceiling_net: 28, actual_net: 14 - 86, pct_of_ceiling: Math.round((1000 * (14 - 86)) / 28) / 10 });
  assert.equal(oracleCeiling([{ ...opp(85, true), official_winner: null }]).n, 0);
});
