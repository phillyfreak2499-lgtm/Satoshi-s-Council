import assert from "node:assert/strict";
import test from "node:test";
import { SETTLE_BASIS, fairYesCents } from "./clock.ts";
import {
  E1_ROSTER_CARDS, JUMP_VETO, SETTLE_BASIS_CANDIDATES_BPS, blankJumpVeto, e1FamilyOf, edgeUnderBasis, fairYesCentsWithBasis, nullFavIntention,
  observeJump, scheduledCheckpoint, unmuteRoster, vetoActive,
} from "./shadow-arms.ts";
import type { Learner, SkillCard, Snapshot, Vote } from "./types";

const now = Date.parse("2026-09-21T15:05:00Z");
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: now + 450_000, ticker: "T", mins_left: 7.5, secs_left: 450, spot: 86_550, strike: 86_457.64, atr: 60,
  yes_ask: 86, yes_bid: 85, no_ask: 15, no_bid: 14, no_bid_size: 40, yes_bid_size: 30, spot_age_s: 1,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  ...extra,
} as Snapshot);

test("checkpoints are frozen windows: T−7:30 with a 12 s grace and a T−5 fallback", () => {
  assert.equal(scheduledCheckpoint(450), 450);
  assert.equal(scheduledCheckpoint(439), 450);
  assert.equal(scheduledCheckpoint(438), null);
  assert.equal(scheduledCheckpoint(300), 300);
  assert.equal(scheduledCheckpoint(451), null);
});

test("NULL_FAV buys the favourite only with a real ≥floor ask, tight spread, size and fresh feeds; it has no Council", () => {
  const i = nullFavIntention(snap(), 85)!;
  assert.deepEqual({ side: i.side, ask: i.ask_cents, fee: i.fee_cents, size: i.size_at_ask, spread: i.spread_cents }, { side: "UP", ask: 86, fee: 1, size: 40, spread: 1 });
  assert.equal(nullFavIntention(snap(), 88), null, "under the tested floor");
  assert.equal(nullFavIntention(snap({ yes_ask: 99, yes_bid: 98 }), 85), null, "chalk");
  assert.equal(nullFavIntention(snap({ yes_bid: 82 }), 85), null, "spread 4");
  assert.equal(nullFavIntention(snap({ no_bid_size: 0 }), 85), null, "nothing resting");
  assert.equal(nullFavIntention(snap({ spot_age_s: 30 }), 85), null, "stale spot");
  assert.equal(nullFavIntention(snap({ yes_ask: 42, no_ask: 58, no_bid: 57, yes_bid: 41 }), 55)!.side, "DOWN");
});

test("E1 roster override releases ONLY the listed cards, keeps every other status, and writes nothing to the real learner", () => {
  const card = (id: string, status: SkillCard["status"]) => ({ id, owner: id.split(".")[0], status, n: 700, ev_n: 700, wilson: 0.99, ev: 1.9, last20: [], pocket: {} }) as unknown as SkillCard;
  const learner = { skills: { "STREAK.continue_young": card("STREAK.continue_young", "SHADOW"), "TAPE.persist_imbalance": card("TAPE.persist_imbalance", "SHADOW") } } as unknown as Learner;
  const vote = (seat: string, skill: string, lean: "UP" | "DOWN" | "WAIT", raw: "UP" | "DOWN" | "WAIT" = lean): Vote => ({ seat, skill_used: skill, skill_status: "SHADOW", lean, raw_lean: raw, confidence: 70, raw_conf: 64, forced_sit: lean === "WAIT" && raw !== "WAIT" } as unknown as Vote);
  const out = unmuteRoster([vote("STREAK", "STREAK.continue_young", "WAIT", "UP"), vote("TAPE", "TAPE.persist_imbalance", "WAIT", "UP")], learner);
  assert.deepEqual(out.released, ["STREAK.continue_young"]);
  assert.equal(out.votes[0]!.lean, "UP");
  assert.equal(out.votes[0]!.skill_used, "E1_UNMUTE::STREAK.continue_young");
  assert.equal(out.votes[1]!.lean, "WAIT", "TAPE is not in the package");
  assert.equal(learner.skills["STREAK.continue_young"]!.status, "SHADOW", "the real learner is untouched");
  assert.equal(out.learner.skills["E1_UNMUTE::STREAK.continue_young"]!.status, "LIVE");
  assert.ok(out.missing.includes("STRIKE.itm_time"), "a card absent from this learner is flagged, not invented");
  assert.equal(E1_ROSTER_CARDS.length, 6);
  assert.equal(e1FamilyOf("STREAK"), "book");
  assert.equal(e1FamilyOf("CHAIN"), "derivs");
  assert.equal(e1FamilyOf("CARRY"), "derivs");
});

test("E2 jump veto: a ≥2¢ ask change starts an 8 s cooldown; unchanged polls are not new events; the cooldown expires", () => {
  let st = blankJumpVeto();
  st = observeJump(st, 85, 16, 1_000);
  assert.equal(vetoActive(st, 1_000), false, "the first quote is a baseline, not a shock");
  st = observeJump(st, 86, 15, 2_000);
  assert.equal(vetoActive(st, 2_000), false, "1¢ is under the threshold");
  st = observeJump(st, 88, 13, 3_000);
  assert.equal(vetoActive(st, 3_000), true);
  assert.deepEqual({ side: st.last_shock_side, cents: st.last_shock_cents }, { side: "DOWN", cents: -2 });
  st = observeJump(st, 88, 13, 6_000);
  assert.equal(st.last_shock_ms, 3_000, "an unchanged re-poll does not restart the cooldown");
  assert.equal(vetoActive(st, 10_999), true);
  assert.equal(vetoActive(st, 11_000), false);
  assert.equal(vetoActive(st, 11_000, 15_000), true, "the 15 s sensitivity is a separate arm");
  assert.equal(JUMP_VETO.primary_cooldown_ms, 8_000);
});

test("E3: the parameterised fair equals the live fair at the live basis exactly; a larger basis pulls fair toward 50 and shrinks edge", () => {
  const s = snap();
  assert.equal(fairYesCentsWithBasis(s, SETTLE_BASIS), fairYesCents(s));
  assert.equal(SETTLE_BASIS_CANDIDATES_BPS.live, 2);
  assert.equal(SETTLE_BASIS_CANDIDATES_BPS.primary, 7);
  const live = fairYesCentsWithBasis(s, 2 / 10_000), seven = fairYesCentsWithBasis(s, 7 / 10_000);
  assert.ok(seven < live && seven > 50);
  assert.ok(edgeUnderBasis(s, "UP", 7) < edgeUnderBasis(s, "UP", 2));
  assert.equal(edgeUnderBasis(s, "UP", 2), live - 86 - 1);
  assert.ok(Number.isNaN(edgeUnderBasis(snap({ yes_ask: 100 }), "UP", 7)));
});
