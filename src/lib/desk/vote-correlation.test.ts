import assert from "node:assert/strict";
import test from "node:test";
import { pairCorrelations, type VoteObservation } from "./vote-correlation.ts";

const ob = (window: string, at: number, seat: VoteObservation["seat"], lean: VoteObservation["lean"], heard = true): VoteObservation => ({ window, at_ms: at, seat, lean, heard, healthy: true });

test("a missing observation is never agreement: pairs form only on identical instants where both seats were observed", () => {
  const obs = [ob("w1", 1, "CARRY", "UP"), ob("w1", 1, "CHAIN", "UP"), ob("w2", 2, "CARRY", "UP"), ob("w3", 3, "CHAIN", "UP"), ob("w4", 4, "CARRY", "DOWN"), ob("w4", 5, "CHAIN", "DOWN")];
  const [p] = pairCorrelations(obs);
  assert.equal(p!.n_both_observed, 1, "w2/w3 have one seat each; w4's two reads are at different instants");
  assert.equal(p!.directional_agree, 1);
});

test("phi, raw agreement including WAIT, directional agreement excluding WAIT, and same-family vs cross-family", () => {
  const obs: VoteObservation[] = [];
  const add = (w: string, a: VoteObservation["lean"], b: VoteObservation["lean"], seatB: VoteObservation["seat"] = "CHAIN") => { obs.push(ob(w, 1, "CARRY", a), ob(w, 1, seatB, b)); };
  add("1", "UP", "UP"); add("2", "DOWN", "DOWN"); add("3", "UP", "DOWN"); add("4", "WAIT", "WAIT"); add("5", "WAIT", "UP");
  const [p] = pairCorrelations(obs);
  assert.equal(p!.n_both_observed, 5);
  assert.equal(p!.agree_incl_wait, 3);
  assert.equal(p!.n_both_directional, 3);
  assert.equal(p!.directional_agree, 2);
  assert.deepEqual({ uu: p!.uu, ud: p!.ud, du: p!.du, dd: p!.dd }, { uu: 1, ud: 1, du: 0, dd: 1 });
  assert.equal(p!.phi, Math.round(((1 * 1 - 1 * 0) / Math.sqrt(2 * 1 * 1 * 2)) * 1000) / 1000);
  assert.equal(p!.same_family, true);
  assert.equal(p!.both_quorum_eligible_same_side, 0, "same family: the two can never count as two groups");
  const cross = pairCorrelations([ob("x", 1, "STREAK", "UP"), ob("x", 1, "CHAIN", "UP")]);
  assert.equal(cross[0]!.same_family, false);
  assert.equal(cross[0]!.both_quorum_eligible_same_side, 1);
});

test("phi is null when a margin is empty (a seat that only ever said UP)", () => {
  const [p] = pairCorrelations([ob("1", 1, "CARRY", "UP"), ob("1", 1, "CHAIN", "UP"), ob("2", 2, "CARRY", "UP"), ob("2", 2, "CHAIN", "DOWN")]);
  assert.equal(p!.phi, null);
});
