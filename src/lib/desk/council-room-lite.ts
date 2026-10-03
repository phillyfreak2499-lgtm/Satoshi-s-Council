/**
 * Council Room V1 — Phase 2 lightweight room model.
 *
 * Pure. Builds what the 2D room shows from two separate inputs:
 * - the current allowlisted snapshot (state at one instant, labelled as such);
 * - the Phase 1 recorded-event feed (the only source of flashes).
 *
 * The model takes only the CURRENT snapshot. It keeps no previous snapshot, so a
 * snapshot change cannot be turned into an event, a narration line or a flash.
 * Missing data stays "unknown"; it is never shown as WAIT or quiet. A paper
 * position is shown only from a recorded book-layer event, never inferred.
 */
import { COUNCIL_PIT_CREW, COUNCIL_RETIRED, seatAvailabilityLabel } from "./council-public.ts";
import { DISCONNECTED_AFTER_FAILURES, STALE_AFTER_MS, type FeedEvent, type FeedState } from "./council-room-feed.ts";
import type { RosterSnapshot, SnapshotLean } from "./council-room-snapshot.ts";
import { SEAT_IDS } from "./types.ts";

export type SnapshotState = {
  value: RosterSnapshot | null;
  last_success_ms: number | null;
  last_attempt_ms: number | null;
  failures: number;
};

export type SnapshotPhase = "loading" | "current" | "stale" | "unavailable" | "disconnected" | "paused";

export const SNAPSHOT_PHASE_LABEL: Record<SnapshotPhase, string> = {
  loading: "Current state: reading the desk snapshot",
  current: "Current state: snapshot is current",
  stale: "Current state: snapshot is stale · values shown as last read",
  unavailable: "Current state: snapshot unavailable · seat and Chair state unknown",
  disconnected: "Current state: disconnected · seat and Chair state unknown",
  paused: "Current state: paused while this tab is hidden",
};

export function emptySnapshotState(): SnapshotState {
  return { value: null, last_success_ms: null, last_attempt_ms: null, failures: 0 };
}

/** A read that returned a usable, allowlisted, non-demo frame. */
export function applySnapshot(state: SnapshotState, value: RosterSnapshot, atMs: number): SnapshotState {
  return { value, last_success_ms: atMs, last_attempt_ms: atMs, failures: 0 };
}

/** A read that failed or returned a refused frame. The last good value is kept, marked by its read time. */
export function applySnapshotFailure(state: SnapshotState, atMs: number): SnapshotState {
  return { ...state, last_attempt_ms: atMs, failures: state.failures + 1 };
}

export function snapshotPhase(state: SnapshotState, nowMs: number | null, env: { hidden: boolean; online: boolean }): SnapshotPhase {
  if (env.hidden) return "paused";
  if (!env.online || state.failures >= DISCONNECTED_AFTER_FAILURES) return "disconnected";
  if (state.last_success_ms == null || state.value == null) return state.last_attempt_ms == null ? "loading" : "unavailable";
  if (state.failures > 0) return "stale";
  if (nowMs != null && nowMs - state.last_success_ms > STALE_AFTER_MS) return "stale";
  return "current";
}

export type SeatRead = SnapshotLean | "unknown";
export type SeatRole = "voting" | "retired" | "pit";

export type RoomSeat = {
  seat: string;
  role: SeatRole;
  /** Current-state read; "unknown" unless the snapshot is current or stale and carries a value. */
  read: SeatRead;
  /** Retired and pit-crew seats never draw a vote mark. */
  showsVote: boolean;
  availability: string;
  flash: boolean;
};

export type RoomTile = {
  /** Newest recorded event for this tile, or null. */
  recorded: FeedEvent | null;
  flash: boolean;
};

export type RoomModel = {
  snapshot: SnapshotPhase;
  /** Read time of the snapshot value in use; null when none is shown. */
  snapshotReadMs: number | null;
  tickAgeS: number | null;
  window: { ticker: string; close_time: number | null } | null;
  chair: RoomTile & { current: SeatRead };
  book: RoomTile;
  integrity: RoomTile;
  lab: RoomTile;
  seats: RoomSeat[];
};

const RETIRED = new Set<string>(COUNCIL_RETIRED);
const PIT = new Set<string>(COUNCIL_PIT_CREW);

function newest(feed: FeedState, layer: FeedEvent["layer"]): FeedEvent | null {
  return feed.events.find((e) => e.layer === layer) ?? null;
}

function flashes(feed: FeedState, layer: FeedEvent["layer"]): boolean {
  return feed.events.some((e) => e.layer === layer && e.arrival === "fresh");
}

/** Only a fresh recorded event can light a flash. Snapshot data is never consulted here. */
function freshSeats(feed: FeedState): Set<string> {
  const out = new Set<string>();
  for (const e of feed.events) {
    if (e.arrival === "fresh" && e.layer === "conditions" && e.seat) out.add(e.seat.toUpperCase());
  }
  return out;
}

export function buildRoomModel(snap: SnapshotState, feed: FeedState, nowMs: number | null, env: { hidden: boolean; online: boolean }): RoomModel {
  const phase = snapshotPhase(snap, nowMs, env);
  const usable = (phase === "current" || phase === "stale") && snap.value ? snap.value : null;
  const bySeat = new Map((usable?.rows ?? []).map((r) => [String(r.seat).toUpperCase(), r]));
  const flashSeat = freshSeats(feed);

  const seats: RoomSeat[] = SEAT_IDS.map((id) => {
    const seat = String(id);
    const role: SeatRole = RETIRED.has(seat) ? "retired" : PIT.has(seat) ? "pit" : "voting";
    const row = bySeat.get(seat.toUpperCase());
    const read: SeatRead = usable && row?.lean ? row.lean : "unknown";
    return {
      seat,
      role,
      read: role === "voting" ? read : "unknown",
      showsVote: role === "voting",
      availability: usable ? seatAvailabilityLabel(row ?? { seat }) : "Availability unknown",
      flash: flashSeat.has(seat.toUpperCase()),
    };
  });

  return {
    snapshot: phase,
    snapshotReadMs: usable ? snap.last_success_ms : null,
    tickAgeS: usable ? usable.tick_age_s : null,
    window: usable ? { ticker: usable.ticker, close_time: usable.close_time } : null,
    chair: { current: usable?.chair_lean ?? "unknown", recorded: newest(feed, "chair"), flash: flashes(feed, "chair") },
    book: { recorded: newest(feed, "book"), flash: flashes(feed, "book") },
    integrity: { recorded: newest(feed, "integrity"), flash: flashes(feed, "integrity") },
    lab: { recorded: newest(feed, "research"), flash: flashes(feed, "research") },
    seats,
  };
}
