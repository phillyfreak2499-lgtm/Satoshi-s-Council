import test from "node:test";
import assert from "node:assert/strict";
import { sweepCrewEvent } from "./chamber-sweep";

test("SWEEP maps a persisted flag transition to a public desk update", () => {
  const ev = sweepCrewEvent({
    t: "2026-09-13T05:07:35.209Z",
    seat: "CARRY",
    action: "flag",
    detail: "CARRY GOLD — right 68% of 40 mid-window reads, 2.2¢ a contract at the ask",
    slug: "sweep-2026-09-13-CARRY-GOLD",
    evidence: { reads: 44, spoke: 48, mid_n: 40, mid_hit_pct: 68, mid_cents: 2.2, grade_n: 48 },
  });
  assert.ok(ev);
  assert.equal(ev.event_key, "DESK_UPDATE:SWEEP:sweep-2026-09-13-CARRY-GOLD");
  assert.equal(ev.event_type, "DESK_UPDATE");
  assert.equal(ev.character, "SWEEP");
  assert.equal(ev.source_type, "desk_update");
  assert.equal(ev.public, true);
  assert.equal(ev.payload?.seat, "CARRY");
  assert.equal(ev.payload?.action, "flag");
  assert.equal(ev.payload?.mid_n, 40);
  assert.equal(ev.payload?.mid_cents, 2.2);
  assert.equal(ev.payload?.authority, "none");
});

test("SWEEP maps clear transitions and rejects non-transition chatter", () => {
  const clear = sweepCrewEvent({
    t: "2026-09-13T14:31:59.014Z",
    seat: "STREAK",
    action: "clear",
    detail: "STREAK no longer GOLD",
    slug: "sweep-2026-09-13-STREAK-clear-GOLD",
    evidence: { mid_n: 280, mid_hit_pct: 76, mid_cents: 0 },
  });
  assert.ok(clear);
  assert.equal(clear.payload?.action, "clear");

  assert.equal(
    sweepCrewEvent({
      t: "2026-09-13T14:31:59.014Z",
      seat: "STREAK",
      action: "run",
      detail: "daily sweep complete",
      slug: "sweep-run",
      evidence: null,
    }),
    null,
  );
});
