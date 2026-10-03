/**
 * Council Room V1 — feed, poller and snapshot tests against the actual modules.
 * FIXTURES ARE SYNTHETIC: see council-room.fixtures.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChamberStatement } from "./chamber-reactions.ts";
import {
  applyDelivery,
  applyFailure,
  createPoller,
  feedPhase,
  initialFeed,
  markGap,
  DISCONNECTED_AFTER_FAILURES,
  FEED_INTERVAL_MS,
  MAX_EVENTS,
  STALE_AFTER_MS,
} from "./council-room-feed.ts";
import { parseRosterSnapshot } from "./council-room-snapshot.ts";
import { SYNTHETIC, bookCallAt } from "./council-room.fixtures.ts";

const Q = 900_000;
// SYNTHETIC consecutive windows: 26OCT021915 closes 23:15 UTC; each step is one quarter hour.
const BASE_CLOSE = Date.parse("2026-10-02T23:15:00Z");
function windowTicker(closeMs: number): string {
  const et = new Date(closeMs - 4 * 3_600_000); // EDT in October
  const hh = String(et.getUTCHours()).padStart(2, "0");
  const mm = String(et.getUTCMinutes()).padStart(2, "0");
  return `KXBTC15M-26OCT${String(et.getUTCDate()).padStart(2, "0")}${hh}${mm}-${mm}`;
}
const calls = Array.from({ length: 6 }, (_, i) => bookCallAt(BASE_CLOSE + i * Q, windowTicker(BASE_CLOSE + i * Q)));
const AFTER = BASE_CLOSE + 6 * Q;
const env = { hidden: false, online: true };

test("server-page rows carry the server receipt time and refuse rows recorded past the skew", () => {
  const future = bookCallAt(BASE_CLOSE + 2 * Q, windowTicker(BASE_CLOSE + 2 * Q));
  const f = initialFeed([calls[0], future], BASE_CLOSE + Q);
  assert.deepEqual(f.events.map((e) => e.event_id), [calls[0].event_key]);
  assert.deepEqual(f.refused.map((r) => r.reason), ["future-recorded-time"]);
  const none = initialFeed([calls[0]], Number.NaN);
  assert.equal(none.events.length, 0, "no receipt time, no narration");
  assert.deepEqual(none.refused.map((r) => r.reason), ["missing-receipt-time"]);
});

test("server-page rows and the first client read are history; later new rows are fresh", () => {
  let f = initialFeed([calls[0]], AFTER);
  assert.deepEqual(f.events.map((e) => e.arrival), ["history"]);
  assert.equal(f.events[0].received_at, new Date(AFTER).toISOString(), "server receipt time, not the recorded time");
  assert.notEqual(f.events[0].received_at, f.events[0].recorded_at);
  f = applyDelivery(f, [calls[0], calls[1]], AFTER);
  assert.deepEqual(f.events.map((e) => [e.event_id, e.arrival]), [[calls[1].event_key, "history"], [calls[0].event_key, "history"]]);
  f = applyDelivery(f, [calls[0], calls[1], calls[2]], AFTER + 12_000);
  assert.equal(f.events[0].event_id, calls[2].event_key);
  assert.equal(f.events[0].arrival, "fresh");
  f = applyDelivery(f, [calls[2]], AFTER + 24_000);
  assert.equal(f.events[0].arrival, "live", "a flash happens once");
});

test("duplicates are dropped and order is deterministic regardless of delivery order", () => {
  const a = applyDelivery(initialFeed([], AFTER), [calls[3], calls[1], calls[3], calls[2], calls[1]], AFTER);
  const b = applyDelivery(initialFeed([], AFTER), [calls[2], calls[1], calls[3]], AFTER);
  assert.deepEqual(a.events.map((e) => e.event_id), [calls[3], calls[2], calls[1]].map((s) => s.event_key));
  assert.deepEqual(a.events.map((e) => e.event_id), b.events.map((e) => e.event_id));
  const again = applyDelivery(a, [calls[3], calls[2]], AFTER + 12_000);
  assert.equal(again.events.length, 3);
  assert.ok(again.events.every((e) => e.arrival !== "fresh"), "re-delivery is not news");
});

test("equal recorded times tie-break by event id", () => {
  const w = SYNTHETIC.wait();
  const b = SYNTHETIC.book();
  const same = { ...b, occurred_at: w.occurred_at };
  const f = applyDelivery(initialFeed([], AFTER), [w, same], Date.parse(w.occurred_at) + 1000);
  const ids = f.events.map((e) => e.event_id);
  assert.deepEqual(ids, [...ids].sort());
});

test("an older row arriving after newer ones is marked late and does not flash", () => {
  let f = applyDelivery(initialFeed([], AFTER), [calls[4]], AFTER);
  f = applyDelivery(f, [calls[4], calls[2]], AFTER + 12_000);
  const late = f.events.find((e) => e.event_id === calls[2].event_key)!;
  assert.equal(late.arrival, "late");
  assert.equal(f.events[0].event_id, calls[4].event_key, "order follows recorded time, not arrival");
});

test("rows read after a hidden or offline gap are replay, not live", () => {
  let f = applyDelivery(initialFeed([], AFTER), [calls[0]], AFTER);
  f = markGap(f);
  f = applyDelivery(f, [calls[0], calls[1]], AFTER + 60_000);
  assert.equal(f.events.find((e) => e.event_id === calls[1].event_key)!.arrival, "history");
  f = applyDelivery(f, [calls[0], calls[1], calls[2]], AFTER + 72_000);
  assert.equal(f.events[0].arrival, "fresh", "continuity restored after one clean read");
});

test("a failed read keeps prior rows, reports the error, and the next success is replay", () => {
  let f = applyDelivery(initialFeed([], AFTER), [calls[0]], AFTER);
  f = applyDelivery(f, [calls[0], calls[1]], AFTER + 12_000);
  assert.equal(f.events[0].arrival, "fresh");
  f = applyFailure(f, new Error("desk read 503"), AFTER + 24_000);
  assert.equal(f.events.length, 2, "prior data preserved");
  assert.ok(f.events.every((e) => e.arrival !== "fresh"));
  assert.equal(f.last_error, "desk read 503");
  assert.equal(f.last_success_ms, AFTER + 12_000, "last successful receipt is not overwritten");
  assert.equal(feedPhase(f, AFTER + 24_000, env), "error");
  f = applyDelivery(f, [calls[0], calls[1], calls[2]], AFTER + 36_000);
  assert.equal(f.events[0].arrival, "history");
  assert.equal(f.failures, 0);
});

test("phases are distinct: loading, connected, empty, stale, error, disconnected, paused", () => {
  const blank = initialFeed([], AFTER);
  assert.equal(feedPhase(blank, null, env), "loading");
  const empty = applyDelivery(blank, [], AFTER);
  assert.equal(feedPhase(empty, AFTER, env), "empty");
  const full = applyDelivery(blank, [calls[0]], AFTER);
  assert.equal(feedPhase(full, AFTER + 1000, env), "connected");
  assert.equal(feedPhase(full, AFTER + STALE_AFTER_MS + 1, env), "stale");
  let failing = full;
  for (let i = 0; i < DISCONNECTED_AFTER_FAILURES; i++) failing = applyFailure(failing, "x", AFTER + i);
  assert.equal(feedPhase(failing, AFTER, env), "disconnected");
  assert.equal(feedPhase(full, AFTER, { hidden: false, online: false }), "disconnected");
  assert.equal(feedPhase(full, AFTER, { hidden: true, online: true }), "paused");
});

test("a successful read with nothing new is not desk activity", () => {
  const f = applyDelivery(initialFeed([], AFTER), [calls[0]], AFTER);
  const g = applyDelivery(f, [calls[0]], AFTER + 12_000);
  assert.deepEqual(g.events.map(({ arrival, event_id }) => [event_id, arrival]), f.events.map(({ arrival, event_id }) => [event_id, arrival]));
  assert.equal(g.high_water_ms, f.high_water_ms);
});

test("retention is bounded and an evicted id cannot return as new", () => {
  const many = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => bookCallAt(BASE_CLOSE + i * Q, windowTicker(BASE_CLOSE + i * Q)));
  let f = applyDelivery(initialFeed([], AFTER), many, BASE_CLOSE + (MAX_EVENTS + 6) * Q);
  assert.equal(f.events.length, MAX_EVENTS);
  assert.ok(!f.events.some((e) => e.event_id === many[0].event_key));
  f = applyDelivery(f, [many[0]], BASE_CLOSE + (MAX_EVENTS + 7) * Q);
  assert.ok(!f.events.some((e) => e.event_id === many[0].event_key), "evicted row does not re-enter as news");
});

test("refused records are reported separately and never narrated", () => {
  const bad = { ...calls[0], event_key: "bad key with spaces" } as ChamberStatement;
  const f = applyDelivery(initialFeed([], AFTER), [bad, calls[1], { nonsense: true } as unknown as ChamberStatement], AFTER);
  assert.deepEqual(f.events.map((e) => e.event_id), [calls[1].event_key]);
  assert.equal(f.refused.length, 2);
  assert.ok(f.refused.every((r) => r.reason === "malformed-identity"));
});

function harness(read: () => Promise<ChamberStatement[]>) {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const log: string[] = [];
  const poller = createPoller({
    read,
    onDelivery: (rows) => log.push(`delivery:${rows.length}`),
    onFailure: (e) => log.push(`failure:${e instanceof Error ? e.message : e}`),
    onGap: () => log.push("gap"),
    now: () => AFTER,
    setTimer: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
  });
  const fire = async () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const fn of pending) fn();
    await new Promise((r) => setImmediate(r));
  };
  return { poller, timers, log, fire };
}

test("the poller never overlaps reads and schedules the next only after one settles", async () => {
  let calls = 0;
  let release!: (rows: ChamberStatement[]) => void;
  const h = harness(() => {
    calls += 1;
    return new Promise((r) => (release = r));
  });
  h.poller.start();
  await h.poller.pullNow();
  await h.poller.pullNow();
  assert.equal(calls, 1, "a second read is refused while one is in flight");
  assert.equal(h.timers.size, 0, "nothing scheduled during a read");
  release([]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.log, ["delivery:0"]);
  assert.equal(h.timers.size, 1, "next read scheduled after settle");
  await h.fire();
  assert.equal(calls, 2);
});

test("hidden or offline schedules nothing; returning reads once as a gap", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls += 1;
    return [];
  });
  h.poller.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  h.poller.setHidden(true);
  assert.equal(h.timers.size, 0, "no background polling while hidden");
  assert.ok(h.log.includes("gap"));
  await h.fire();
  assert.equal(calls, 1);
  h.poller.setHidden(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2, "one read on return");
  h.poller.setOnline(false);
  assert.equal(h.timers.size, 0);
  h.poller.setOnline(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3);
});

test("a read that lands after stop is dropped; failures are reported, not thrown", async () => {
  let release!: (rows: ChamberStatement[]) => void;
  const h = harness(() => new Promise((r) => (release = r)));
  h.poller.start();
  h.poller.stop();
  release([SYNTHETIC.book()]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.log, []);
  assert.equal(h.timers.size, 0);

  const g = harness(async () => {
    throw new Error("503");
  });
  g.poller.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(g.log, ["failure:503"]);
  assert.equal(g.timers.size, 1, "retries on the normal cadence");
  assert.equal(FEED_INTERVAL_MS, 12_000);
});

test("the roster snapshot is allowlisted current state and refuses demo or malformed frames", () => {
  const frame = {
    as_of: AFTER,
    snap: { ticker: windowTicker(BASE_CLOSE), close_time: BASE_CLOSE, spot: 1, secret: "x" },
    chair: { lean: "UP", rows: [{ seat: "STRIKE", selectable_live_cards: 1, authority_ready_cards: 1, authority_hold_reason: "", weight: 0.4, reasoning: "private" }, { nope: 1 }] },
    learner: { knobs: {} },
    settings: { source: "live" },
  };
  const s = parseRosterSnapshot(frame)!;
  assert.deepEqual(s, { as_of: AFTER, ticker: windowTicker(BASE_CLOSE), close_time: BASE_CLOSE, rows: [{ seat: "STRIKE", selectable_live_cards: 1, authority_ready_cards: 1, authority_hold_reason: "" }] });
  assert.equal(parseRosterSnapshot({ ...frame, snap: { ticker: "KXBTC15M-DEMO", close_time: 1 } }), null);
  assert.equal(parseRosterSnapshot({ ok: false, error: "x" }), null);
  assert.equal(parseRosterSnapshot({ ...frame, as_of: undefined }), null);
  assert.equal(parseRosterSnapshot(null), null);
});

test("a snapshot never becomes a recorded event", () => {
  const f = applyDelivery(initialFeed([], AFTER), [], AFTER);
  parseRosterSnapshot({ as_of: AFTER, snap: { ticker: windowTicker(BASE_CLOSE), close_time: BASE_CLOSE }, chair: { rows: [{ seat: "STRIKE", selectable_live_cards: 1, authority_ready_cards: 0 }] } });
  assert.equal(f.events.length, 0);
  assert.equal(feedPhase(f, AFTER, env), "empty");
});
