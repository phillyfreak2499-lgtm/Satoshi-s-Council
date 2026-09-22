import assert from "node:assert/strict";
import test from "node:test";
import { DUPLICATE_REVIEW, pairInfluence, type CoSpeak } from "./duplicate-influence.ts";

const co = (window: string, seat: CoSpeak["seat"], side: "UP" | "DOWN", market: "UP" | "DOWN" | null = side): CoSpeak => ({ window, seat, side, market_side: market });

test("a same-family pair at 100% on n ≥ 50 is a REVIEW trigger that the fold already collapses", () => {
  const rows: CoSpeak[] = [];
  for (let i = 0; i < 54; i += 1) { rows.push(co(`w${i}`, "CARRY", "UP")); rows.push(co(`w${i}`, "CHAIN", "UP")); }
  const [p] = pairInfluence(rows);
  assert.equal(p!.n_both, 54);
  assert.equal(p!.agree_rate, 1);
  assert.equal(p!.same_family, true);
  assert.equal(p!.fold_already_applies, true);
  assert.equal(p!.flag, "REVIEW");
  assert.match(p!.flag_reason, /already collapses/);
  assert.equal(p!.both_with_market, 54);
  assert.equal(p!.agree_rate_given_either_against, null, "no residual: every agreement was the market's side");
});

test("a cross-family pair that agrees only when both follow the market shows no residual signal", () => {
  const rows: CoSpeak[] = [];
  for (let i = 0; i < 60; i += 1) { rows.push(co(`w${i}`, "STREAK", "UP")); rows.push(co(`w${i}`, "CHAIN", "UP")); }
  for (let i = 60; i < 70; i += 1) { rows.push(co(`w${i}`, "STREAK", "DOWN", "UP")); rows.push(co(`w${i}`, "CHAIN", "UP", "UP")); }
  const [p] = pairInfluence(rows);
  assert.equal(p!.same_family, false);
  assert.equal(p!.n_both, 70);
  assert.equal(p!.agree, 60);
  assert.equal(p!.either_against_market, 10);
  assert.equal(p!.agree_given_either_against, 0);
  assert.equal(p!.agree_rate_given_either_against, 0);
  assert.equal(p!.flag, "none", "86% < 90%");
});

test("below the minimum n the pair is reported but not flagged; cohorts are never pooled", () => {
  const rows: CoSpeak[] = [];
  for (let i = 0; i < 30; i += 1) { rows.push({ ...co(`w${i}`, "STRIKE", "UP"), cohort: "T-450" }); rows.push({ ...co(`w${i}`, "STREAK", "UP"), cohort: "T-450" }); }
  for (let i = 0; i < 30; i += 1) { rows.push({ ...co(`w${i}`, "STRIKE", "UP"), cohort: "T-180" }); rows.push({ ...co(`w${i}`, "STREAK", "UP"), cohort: "T-180" }); }
  const out = pairInfluence(rows);
  assert.equal(out.length, 2);
  for (const p of out) { assert.equal(p.n_both, 30); assert.equal(p.flag, "none"); assert.match(p.flag_reason, /n=30 < 50/); }
  assert.equal(DUPLICATE_REVIEW.min_n, 50);
});
