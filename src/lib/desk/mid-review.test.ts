import assert from "node:assert/strict";
import test from "node:test";
import { MID_REVIEW_MIN_N, pocketOf, reviewCard, reviewCards, type FireReceipt } from "./mid-review.ts";

let n = 0;
const rx = (secs: number, ask: number | null, win: boolean, extra: Partial<FireReceipt> = {}): FireReceipt => ({
  card_id: "STRIKE.itm_time", seat: "STRIKE", ticker: `T${++n}`, close_ms: 1_790_000_000_000 + n * 900_000, fire_ms: 0, secs_left: secs,
  side: "UP", ask_cents: ask, health: "LIVE", execution_qualified: true, official_winner: win ? "UP" : "DOWN", kind: "raw_observation",
  strength: 64, probability: null, ...extra,
});

test("pockets: ENTRY > 600, MID 180–600, FINAL < 180; nonsense is null", () => {
  assert.equal(pocketOf(601), "ENTRY");
  assert.equal(pocketOf(600), "MID");
  assert.equal(pocketOf(180), "MID");
  assert.equal(pocketOf(179), "FINAL");
  assert.equal(pocketOf(-1), null);
  assert.equal(pocketOf(NaN), null);
});

test("FINAL grades never satisfy the MID minimum: 1,195 right answers at 97¢ leave a card INSUFFICIENT_MID", () => {
  const receipts = Array.from({ length: 1195 }, () => rx(20, 97, true));
  const r = reviewCard("STRIKE.itm_time", receipts);
  assert.equal(r.final.valid_n, 1195);
  assert.equal(r.final.net_cents, 1195 * 2);
  assert.equal(r.mid.valid_n, 0);
  assert.equal(r.flag, "INSUFFICIENT_MID");
  assert.equal(r.authority, "none");
});

test("a negative MID book with ≥ 50 valid observations raises REVIEW_NEGATIVE_MID and prices at each fire-time ask", () => {
  const receipts = [
    ...Array.from({ length: 41 }, () => rx(400, 85, true)), // +14 each
    ...Array.from({ length: 9 }, () => rx(400, 85, false)), // −86 each
  ];
  const r = reviewCard("STRIKE.itm_time", receipts);
  assert.equal(r.mid.valid_n, 50);
  assert.equal(r.mid.wins, 41);
  assert.equal(r.mid.wr_pct, 82);
  assert.equal(r.mid.needed_wr_pct, 86);
  assert.equal(r.mid.net_cents, 41 * 14 - 9 * 86);
  assert.equal(r.flag, "REVIEW_NEGATIVE_MID");
  assert.match(r.flag_reason, /WR 82% vs needed 86%/);
});

test("invalid observations are counted with a reason, never priced: no ask, no result, stale feed", () => {
  const receipts = [
    rx(400, null, true), rx(400, 85, true, { official_winner: null }), rx(400, 85, true, { health: "STALE" }), rx(400, 85, true),
  ];
  const r = reviewCard("STRIKE.itm_time", receipts);
  assert.equal(r.mid.n, 4);
  assert.equal(r.mid.valid_n, 1);
  assert.deepEqual(r.mid.invalid_reasons, { no_executable_ask: 1, no_official_result: 1, feed_not_live: 1 });
  assert.equal(r.flag, "INSUFFICIENT_MID");
});

test("kinds stay separate; qualified shadow fills are subtotalled; strength never becomes a Brier", () => {
  const receipts = [
    rx(400, 85, true, { kind: "qualified_shadow_fill" }),
    rx(400, 85, true, { kind: "diagnostic_counterfactual", execution_qualified: false }),
    rx(400, 85, false, { kind: "main_paper_fill" }),
    rx(400, 85, true, { kind: "raw_observation", strength: 99 }),
  ];
  const r = reviewCard("STRIKE.itm_time", receipts);
  assert.deepEqual(r.mid.by_kind, { raw_observation: 1, diagnostic_counterfactual: 1, qualified_shadow_fill: 1, main_paper_fill: 1 });
  assert.equal(r.mid.qualified_n, 3);
  assert.equal(r.mid_brier, null);
  assert.equal(r.mid_brier_n, 0);
});

test("Brier scores only pre-close probabilities on MID rows", () => {
  const receipts = [
    rx(400, 85, true, { probability: 0.9 }),
    rx(400, 85, false, { probability: 0.9 }),
    rx(400, 85, true, { probability: 0.9, probability_after_close: true }),
    rx(30, 97, true, { probability: 0.99 }),
  ];
  const r = reviewCard("STRIKE.itm_time", receipts);
  assert.equal(r.mid_brier_n, 2);
  assert.equal(r.mid_brier, Math.round(((0.01 + 0.81) / 2) * 10_000) / 10_000);
});

test("reviewCards fans out per card id and the minimum is 50", () => {
  assert.equal(MID_REVIEW_MIN_N, 50);
  const receipts = [rx(400, 85, true), rx(400, 85, true, { card_id: "STREAK.continue_young", seat: "STREAK" })];
  const out = reviewCards(receipts);
  assert.deepEqual(out.map((r) => r.card_id), ["STREAK.continue_young", "STRIKE.itm_time"]);
});
