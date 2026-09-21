import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_ASK_LEAD_STATE,
  applyAskLeadTick,
  lastLeadMatchesWinner,
  leadFromAsks,
  swapBucket,
  type AskLeadState,
} from "./ask-lead.ts";

function step(state: AskLeadState, yes: number, no: number, secs: number) {
  return applyAskLeadTick(state, { yes_ask: yes, no_ask: no, secs_left: secs, as_of_ms: 1 }).state;
}

test("higher ask is the lead; equal asks are a tie", () => {
  assert.equal(leadFromAsks(61, 40), "YES");
  assert.equal(leadFromAsks(40, 61), "NO");
  assert.equal(leadFromAsks(50, 50), "TIE");
  assert.equal(leadFromAsks(null, 50), "INVALID");
});

test("first confirmed lead is not a swap", () => {
  let s = { ...EMPTY_ASK_LEAD_STATE, buckets: { ...EMPTY_ASK_LEAD_STATE.buckets } };
  s = step(s, 60, 41, 800);
  assert.equal(s.last_clear, null);
  s = step(s, 61, 40, 798);
  assert.equal(s.last_clear, "YES");
  assert.equal(s.swap_count, 0);
  assert.equal(s.first_lead, "YES");
});

test("one-tick flicker does not count until it holds", () => {
  let s = { ...EMPTY_ASK_LEAD_STATE, buckets: { ...EMPTY_ASK_LEAD_STATE.buckets } };
  s = step(s, 60, 40, 500);
  s = step(s, 60, 40, 498);
  s = step(s, 40, 60, 490);
  assert.equal(s.swap_count, 0);
  assert.equal(s.last_clear, "YES");
  s = step(s, 39, 61, 488);
  assert.equal(s.swap_count, 1);
  assert.equal(s.last_clear, "NO");
  assert.equal(s.buckets["10_5"], 1);
  assert.equal(s.first_swap_secs, 488);
});

test("a tie does not flip the lead or count a swap", () => {
  let s = { ...EMPTY_ASK_LEAD_STATE, buckets: { ...EMPTY_ASK_LEAD_STATE.buckets } };
  s = step(s, 55, 45, 200);
  s = step(s, 55, 45, 198);
  s = step(s, 50, 50, 190);
  s = step(s, 55, 45, 188);
  assert.equal(s.swap_count, 0);
  assert.equal(s.last_clear, "YES");
});

test("clock buckets and last-lead vs settle", () => {
  assert.equal(swapBucket(700), "15_10");
  assert.equal(swapBucket(400), "10_5");
  assert.equal(swapBucket(180), "5_2");
  assert.equal(swapBucket(90), "last_2");
  assert.equal(lastLeadMatchesWinner("YES", "UP"), true);
  assert.equal(lastLeadMatchesWinner("NO", "UP"), false);
  assert.equal(lastLeadMatchesWinner(null, "DOWN"), null);
});
