/**
 * Council Room V1 — Phase 2 room model tests against the actual modules.
 * FIXTURES ARE SYNTHETIC: see council-room.fixtures.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelivery, applyFailure, initialFeed, markGap, STALE_AFTER_MS, type FeedState } from "./council-room-feed.ts";
import { parseRosterSnapshot, type RosterSnapshot } from "./council-room-snapshot.ts";
import {
  applySnapshot,
  applySnapshotFailure,
  buildRoomModel,
  emptySnapshotState,
  snapshotPhase,
  type SnapshotState,
} from "./council-room-lite.ts";
import { CLOSE, RECEIVED, SYNTHETIC, TICKER } from "./council-room.fixtures.ts";
import { SEAT_IDS } from "./types.ts";

const T = RECEIVED;
const env = { hidden: false, online: true };

function frame(over: { chairLean?: unknown; leans?: Record<string, unknown> } = {}): RosterSnapshot {
  const leans = over.leans ?? { STRIKE: "UP", CHAIN: "DOWN", DRIFT: "WAIT" };
  const s = parseRosterSnapshot({
    as_of: T,
    tick_age_s: 1.2,
    snap: { ticker: TICKER, close_time: CLOSE },
    chair: {
      lean: "chairLean" in over ? over.chairLean : "WAIT",
      rows: SEAT_IDS.map((seat) => ({ seat, lean: leans[seat] ?? "bogus", selectable_live_cards: 1, authority_ready_cards: 1 })),
    },
  });
  assert.ok(s);
  return s;
}

function live(snap: RosterSnapshot = frame()): SnapshotState {
  return applySnapshot(emptySnapshotState(), snap, T);
}

/** A continuous feed that has delivered `rows` on a follow-up read, so new rows are fresh. */
function freshFeed(...rows: ReturnType<typeof SYNTHETIC.book>[]): FeedState {
  const base = applyDelivery(initialFeed([], T), [], T);
  return applyDelivery(base, rows, T + 12_000);
}

test("snapshot phases are explicit and never read as WAIT or quiet", () => {
  const empty = emptySnapshotState();
  assert.equal(snapshotPhase(empty, T, env), "loading");
  assert.equal(snapshotPhase(applySnapshotFailure(empty, T), T, env), "unavailable");
  const ok = live();
  assert.equal(snapshotPhase(ok, T + 1_000, env), "current");
  assert.equal(snapshotPhase(ok, T + STALE_AFTER_MS + 1, env), "stale");
  assert.equal(snapshotPhase(applySnapshotFailure(ok, T + 12_000), T + 12_000, env), "stale");
  let down = ok;
  for (let i = 0; i < 3; i++) down = applySnapshotFailure(down, T + i);
  assert.equal(snapshotPhase(down, T, env), "disconnected");
  assert.equal(snapshotPhase(ok, T, { hidden: false, online: false }), "disconnected");
  assert.equal(snapshotPhase(ok, T, { hidden: true, online: true }), "paused");
});

test("seat lights come only from a usable current snapshot; otherwise unknown, never WAIT", () => {
  const feed = initialFeed([], T);
  const m = buildRoomModel(live(), feed, T + 1_000, env);
  const read = (seat: string) => m.seats.find((s) => s.seat === seat)!;
  assert.equal(m.seats.length, 21);
  assert.equal(read("STRIKE").read, "UP");
  assert.equal(read("CHAIN").read, "DOWN");
  assert.equal(read("DRIFT").read, "WAIT");
  assert.equal(read("WICK").read, "unknown", "a junk lean value is unknown, not WAIT");
  for (const phase of [emptySnapshotState(), applySnapshotFailure(emptySnapshotState(), T)]) {
    const none = buildRoomModel(phase, feed, T, env);
    assert.ok(none.seats.every((s) => s.read === "unknown"));
    assert.equal(none.chair.current, "unknown");
    assert.equal(none.snapshotReadMs, null);
  }
  const offline = buildRoomModel(live(), feed, T, { hidden: false, online: false });
  assert.ok(offline.seats.every((s) => s.read === "unknown"), "disconnected shows unknown, not the old values");
});

test("retired and pit-crew seats never draw a vote mark", () => {
  const m = buildRoomModel(live(frame({ leans: { ODDS: "UP", WARDEN: "DOWN", ORBIT: "UP" } })), initialFeed([], T), T, env);
  for (const seat of ["ODDS", "CHEAP", "FADE"]) {
    const s = m.seats.find((x) => x.seat === seat)!;
    assert.equal(s.role, "retired");
    assert.equal(s.showsVote, false);
    assert.equal(s.read, "unknown");
  }
  for (const seat of ["WARDEN", "ORBIT", "WIRE"]) assert.equal(m.seats.find((x) => x.seat === seat)!.showsVote, false);
});

test("Chair current state and last recorded Chair event stay separate", () => {
  const snapOnly = buildRoomModel(live(frame({ chairLean: "UP" })), initialFeed([], T), T, env);
  assert.equal(snapOnly.chair.current, "UP");
  assert.equal(snapOnly.chair.recorded, null, "a snapshot lean is not a recorded event");
  const eventOnly = buildRoomModel(emptySnapshotState(), freshFeed(SYNTHETIC.wait()), T + 12_000, env);
  assert.equal(eventOnly.chair.current, "unknown", "a recorded event does not fill in current state");
  assert.equal(eventOnly.chair.recorded?.layer, "chair");
  assert.equal(buildRoomModel(live(frame({ chairLean: "sideways" })), initialFeed([], T), T, env).chair.current, "unknown");
});

test("a paper position comes only from a recorded book event, never from leans", () => {
  const leansOnly = buildRoomModel(live(frame({ chairLean: "UP", leans: { STRIKE: "UP", CHAIN: "UP" } })), freshFeed(SYNTHETIC.wait()), T + 12_000, env);
  assert.equal(leansOnly.book.recorded, null);
  const booked = buildRoomModel(emptySnapshotState(), freshFeed(SYNTHETIC.book()), T + 12_000, env);
  assert.equal(booked.book.recorded?.layer, "book");
  assert.equal(booked.book.recorded?.fields.call_id, SYNTHETIC.book().evidence.call_id);
});

test("only fresh recorded events flash, and each lights only its own target", () => {
  const m = buildRoomModel(live(), freshFeed(SYNTHETIC.book(), SYNTHETIC.alert(), SYNTHETIC.sweep()), T + 12_000, env);
  assert.equal(m.book.flash, true);
  assert.equal(m.integrity.flash, true);
  assert.equal(m.chair.flash, false);
  assert.equal(m.lab.flash, false);
  assert.deepEqual(m.seats.filter((s) => s.flash).map((s) => s.seat), ["DRIFT"], "conditions event lights its named seat only");
});

test("history, replay after a gap, late rows and duplicates never flash", () => {
  const history = initialFeed([SYNTHETIC.book(), SYNTHETIC.alert()], T);
  const firstRead = applyDelivery(initialFeed([], T), [SYNTHETIC.book()], T);
  const gap = applyDelivery(markGap(applyDelivery(initialFeed([], T), [], T)), [SYNTHETIC.book()], T + 60_000);
  const afterFailure = applyDelivery(applyFailure(applyDelivery(initialFeed([], T), [], T), "x", T + 12_000), [SYNTHETIC.book()], T + 24_000);
  const fresh = freshFeed(SYNTHETIC.book());
  const duplicate = applyDelivery(fresh, [SYNTHETIC.book()], T + 24_000);
  const lab = SYNTHETIC.lab();
  const late = applyDelivery(applyDelivery(applyDelivery(initialFeed([], T), [], T), [SYNTHETIC.book()], T + 12_000), [{ ...lab[0], occurred_at: new Date(Date.parse(lab[0].occurred_at) - 60_000).toISOString() }], T + 24_000);
  assert.ok(late.events.some((e) => e.arrival === "late"), "the late scenario really contains a late row");
  assert.ok(gap.events.every((e) => e.arrival === "history"));
  assert.ok(afterFailure.events.every((e) => e.arrival === "history"));
  assert.equal(duplicate.events.filter((e) => e.event_id === SYNTHETIC.book().event_key).length, 1);
  for (const [name, feed] of Object.entries({ history, firstRead, gap, afterFailure, duplicate, late })) {
    const m = buildRoomModel(live(), feed, T + 30_000, env);
    const any = m.chair.flash || m.book.flash || m.integrity.flash || m.lab.flash || m.seats.some((s) => s.flash);
    assert.equal(any, false, `${name} must not flash`);
  }
});

test("a snapshot change alone never creates a flash, a recorded line or an event", () => {
  const feed = initialFeed([], T);
  const a = buildRoomModel(live(frame({ chairLean: "WAIT", leans: { STRIKE: "WAIT" } })), feed, T, env);
  const b = buildRoomModel(live(frame({ chairLean: "UP", leans: { STRIKE: "UP", CHAIN: "UP", DRIFT: "DOWN" } })), feed, T, env);
  for (const m of [a, b]) {
    assert.equal(m.chair.flash || m.book.flash || m.integrity.flash || m.lab.flash || m.seats.some((s) => s.flash), false);
    assert.equal(m.chair.recorded, null);
    assert.equal(m.book.recorded, null);
  }
  assert.notEqual(a.chair.current, b.chair.current, "state does change");
  assert.equal(feed.events.length, 0, "the feed is untouched");
  assert.equal(buildRoomModel.length, 4, "the model takes only the current snapshot, not a previous one");
});

test("the snapshot allowlist carries leans only as known values", () => {
  const s = parseRosterSnapshot({ as_of: T, snap: { ticker: TICKER, close_time: CLOSE }, chair: { lean: "UP", rows: [{ seat: "STRIKE", lean: "UP", why: "private", weight: 1 }, { seat: "CHAIN", lean: 7 }] } })!;
  assert.equal(s.chair_lean, "UP");
  assert.equal(s.tick_age_s, null);
  assert.equal(s.rows[0].lean, "UP");
  assert.equal("lean" in s.rows[1], false);
  assert.equal("why" in s.rows[0] || "weight" in s.rows[0], false);
});
