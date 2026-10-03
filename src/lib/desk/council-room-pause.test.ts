/**
 * Council Room V1 — CR-CLAUDE-003 viewer pause (§9.7). Drives the real poller
 * and the real cycle wiring the page hook uses, with deferred reads so in-flight
 * timing is explicit. FIXTURES ARE SYNTHETIC: see council-room.fixtures.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChamberStatement } from "./chamber-reactions.ts";
import { createPoller, feedPhase, initialFeed, FEED_INTERVAL_MS, STALE_AFTER_MS, type FeedState } from "./council-room-feed.ts";
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

type Pending = { resolve: (rows: ChamberStatement[]) => void; reject: (e: Error) => void };

/** Every event read waits until the test settles it, so overlap is observable. */
function rig() {
  let clock = RECEIVED;
  let feed: FeedState = initialFeed([], RECEIVED);
  let snapshot: SnapshotState = emptySnapshotState();
  let eventCalls = 0;
  let frameCalls = 0;
  let open = 0;
  let maxOpen = 0;
  let frameFails = false;
  const pending: Pending[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let maxTimers = 0;
  let id = 0;
  const cycle = createChamberCycle({
    readEvents: () => {
      eventCalls += 1;
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      return new Promise<ChamberStatement[]>((resolve, reject) => {
        pending.push({
          resolve: (rows) => {
            open -= 1;
            resolve(rows);
          },
          reject: (e) => {
            open -= 1;
            reject(e);
          },
        });
      });
    },
    readSnapshot: async () => {
      frameCalls += 1;
      if (frameFails) throw new Error("frame 503");
      return frame();
    },
    now: () => clock,
    updateFeed: (fn) => (feed = fn(feed)),
    updateSnapshot: (fn) => (snapshot = fn(snapshot)),
    isAlive: () => true,
  });
  const poller = createPoller({
    ...cycle,
    now: () => clock,
    setTimer: (fn, ms) => {
      const h = ++id;
      timers.set(h, { fn, ms });
      maxTimers = Math.max(maxTimers, timers.size);
      return h;
    },
    clearTimer: (h) => timers.delete(h as number),
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    poller,
    async ok(rows: ChamberStatement[] = [SYNTHETIC.book()]) {
      const p = pending.shift();
      assert.ok(p, "a read is in flight");
      p.resolve(rows);
      await settle();
    },
    async fail() {
      const p = pending.shift();
      assert.ok(p, "a read is in flight");
      p.reject(new Error("event read 503"));
      await settle();
    },
    /** Fire the one scheduled timer, if any. Returns whether one fired. */
    async tick(): Promise<boolean> {
      clock += FEED_INTERVAL_MS;
      const all = [...timers.values()];
      timers.clear();
      if (!all.length) return false;
      assert.equal(all.length, 1, "never more than one scheduled cycle");
      all[0].fn();
      await settle();
      return true;
    },
    advance(ms: number) {
      clock += ms;
    },
    setFrameFails(v: boolean) {
      frameFails = v;
    },
    get s() {
      return { feed, snapshot, eventCalls, frameCalls, open, maxOpen, inFlight: pending.length, timers: [...timers.values()], maxTimers, clock };
    },
  };
}

async function started() {
  const r = rig();
  r.poller.start();
  await r.ok([]);
  return r;
}

test("1. no new requests while viewer-paused, even across tab and network changes", async () => {
  const r = await started();
  assert.equal(r.s.eventCalls, 1);
  r.poller.setPaused(true);
  assert.equal(r.s.timers.length, 0, "the pending cycle is cancelled");
  for (let i = 0; i < 5; i++) assert.equal(await r.tick(), false, "nothing scheduled");
  r.poller.setHidden(true);
  r.poller.setHidden(false);
  r.poller.setOnline(false);
  r.poller.setOnline(true);
  await r.poller.pullNow();
  assert.equal(r.s.eventCalls, 1, "no event GET while paused");
  assert.equal(r.s.frameCalls, 1, "no /frame GET while paused");
  assert.equal(r.s.timers.length, 0);
});

test("2. a cycle in flight at pause settles and its result is discarded, success or failure", async () => {
  const r = await started();
  const before = { feed: r.s.feed, snapshot: r.s.snapshot };
  assert.equal(await r.tick(), true);
  assert.equal(r.s.inFlight, 1);
  r.poller.setPaused(true);
  await r.ok([SYNTHETIC.book(), SYNTHETIC.alert()]);
  assert.equal(r.s.feed.events.length, before.feed.events.length, "no rows applied after the pause");
  assert.equal(r.s.feed.last_success_ms, before.feed.last_success_ms);
  assert.equal(r.s.snapshot, before.snapshot, "snapshot untouched by the discarded read");
  assert.equal(r.s.timers.length, 0, "and nothing is scheduled after it");

  const f = await started();
  const fb = { feed: f.s.feed, snapshot: f.s.snapshot };
  assert.equal(await f.tick(), true);
  f.poller.setPaused(true);
  await f.fail();
  assert.equal(f.s.feed.failures, 0, "a discarded failure is not counted");
  assert.equal(f.s.feed.last_error, fb.feed.last_error);
  assert.equal(f.s.snapshot.failures, fb.snapshot.failures);
  assert.equal(f.s.timers.length, 0);
});

test("3. resume runs exactly one serialized cycle, then the 12 s cadence returns", async () => {
  const r = await started();
  r.poller.setPaused(true);
  r.advance(60_000);
  r.poller.setPaused(false);
  assert.equal(r.s.eventCalls, 2, "one event GET at resume");
  assert.equal(r.s.timers.length, 0, "no timer while it is in flight");
  await r.ok([]);
  assert.equal(r.s.frameCalls, 2, "then at most one /frame GET");
  assert.equal(r.s.timers.length, 1);
  assert.equal(r.s.timers[0].ms, FEED_INTERVAL_MS, "back to the normal interval");
  assert.equal(await r.tick(), true);
  await r.ok([]);
  assert.equal(r.s.eventCalls, 3);
  assert.equal(r.s.frameCalls, 3);
});

test("3b. resume while the discarded read is still in flight waits for it, then runs one cycle", async () => {
  const r = await started();
  assert.equal(await r.tick(), true);
  r.poller.setPaused(true);
  r.poller.setPaused(false);
  assert.equal(r.s.eventCalls, 2, "no second read while one is open");
  await r.ok([SYNTHETIC.book()]);
  assert.equal(r.s.feed.events.length, 0, "the read that saw the pause is still discarded");
  assert.equal(r.s.eventCalls, 3, "the resume cycle starts as soon as it settles");
  assert.equal(r.s.timers.length, 0);
  await r.ok([SYNTHETIC.book()]);
  assert.equal(r.s.feed.events.length, 1);
  assert.equal(r.s.timers.length, 1);
  assert.equal(r.s.maxOpen, 1, "reads never overlapped");
});

test("4. repeated pause/resume never stacks timers or overlaps reads", async () => {
  const r = await started();
  for (let i = 0; i < 10; i++) {
    r.poller.setPaused(true);
    r.poller.setPaused(false);
    r.poller.setPaused(true);
    r.poller.setPaused(false);
    if (i % 3 === 0 && r.s.inFlight) await r.ok([]);
  }
  while (r.s.inFlight) await r.ok([]);
  assert.equal(r.s.maxOpen, 1, "at most one read open at any time");
  assert.ok(r.s.maxTimers <= 1, "at most one timer ever scheduled");
  assert.equal(r.s.timers.length, 1);
  assert.ok(r.s.frameCalls <= r.s.eventCalls, "never more than one /frame GET per event GET");
});

test("5. no synthetic events, flashes, WAIT or snapshot-diff lines while paused; rows read on resume are history", async () => {
  const r = await started();
  r.poller.setPaused(true);
  const pausedModel = buildRoomModel(r.s.snapshot, r.s.feed, r.s.clock, { ...env, userPaused: true });
  assert.equal(r.s.feed.events.length, 0, "no event appears while paused");
  assert.equal(pausedModel.chair.recorded, null);
  assert.equal(pausedModel.book.recorded, null);
  assert.equal(pausedModel.chair.flash || pausedModel.book.flash || pausedModel.integrity.flash || pausedModel.lab.flash || pausedModel.seats.some((s) => s.flash), false);
  r.poller.setPaused(false);
  await r.ok([SYNTHETIC.book(), SYNTHETIC.alert(), SYNTHETIC.wait()]);
  assert.ok(r.s.feed.events.length > 0);
  assert.ok(r.s.feed.events.every((e) => e.arrival === "history"), "rows recorded during the pause are replay, never fresh");
  const after = buildRoomModel(r.s.snapshot, r.s.feed, r.s.clock, env);
  assert.equal(after.chair.flash || after.book.flash || after.integrity.flash || after.lab.flash || after.seats.some((s) => s.flash), false, "resume never flashes");
  const ids = r.s.feed.events.map((e) => e.event_id);
  assert.equal(new Set(ids).size, ids.length, "deduped");
});

test("6. a pause leaves failure counts, last-good values and read times exactly as they were", async () => {
  const r = await started();
  r.setFrameFails(true);
  assert.equal(await r.tick(), true);
  await r.ok([]);
  assert.equal(r.s.snapshot.failures, 1);
  const snapBefore = r.s.snapshot;
  const feedBefore = r.s.feed;
  r.poller.setPaused(true);
  r.advance(10 * 60_000);
  assert.equal(r.s.snapshot, snapBefore, "snapshot state object unchanged");
  assert.equal(r.s.feed.failures, feedBefore.failures);
  assert.equal(r.s.feed.last_success_ms, feedBefore.last_success_ms);
  assert.equal(r.s.feed.last_attempt_ms, feedBefore.last_attempt_ms);
  assert.equal(snapshotPhase(r.s.snapshot, r.s.clock, { ...env, userPaused: true }), "user_paused", "labelled as the viewer's pause");
  const m = buildRoomModel(r.s.snapshot, r.s.feed, r.s.clock, { ...env, userPaused: true });
  assert.equal(m.snapshot, "user_paused");
  assert.equal(m.snapshotReadMs, snapBefore.last_success_ms, "original read time retained");
  assert.equal(m.seats.find((s) => s.seat === "STRIKE")!.read, "UP", "last values retained, never WAIT");
  r.setFrameFails(false);
  r.poller.setPaused(false);
  await r.ok([]);
  assert.equal(r.s.snapshot.failures, 0, "the normal contract resumes: a full success resets");
});

test("6b. the viewer's pause is never shown as disconnected, unavailable or a failure, and never reveals hidden values", () => {
  const snap = emptySnapshotState();
  assert.equal(snapshotPhase(snap, RECEIVED, { ...env, userPaused: true }), "user_paused", "not unavailable/loading");
  let failed = emptySnapshotState();
  for (let i = 0; i < 3; i++) failed = { ...failed, failures: failed.failures + 1, last_attempt_ms: RECEIVED + i };
  assert.equal(snapshotPhase(failed, RECEIVED, { ...env, userPaused: true }), "user_paused");
  const m = buildRoomModel(failed, initialFeed([], RECEIVED), RECEIVED, { ...env, userPaused: true });
  assert.ok(m.seats.every((s) => s.read === "unknown"), "unknown stays unknown");
  assert.equal(m.snapshotReadMs, null);
  assert.equal(snapshotPhase(snap, RECEIVED, { hidden: false, online: false, userPaused: true }), "disconnected", "a real offline browser is still reported");
  assert.equal(snapshotPhase(snap, RECEIVED, { hidden: true, online: true, userPaused: true }), "paused");
});

test("6c. the held status clock keeps phases fixed while paused (no stale/current flip to announce)", async () => {
  const r = await started();
  const heldAt = r.s.clock;
  r.poller.setPaused(true);
  r.advance(STALE_AFTER_MS * 5);
  assert.equal(feedPhase(r.s.feed, heldAt, env), feedPhase(r.s.feed, r.s.clock - STALE_AFTER_MS * 5, env));
  assert.notEqual(feedPhase(r.s.feed, r.s.clock, env), feedPhase(r.s.feed, heldAt, env), "the real clock would have flipped to stale");
  const m = buildRoomModel(r.s.snapshot, r.s.feed, heldAt, { ...env, userPaused: true });
  assert.equal(m.snapshot, "user_paused");
});

test("8. hidden and offline still pause on their own, mark a gap and replay without flashing", async () => {
  const r = await started();
  r.poller.setHidden(true);
  assert.equal(r.s.timers.length, 0);
  r.poller.setHidden(false);
  assert.equal(r.s.eventCalls, 2, "return from hidden triggers one read");
  await r.ok([SYNTHETIC.book()]);
  assert.ok(r.s.feed.events.every((e) => e.arrival === "history"));
  r.poller.setOnline(false);
  assert.equal(r.s.timers.length, 0);
  r.poller.setOnline(true);
  assert.equal(r.s.eventCalls, 3);
  await r.ok([SYNTHETIC.book()]);
  assert.equal(r.s.feed.events.length, 1, "deduped across gaps");
  assert.equal(r.s.maxOpen, 1);
});

test("stop() during a paused in-flight read writes nothing and schedules nothing", async () => {
  const r = await started();
  assert.equal(await r.tick(), true);
  r.poller.setPaused(true);
  r.poller.stop();
  const before = r.s.feed;
  await r.ok([SYNTHETIC.book()]);
  assert.equal(r.s.feed, before);
  assert.equal(r.s.timers.length, 0);
  r.poller.setPaused(false);
  assert.equal(r.s.eventCalls, 2, "a stopped poller does not resume");
});
