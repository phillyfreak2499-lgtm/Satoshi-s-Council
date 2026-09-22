import assert from "node:assert/strict";
import test from "node:test";
import { MIRROR35, mirror35Intention } from "./shadow-arms.ts";
import { E4_MIRROR_35_V1, SHADOW_MANIFESTS, activeShadowCount, capRespected } from "./shadow-manifests.ts";
import { SHADOW_MAX_ACTIVE, countsAgainstCap } from "./shadow-lab.ts";
import type { Snapshot } from "./types";

const close = Date.parse("2026-09-22T15:00:00Z");
/** One fixed window close; `secs` moves as_of so successive ticks share the window key. */
const snap = (secs: number, extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: close - secs * 1000, close_time: close, ticker: "KXBTC15M-26SEP221100-00", yes_ask: 40, yes_bid: 39, no_ask: 61, no_bid: 60, no_bid_size: 25, yes_bid_size: 30, spot_age_s: 1,
  obs: { receipt_ts: close - secs * 1000 - 1000, gap: "ok" }, health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false }, ...extra,
} as Snapshot);

test("MIRROR-35 fires once per window on the first touch inside T−5..T−2 and records the signal quote apart from the executable quote", () => {
  const seen = new Set<string>();
  const i = mirror35Intention(snap(280), seen)!;
  assert.deepEqual({ side: i.side, ask: i.ask_cents, fee: i.fee_cents, signal: i.signal_ask, exec: i.hypothetical_exec_ask, first: i.first_touch }, { side: "UP", ask: 40, fee: 2, signal: 40, exec: 40, first: true });
  assert.equal(mirror35Intention(snap(270), seen), null, "a second tick in the same window is not a second intention");
  assert.equal(mirror35Intention(snap(310), new Set()), null, "outside T−5");
  assert.equal(mirror35Intention(snap(110), new Set()), null, "inside T−2");
  assert.equal(mirror35Intention(snap(280, { yes_ask: 46, no_ask: 55 }), new Set()), null, "no side in [30, 45)");
  assert.equal(mirror35Intention(snap(280, { no_bid_size: 0 }), new Set())!.hypothetical_exec_ask, null, "no resting size: the executable quote is UNKNOWN, the signal is still recorded");
  assert.equal(MIRROR35.discovery_cells_searched, 60);
});

test("MIRROR-35 is registered CANDIDATE_NOT_COLLECTING under the three-active cap and can never be the deployed policy", () => {
  assert.equal(SHADOW_MANIFESTS.length, 4);
  assert.equal(E4_MIRROR_35_V1.status, "CANDIDATE_NOT_COLLECTING");
  assert.equal(countsAgainstCap("CANDIDATE_NOT_COLLECTING"), false);
  assert.equal(SHADOW_MAX_ACTIVE, 3);
  assert.equal(activeShadowCount(), 0, "nothing collects until an owner activates");
  assert.equal(capRespected(), true);
  const four = SHADOW_MANIFESTS.map((m) => ({ ...m, status: "SHADOW" as const }));
  assert.equal(capRespected(four), false, "four collecting would breach the cap");
  assert.equal(E4_MIRROR_35_V1.authority, "none");
  assert.equal(E4_MIRROR_35_V1.prospective_start_at, null);
});
