/**
 * Council Room V1 — Phase 2 R2 regression: the real poller + the real cycle
 * wiring the page hook uses (createPoller + createChamberCycle), with injected
 * readers and timers. FIXTURES ARE SYNTHETIC: see council-room.fixtures.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChamberStatement } from "./chamber-reactions.ts";
import { createPoller, initialFeed, type FeedState } from "./council-room-feed.ts";
import { buildRoomModel, createChamberCycle, emptySnapshotState, snapshotPhase, type SnapshotState } from "./council-room-lite.ts";
import { parseRosterSnapshot, type RosterSnapshot } from "./council-room-snapshot.ts";
import { CLOSE, RECEIVED, SYNTHETIC, TICKER } from "./council-room.fixtures.ts";
import { SEAT_IDS } from "./types.ts";

const env = { hidden: false, online: true };

function frame(): RosterSnapshot {
  const s = parseRosterSnapshot({
    as_of: RECEIVED,
    tick_age_s: 1,
    snap: { ticker: TICKER, close_time: CLOSE },
    chair: { lean: "WAIT", rows: SEAT_IDS.map((seat) => ({ seat, lean: seat === "STRIKE" ? "UP" : "WAIT", selectable_live_cards: 1, authority_ready_cards: 1 })) },
  });
  assert.ok(s);
  return s;
}

type Step = { events: "ok" | "fail"; frame?: "ok" | "fail" };

/** Drives the real poller through scripted cycles and records what each cycle did. */
function rig(script: Step[]) {
  let clock = RECEIVED;
  let feed: FeedState = initialFeed([], RECEIVED);
  let snapshot: SnapshotState = emptySnapshotState();
  let frameCalls = 0;
  let eventCalls = 0;
  let cycle = 0;
  const timers = new Map<number, () => void>();
  let id = 0;
  const cycleWiring = createChamberCycle({
    readEvents: async () => {
      eventCalls += 1;
      const step = script[cycle] ?? { events: "ok", frame: "ok" };
      if (step.events === "fail") throw new Error("event read 503");
      return [SYNTHETIC.book()] as ChamberStatement[];
    },
    readSnapshot: async () => {
      frameCalls += 1;
      const step = script[cycle] ?? { events: "ok", frame: "ok" };
      if (step.frame === "fail") throw new Error("frame 503");
      return frame();
    },
    now: () => clock,
    updateFeed: (fn) => (feed = fn(feed)),
    updateSnapshot: (fn) => (snapshot = fn(snapshot)),
    isAlive: () => true,
  });
  const poller = createPoller({
    ...cycleWiring,
    now: () => clock,
    setTimer: (fn) => {
      const h = ++id;
      timers.set(h, fn);
      return h;
    },
    clearTimer: (h) => timers.delete(h as number),
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    async start() {
      poller.start();
      await settle();
      cycle += 1;
    },
    async next() {
      clock += 12_000;
      const pending = [...timers.values()];
      timers.clear();
      assert.equal(pending.length, 1, "exactly one scheduled cycle");
      pending[0]();
      await settle();
      cycle += 1;
    },
    get state() {
      return { feed, snapshot, frameCalls, eventCalls, clock };
    },
  };
}

test("a rejected event read demotes a populated snapshot immediately, with no /frame call", async () => {
  const r = rig([{ events: "ok", frame: "ok" }, { events: "fail" }]);
  await r.start();
  const readAt = r.state.snapshot.last_success_ms;
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "current");
  assert.equal(r.state.frameCalls, 1);
  await r.next();
  assert.equal(r.state.frameCalls, 1, "zero /frame calls on the failed cycle");
  assert.equal(r.state.eventCalls, 2);
  assert.equal(r.state.snapshot.failures, 1, "counted exactly once");
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "stale", "immediately stale, not current until 36 s");
  assert.equal(r.state.snapshot.last_success_ms, readAt, "original read time retained");
  assert.ok(r.state.snapshot.value, "last good value retained");
  assert.equal(r.state.feed.failures, 1, "feed error handling preserved");
  const m = buildRoomModel(r.state.snapshot, r.state.feed, r.state.clock, env);
  assert.equal(m.snapshotReadMs, readAt);
  assert.equal(m.seats.find((s) => s.seat === "STRIKE")!.read, "UP", "stale keeps last values, never WAIT");
});

test("an initial event failure shows unavailable; three in a row show disconnected and unknown", async () => {
  const r = rig([{ events: "fail" }, { events: "fail" }, { events: "fail" }]);
  await r.start();
  assert.equal(r.state.frameCalls, 0);
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "unavailable");
  await r.next();
  await r.next();
  assert.equal(r.state.frameCalls, 0);
  assert.equal(r.state.snapshot.failures, 3);
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "disconnected");
  const m = buildRoomModel(r.state.snapshot, r.state.feed, r.state.clock, env);
  assert.ok(m.seats.every((s) => s.read === "unknown"));
  assert.equal(m.chair.current, "unknown");
});

test("a later successful cycle resets failures and replays without flashing", async () => {
  const r = rig([{ events: "ok", frame: "ok" }, { events: "fail" }, { events: "fail" }, { events: "fail" }, { events: "ok", frame: "ok" }]);
  await r.start();
  for (let i = 0; i < 3; i++) await r.next();
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "disconnected");
  await r.next();
  assert.equal(r.state.snapshot.failures, 0);
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "current");
  const m = buildRoomModel(r.state.snapshot, r.state.feed, r.state.clock, env);
  assert.equal(m.chair.flash || m.book.flash || m.integrity.flash || m.lab.flash || m.seats.some((s) => s.flash), false, "recovery replay never flashes");
  assert.ok(r.state.feed.events.every((e) => e.arrival !== "fresh"));
});

test("an event success with a /frame failure counts once", async () => {
  const r = rig([{ events: "ok", frame: "ok" }, { events: "ok", frame: "fail" }]);
  await r.start();
  await r.next();
  assert.equal(r.state.frameCalls, 2, "one /frame GET per cycle");
  assert.equal(r.state.snapshot.failures, 1);
  assert.equal(r.state.feed.failures, 0);
  assert.equal(snapshotPhase(r.state.snapshot, r.state.clock, env), "stale");
});

test("request bound: one event GET then at most one /frame GET per cycle", async () => {
  const r = rig([{ events: "ok", frame: "ok" }, { events: "fail" }, { events: "ok", frame: "fail" }, { events: "ok", frame: "ok" }]);
  await r.start();
  for (let i = 0; i < 3; i++) await r.next();
  assert.equal(r.state.eventCalls, 4);
  assert.equal(r.state.frameCalls, 3, "the failed event cycle made no /frame call");
});

test("nothing is written after unmount", async () => {
  let writes = 0;
  const cycle = createChamberCycle({
    readEvents: async () => {
      throw new Error("x");
    },
    readSnapshot: async () => null,
    now: () => RECEIVED,
    updateFeed: () => void (writes += 1),
    updateSnapshot: () => void (writes += 1),
    isAlive: () => false,
  });
  cycle.onFailure(new Error("x"), RECEIVED);
  cycle.onDelivery([], RECEIVED);
  cycle.onGap();
  assert.equal(writes, 0);
});
