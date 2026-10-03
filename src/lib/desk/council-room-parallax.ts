/**
 * Council Room V1 — 2.5D room model (CR-CLAUDE-004). Pure; contract in
 * docs/COUNCIL_ROOM_V1.md §10.
 *
 * Builds what each cast member's panel shows from the two existing inputs and
 * nothing else:
 * - recorded activity: retained Phase 1 feed events attributed to that member;
 * - current snapshot: the Phase 2 room model's current-state field, if any.
 *
 * The two are never merged. A member with no recorded event shows none; a
 * member with no current-state field says so. Seat members (WICK, DRIFT,
 * INDEX, TAPE) never speak in the event log: their activity is SWEEP's
 * recorded seat audits that name them, and is labelled as such.
 */
import type { FeedEvent } from "./council-room-feed.ts";
import type { RoomModel, SeatRead, SnapshotPhase } from "./council-room-lite.ts";

export type CastId = "SATOSHI" | "WARDEN" | "ALCHEMIST" | "WICK" | "DRIFT" | "INDEX" | "TAPE";

export type CastMember = {
  id: CastId;
  role: string;
  /** How recorded events are attributed to this member. */
  source: "speaker" | "seat-audit";
  /** Depth plane: 0 = back wall, 1 = stations, 2 = foreground. Drives parallax only. */
  depth: 0 | 1 | 2;
  /** Station anchor as a percentage of the stage, for the scaffold layout. */
  x: number;
  y: number;
};

/** The seven voiced cast members, in reading and tab order. */
export const CAST: readonly CastMember[] = [
  { id: "SATOSHI", role: "Chair", source: "speaker", depth: 1, x: 50, y: 34 },
  { id: "WARDEN", role: "Feed integrity", source: "speaker", depth: 1, x: 18, y: 46 },
  { id: "ALCHEMIST", role: "Lab", source: "speaker", depth: 1, x: 82, y: 46 },
  { id: "WICK", role: "Seat", source: "seat-audit", depth: 2, x: 24, y: 74 },
  { id: "DRIFT", role: "Seat", source: "seat-audit", depth: 2, x: 41, y: 78 },
  { id: "INDEX", role: "Seat", source: "seat-audit", depth: 2, x: 59, y: 78 },
  { id: "TAPE", role: "Seat", source: "seat-audit", depth: 2, x: 76, y: 74 },
];

export const MAX_MEMBER_EVENTS = 5;

export type MemberSnapshot =
  | { kind: "chair"; read: SeatRead; phase: SnapshotPhase; readMs: number | null }
  | { kind: "seat"; read: SeatRead; showsVote: boolean; availability: string; phase: SnapshotPhase; readMs: number | null }
  | { kind: "none"; reason: string };

export type MemberPanel = {
  member: CastMember;
  /** Newest first, at most MAX_MEMBER_EVENTS, straight from the retained feed. */
  recorded: FeedEvent[];
  /** Who the recorded events are spoken by, when it is not the member. */
  recordedBy: "SWEEP" | null;
  snapshot: MemberSnapshot;
  /** Only a fresh recorded event attributed to this member lights it. */
  flash: boolean;
};

function attributed(member: CastMember, e: FeedEvent): boolean {
  if (member.source === "speaker") return e.speaker === member.id;
  return e.speaker === "SWEEP" && e.layer === "conditions" && (e.seat ?? "").toUpperCase() === member.id;
}

export function memberEvents(feed: { events: readonly FeedEvent[] }, member: CastMember): FeedEvent[] {
  return feed.events.filter((e) => attributed(member, e)).slice(0, MAX_MEMBER_EVENTS);
}

export function memberFlash(feed: { events: readonly FeedEvent[] }, member: CastMember): boolean {
  return feed.events.some((e) => e.arrival === "fresh" && attributed(member, e));
}

export function memberSnapshot(room: RoomModel, member: CastMember): MemberSnapshot {
  if (member.id === "SATOSHI") return { kind: "chair", read: room.chair.current, phase: room.snapshot, readMs: room.snapshotReadMs };
  if (member.id === "ALCHEMIST") return { kind: "none", reason: "The Lab has no current-state field in the desk snapshot." };
  const seat = room.seats.find((s) => s.seat.toUpperCase() === member.id);
  if (!seat) return { kind: "none", reason: "This seat is not in the current roster." };
  return { kind: "seat", read: seat.read, showsVote: seat.showsVote, availability: seat.availability, phase: room.snapshot, readMs: room.snapshotReadMs };
}

export function memberPanel(feed: { events: readonly FeedEvent[] }, room: RoomModel, member: CastMember): MemberPanel {
  return {
    member,
    recorded: memberEvents(feed, member),
    recordedBy: member.source === "seat-audit" ? "SWEEP" : null,
    snapshot: memberSnapshot(room, member),
    flash: memberFlash(feed, member),
  };
}

/* ---------------------------- interaction ---------------------------- */

/** Pointer travel (px) beyond which a press is a drag, never a click. */
export const DRAG_THRESHOLD_PX = 6;
/** Bounded drag: the stage may be offset at most this far (px) on each axis. */
export const DRAG_LIMIT = { x: 48, y: 20 } as const;
/** Parallax factor per depth plane (back moves least). */
export const DEPTH_FACTOR: Record<CastMember["depth"], number> = { 0: 0.25, 1: 0.6, 2: 1 };

export type Offset = { x: number; y: number };

export function clampOffset(o: Offset, limit: Offset = DRAG_LIMIT): Offset {
  const c = (v: number, m: number) => (Number.isFinite(v) ? Math.max(-m, Math.min(m, v)) : 0);
  return { x: c(o.x, limit.x), y: c(o.y, limit.y) };
}

export function layerOffset(o: Offset, depth: CastMember["depth"]): Offset {
  const f = DEPTH_FACTOR[depth];
  return { x: o.x * f, y: o.y * f };
}

/** A press that travelled past the threshold is a drag and must not open a panel. */
export function classifyPress(down: Offset, up: Offset, threshold = DRAG_THRESHOLD_PX): "click" | "drag" {
  return Math.hypot(up.x - down.x, up.y - down.y) > threshold ? "drag" : "click";
}

export type MotionEnv = { reducedMotion: boolean; motionPaused: boolean; narrow: boolean };
export type MotionMode = "live" | "static";

/**
 * Drift and drag run only on wide screens with motion allowed and not paused by
 * the viewer. This is independent of the live-update pause (§9.7): pausing motion
 * never pauses data, and pausing data never starts or stops motion.
 */
export function motionMode(env: MotionEnv): MotionMode {
  return env.reducedMotion || env.motionPaused || env.narrow ? "static" : "live";
}

/** Keyboard nudge for the stage, so drag has a non-pointer equivalent. */
export function nudge(o: Offset, key: string, step = 8): Offset | null {
  const d: Record<string, Offset> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
  const v = d[key];
  return v ? clampOffset({ x: o.x + v.x, y: o.y + v.y }) : key === "Home" ? { x: 0, y: 0 } : null;
}
