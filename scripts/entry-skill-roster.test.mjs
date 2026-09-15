import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureEntrySkillRoster, withEntrySkillRosterColumn } from "../src/lib/desk/entry-skill-roster.ts";
import { sanitizeBookedDecisionState } from "../src/lib/desk/booked-decision.ts";
import { withSkillAuditColumn } from "../src/lib/desk/skill-score-audit.ts";

const snap = { ticker: "KXBTC15M-TEST", close_time: 1_800_000_000_000, as_of: 1_799_999_700_000,
  quote_ts: 1_799_999_699_000, quote_age_s: 1, quote_seq: 41, regime_key: "US_AM_MID" };
const chair = { lean: "DOWN", rows: [
  { seat: "DRIFT", skill_used: "DRIFT.read", lean: "DOWN", status: "LIVE", contribution: 0.7 },
  { seat: "WHALE", skill_used: "WHALE.proxy", lean: "WAIT", status: "SHADOW", contribution: 0 },
] };
const votes = [
  { seat: "DRIFT", skill_used: "DRIFT.read", skill_status: "LIVE", lean: "DOWN", confidence: 73, paper: [] },
  { seat: "WHALE", skill_used: "WHALE.proxy", skill_status: "SHADOW", lean: "WAIT", confidence: 0,
    raw_lean: "DOWN", raw_conf: 61, forced_sit: true,
    paper: [{ id: "WHALE.cluster", lean: "DOWN", confidence: 59, status: "BENCH" }] },
];

test("DOWN entry preserves same-tick LIVE contributors and nonvoting paper evidence", () => {
  const receipt = captureEntrySkillRoster(snap, chair, votes, 86, 2.2, "abcdef012345");
  assert.equal(receipt.scope, "booked_paper_entry");
  assert.equal(receipt.side, "DOWN");
  assert.equal(receipt.ask_cents, 86);
  assert.equal(receipt.entry_at_ms, snap.as_of);
  assert.equal(receipt.seat_reads[1].raw_lean, "DOWN");
  assert.equal(receipt.seat_reads[1].selected_status, "SHADOW");
  assert.equal(receipt.seat_reads[1].paper[0].status, "BENCH");
  assert.equal(receipt.chair_rows[1].contribution, 0);
  assert.equal(receipt.confidence_kind, "signal_strength_not_calibrated_probability");
  assert.equal(captureEntrySkillRoster(snap, { ...chair, lean: "WAIT" }, votes, 86, 2.2, "abcdef012345"), null);
});

test("receipt survives restart; older booked and queued rows remain null", () => {
  const receipt = captureEntrySkillRoster(snap, chair, votes, 86, 2.2, "abcdef012345");
  const restored = sanitizeBookedDecisionState({ here: { lean: "DOWN", regime: "US_AM_MID",
    conf: 73, build_sha: "abcdef012345", entry_roster: receipt }, old: { lean: "UP" } });
  assert.deepEqual(restored.here.entry_roster, receipt);
  assert.equal(restored.old.entry_roster, null);
  assert.equal(sanitizeBookedDecisionState({ bad: { entry_roster: { version: "wrong" } } }).bad.entry_roster, null);
  assert.equal(withEntrySkillRosterColumn(withSkillAuditColumn(Array(41).fill(null))).length, 43);
  assert.equal(withEntrySkillRosterColumn(Array(42).fill(null))[42], null);
  assert.equal(withEntrySkillRosterColumn(Array(43).fill(null)).length, 43);
});

test("production captures current votes only after the book guard and stores grade receipt", () => {
  const source = readFileSync(new URL("../src/lib/desk/server-engine.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!bookable\(cents\)\) return;[\s\S]*?noteEntryState\(e, snap, chair, votes, cents\)/);
  assert.match(source, /await noteCall\(e, snap, chair, votes\);/);
  assert.match(source, /entry_skill_roster\).*?\$43::jsonb/s);
  assert.match(source, /booked && entry\?\.entry_roster/);
});
