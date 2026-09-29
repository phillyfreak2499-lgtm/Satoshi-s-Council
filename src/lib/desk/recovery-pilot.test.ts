import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECOVERY_PILOT_SOURCE,
  chairOnlyCalls,
  recoveryPilotBookOk,
  recoveryPilotCandidate,
  recoveryPilotDecision,
  recoveryPilotEnabled,
  recoveryPilotStartAtBoot,
  type RecoveryPilotContext,
} from "./recovery-pilot.ts";
import type { CallLogRow, Snapshot } from "./types";

const NOW = Date.parse("2026-09-29T22:15:00.000Z");

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    as_of: NOW,
    close_time: NOW + 420_000,
    ticker: "KXBTC15M-26SEP292230-30",
    secs_left: 420,
    mins_left: 7,
    yes_bid: 87,
    yes_ask: 88,
    no_bid: 11,
    no_ask: 12,
    yes_bid_size: 4,
    no_bid_size: 5,
    spot_age_s: 2,
    obs: { receipt_ts: NOW - 1_000, gap: "ok" },
    health: {
      spot_ok: true,
      kalshi_ok: true,
      spot: "LIVE",
      kalshi: "LIVE",
      spot_divergent: false,
      basis_wide: false,
    },
    ...over,
  } as Snapshot;
}

const ctx = (over: Partial<RecoveryPilotContext> = {}): RecoveryPilotContext => ({
  calls: [],
  ready: true,
  start: NOW - 900_000,
  watch: null,
  ...over,
});

test("the recovery pilot is off unless explicitly enabled", () => {
  assert.equal(recoveryPilotEnabled({}), false);
  assert.equal(recoveryPilotEnabled({ RECOVERY_PILOT_CALLS_ENABLED: "true" }), true);
  assert.equal(recoveryPilotEnabled({ RECOVERY_PILOT_CALLS_ENABLED: "TRUE" }), false);
});

test("only source-free rows may feed Chair-only consumers", () => {
  const chair = { id: "chair", t: NOW, ticker: "C", close_time: NOW, lean: "UP", cents: 88, settle: null, flipped: false } as CallLogRow;
  const pilot = { ...chair, id: "pilot", source: RECOVERY_PILOT_SOURCE } as CallLogRow;
  assert.deepEqual(chairOnlyCalls([pilot, chair]), [chair]);
});

test("activation resets to the next complete window unless the prior process was enabled", () => {
  const stale = NOW - 3_600_000;
  const next = Math.ceil(NOW / 900_000) * 900_000;
  // OFF processes still persist a housekeeping boundary. It must not become
  // activation authority when the flag later flips on.
  assert.equal(recoveryPilotStartAtBoot(NOW, true, false, stale), next);
  assert.equal(recoveryPilotStartAtBoot(NOW, true, true, stale), stale);
  assert.equal(recoveryPilotStartAtBoot(NOW, false, true, stale), next);
  assert.equal(recoveryPilotStartAtBoot(NOW, true, true, "bad"), next);
});

test("candidate is the 85–94.9c favourite only on a fresh, tight, sized book", () => {
  assert.deepEqual(recoveryPilotCandidate(snap()), { side: "UP", ask: 88, spread: 1, touch: 5 });
  assert.equal(recoveryPilotCandidate(snap({ yes_ask: 84 })), null);
  assert.equal(recoveryPilotCandidate(snap({ yes_ask: 95 })), null);
  assert.equal(recoveryPilotCandidate(snap({ yes_bid: 84 })), null);
  assert.equal(recoveryPilotCandidate(snap({ no_bid_size: 0 })), null);
  assert.equal(recoveryPilotCandidate(snap({ spot_age_s: 16 })), null);
  assert.equal(recoveryPilotCandidate(snap({ as_of: NOW + 121_000 })), null, "under five minutes is outside the frozen band");
});

test("three same-side frames over eight seconds are required and rechecked at booking", () => {
  const a = recoveryPilotDecision(snap(), ctx());
  assert.equal(a.eligible, false);
  const bSnap = snap({ as_of: NOW + 4_000, close_time: NOW + 420_000, obs: { ...snap().obs, receipt_ts: NOW + 3_000 } });
  const b = recoveryPilotDecision(bSnap, ctx({ watch: a.watch }));
  assert.equal(b.eligible, false);
  const cSnap = snap({ as_of: NOW + 8_000, close_time: NOW + 420_000, obs: { ...snap().obs, receipt_ts: NOW + 7_000 } });
  const cCtx = ctx({ watch: b.watch });
  const c = recoveryPilotDecision(cSnap, cCtx);
  assert.equal(c.eligible, true);
  assert.equal(recoveryPilotBookOk(cSnap, { ...cCtx, watch: c.watch }, c), true);
  assert.equal(recoveryPilotBookOk(snap({ ...cSnap, yes_ask: 95 }), { ...cCtx, watch: c.watch }, c), false);
});

test("pilot rows are capped at three and the first settled pilot loss stops the day", () => {
  const row = (n: number, settle: number | null): CallLogRow => ({
    id: String(n), t: NOW - n * 1_000, ticker: `T${n}`, close_time: NOW - n * 500,
    lean: "UP", cents: 88, settle, flipped: false, source: RECOVERY_PILOT_SOURCE,
  });
  const capped = recoveryPilotDecision(snap(), ctx({ calls: [row(1, 100), row(2, 100), row(3, 100)] }));
  assert.equal(capped.eligible, false);
  assert.match(capped.reason ?? "", /cap reached/);
  const stopped = recoveryPilotDecision(snap(), ctx({ calls: [row(1, 0)] }));
  assert.equal(stopped.eligible, false);
  assert.match(stopped.reason ?? "", /first settled loss/);
});

test("the source marker is mandatory follower-exclusion metadata", () => {
  const published: CallLogRow = {
    id: `${snap().close_time}-UP-${snap().as_of}`,
    t: snap().as_of,
    ticker: snap().ticker,
    close_time: snap().close_time,
    lean: "UP",
    cents: 88,
    settle: null,
    flipped: false,
    source: RECOVERY_PILOT_SOURCE,
  };
  assert.equal(Object.hasOwn(published, "source"), true);
  assert.equal(published.source, "RECOVERY_FAV85_V1");
});
