/**
 * Council Room V1 — CR-CLAUDE-004 2.5D room model tests against the actual
 * modules. FIXTURES ARE SYNTHETIC: see council-room.fixtures.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelivery, applyFailure, initialFeed, markGap, type FeedState } from "./council-room-feed.ts";
import { applySnapshot, applySnapshotFailure, buildRoomModel, emptySnapshotState } from "./council-room-lite.ts";
import { parseRosterSnapshot } from "./council-room-snapshot.ts";
import {
  CAST,
  DRAG_LIMIT,
  DRAG_THRESHOLD_PX,
  MAX_MEMBER_EVENTS,
  classifyPress,
  clampOffset,
  layerOffset,
  memberPanel,
  motionMode,
  nudge,
} from "./council-room-parallax.ts";
import { CLOSE, RECEIVED, SYNTHETIC, TICKER, bookCallAt } from "./council-room.fixtures.ts";
import { SEAT_IDS } from "./types.ts";

const T = RECEIVED;
const env = { hidden: false, online: true };
const member = (id: string) => CAST.find((m) => m.id === id)!;

function liveSnap() {
  const s = parseRosterSnapshot({
    as_of: T,
    tick_age_s: 1,
    snap: { ticker: TICKER, close_time: CLOSE },
    chair: { lean: "UP", rows: SEAT_IDS.map((seat) => ({ seat, lean: seat === "WICK" ? "DOWN" : "WAIT", selectable_live_cards: 1, authority_ready_cards: 1 })) },
  });
  assert.ok(s);
  return applySnapshot(emptySnapshotState(), s, T);
}

function freshFeed(...rows: ReturnType<typeof SYNTHETIC.book>[]): FeedState {
  return applyDelivery(applyDelivery(initialFeed([], T), [], T), rows, T + 12_000);
}

test("the seven cast members are the voiced cast, each with one attribution rule", () => {
  assert.deepEqual(CAST.map((m) => m.id), ["SATOSHI", "WARDEN", "ALCHEMIST", "WICK", "DRIFT", "INDEX", "TAPE"]);
  for (const m of CAST.filter((m) => m.source === "seat-audit")) assert.ok(SEAT_IDS.includes(m.id as never), m.id);
});

test("recorded activity comes only from that member's retained events; seats are SWEEP audits naming them", () => {
  const feed = initialFeed([SYNTHETIC.book(), SYNTHETIC.wait(), SYNTHETIC.alert(), ...SYNTHETIC.lab(), SYNTHETIC.sweep()], T);
  const room = buildRoomModel(liveSnap(), feed, T, env);
  const satoshi = memberPanel(feed, room, member("SATOSHI"));
  assert.ok(satoshi.recorded.length >= 2 && satoshi.recorded.every((e) => e.speaker === "SATOSHI"));
  assert.ok(memberPanel(feed, room, member("WARDEN")).recorded.every((e) => e.speaker === "WARDEN"));
  assert.ok(memberPanel(feed, room, member("ALCHEMIST")).recorded.every((e) => e.speaker === "ALCHEMIST"));
  const drift = memberPanel(feed, room, member("DRIFT"));
  assert.equal(drift.recorded.length, 1);
  assert.equal(drift.recorded[0].speaker, "SWEEP", "a seat's activity is spoken by SWEEP, never by the seat");
  assert.equal(drift.recordedBy, "SWEEP");
  assert.equal(memberPanel(feed, room, member("WICK")).recorded.length, 0, "no event names WICK, so none is shown");
  assert.equal(satoshi.recordedBy, null);
});

test("recorded activity is capped and newest first", () => {
  const Q = 900_000;
  const ticker = (closeMs: number) => {
    const et = new Date(closeMs - 4 * 3_600_000); // EDT in October
    const hh = String(et.getUTCHours()).padStart(2, "0");
    const mm = String(et.getUTCMinutes()).padStart(2, "0");
    return `KXBTC15M-26OCT${String(et.getUTCDate()).padStart(2, "0")}${hh}${mm}-${mm}`;
  };
  const rows = Array.from({ length: 9 }, (_, i) => bookCallAt(CLOSE + i * Q, ticker(CLOSE + i * Q)));
  const feed = initialFeed(rows, CLOSE + 9 * Q);
  assert.equal(feed.events.length, 9, "all nine synthetic calls validate");
  const p = memberPanel(feed, buildRoomModel(liveSnap(), feed, T, env), member("SATOSHI"));
  assert.equal(p.recorded.length, MAX_MEMBER_EVENTS);
  const ms = p.recorded.map((e) => e.recorded_ms);
  assert.deepEqual([...ms].sort((a, b) => b - a), ms);
});

test("current snapshot is a separate field and is never filled from recorded events", () => {
  const feed = freshFeed(SYNTHETIC.book());
  const room = buildRoomModel(liveSnap(), feed, T + 12_000, env);
  const s = memberPanel(feed, room, member("SATOSHI")).snapshot;
  assert.equal(s.kind, "chair");
  assert.equal(s.kind === "chair" && s.read, "UP", "Chair current state from the snapshot");
  const w = memberPanel(feed, room, member("WICK")).snapshot;
  assert.equal(w.kind === "seat" && w.read, "DOWN");
  assert.equal(memberPanel(feed, room, member("ALCHEMIST")).snapshot.kind, "none", "the Lab has no current-state field; said, not invented");
  const warden = memberPanel(feed, room, member("WARDEN")).snapshot;
  assert.equal(warden.kind === "seat" && warden.showsVote, false, "pit crew never shows a vote");
  const noSnap = buildRoomModel(emptySnapshotState(), feed, T + 12_000, env);
  const empty = memberPanel(feed, noSnap, member("SATOSHI"));
  assert.equal(empty.snapshot.kind === "chair" && empty.snapshot.read, "unknown", "a recorded call does not fill current state");
  assert.equal(empty.recorded.length, 1);
});

test("unknown, stale, disconnected and paused states pass straight through to every panel", () => {
  const feed = initialFeed([], T);
  const failed = applySnapshotFailure(liveSnap(), T + 12_000);
  const cases = [
    [buildRoomModel(failed, feed, T + 12_000, env), "stale"],
    [buildRoomModel(liveSnap(), feed, T, { hidden: false, online: false }), "disconnected"],
    [buildRoomModel(liveSnap(), feed, T, { ...env, userPaused: true }), "user_paused"],
    [buildRoomModel(applySnapshotFailure(emptySnapshotState(), T), feed, T, env), "unavailable"],
  ] as const;
  for (const [room, phase] of cases) {
    for (const m of CAST) {
      const s = memberPanel(feed, room, m).snapshot;
      if (s.kind !== "none") assert.equal(s.phase, phase, `${m.id} ${phase}`);
    }
  }
  const off = buildRoomModel(liveSnap(), feed, T, { hidden: false, online: false });
  const wick = memberPanel(feed, off, member("WICK")).snapshot;
  assert.equal(wick.kind === "seat" && wick.read, "unknown", "disconnected shows unknown, never the old value");
});

test("only a fresh recorded event lights a member; history, replay after a gap or failure, and duplicates never do", () => {
  const fresh = freshFeed(SYNTHETIC.alert(), SYNTHETIC.sweep());
  const room = buildRoomModel(liveSnap(), fresh, T + 12_000, env);
  const lit = CAST.filter((m) => memberPanel(fresh, room, m).flash).map((m) => m.id);
  assert.deepEqual(lit, ["WARDEN", "DRIFT"]);
  const history = initialFeed([SYNTHETIC.alert(), SYNTHETIC.sweep()], T);
  const gap = applyDelivery(markGap(applyDelivery(initialFeed([], T), [], T)), [SYNTHETIC.alert()], T + 60_000);
  const afterFail = applyDelivery(applyFailure(applyDelivery(initialFeed([], T), [], T), "x", T + 12_000), [SYNTHETIC.alert()], T + 24_000);
  const dup = applyDelivery(fresh, [SYNTHETIC.alert(), SYNTHETIC.sweep()], T + 24_000);
  for (const [name, feed] of Object.entries({ history, gap, afterFail, dup })) {
    const r = buildRoomModel(liveSnap(), feed, T + 30_000, env);
    assert.ok(CAST.every((m) => !memberPanel(feed, r, m).flash), `${name} must not light anyone`);
  }
  assert.equal(dup.events.filter((e) => e.speaker === "WARDEN").length, 1, "deduped");
});

test("a snapshot change alone never lights a member or adds recorded activity", () => {
  const feed = initialFeed([], T);
  const a = buildRoomModel(liveSnap(), feed, T, env);
  const b = buildRoomModel(applySnapshot(liveSnap(), liveSnap().value!, T + 12_000), feed, T + 12_000, env);
  for (const room of [a, b]) for (const m of CAST) {
    const p = memberPanel(feed, room, m);
    assert.equal(p.flash, false);
    assert.equal(p.recorded.length, 0);
  }
});

test("click versus drag: travel past the threshold is a drag and never opens a panel", () => {
  assert.equal(classifyPress({ x: 10, y: 10 }, { x: 10, y: 10 }), "click");
  assert.equal(classifyPress({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD_PX, y: 10 }), "click");
  assert.equal(classifyPress({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD_PX + 1, y: 10 }), "drag");
  assert.equal(classifyPress({ x: 0, y: 0 }, { x: 5, y: 5 }), "drag", "diagonal distance counts");
});

test("drag is bounded, depth-scaled, and has a keyboard equivalent", () => {
  assert.deepEqual(clampOffset({ x: 999, y: -999 }), { x: DRAG_LIMIT.x, y: -DRAG_LIMIT.y });
  assert.deepEqual(clampOffset({ x: Number.NaN, y: Infinity }), { x: 0, y: 0 });
  assert.deepEqual(layerOffset({ x: 40, y: 20 }, 0), { x: 10, y: 5 });
  assert.deepEqual(layerOffset({ x: 40, y: 20 }, 2), { x: 40, y: 20 });
  assert.deepEqual(nudge({ x: 0, y: 0 }, "ArrowRight"), { x: 8, y: 0 });
  assert.deepEqual(nudge({ x: DRAG_LIMIT.x, y: 0 }, "ArrowRight"), { x: DRAG_LIMIT.x, y: 0 });
  assert.deepEqual(nudge({ x: 30, y: 10 }, "Home"), { x: 0, y: 0 });
  assert.equal(nudge({ x: 0, y: 0 }, "Enter"), null);
});

test("motion is live only on wide screens with motion allowed and not paused; it is independent of the data pause", () => {
  assert.equal(motionMode({ reducedMotion: false, motionPaused: false, narrow: false }), "live");
  assert.equal(motionMode({ reducedMotion: true, motionPaused: false, narrow: false }), "static");
  assert.equal(motionMode({ reducedMotion: false, motionPaused: true, narrow: false }), "static");
  assert.equal(motionMode({ reducedMotion: false, motionPaused: false, narrow: true }), "static", "phones get the static layout");
  assert.equal(motionMode.length, 1, "takes no data or feed state");
});
