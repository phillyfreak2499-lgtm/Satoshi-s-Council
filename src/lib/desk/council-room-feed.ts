/**
 * Council Room V1 — Phase 1 feed state.
 *
 * Pure. Merges deliveries of recorded Chamber statements into one bounded,
 * deduplicated, deterministically ordered list and tracks read health. It never
 * fabricates activity: a read that returns nothing new changes no event, a
 * failed read keeps the last delivery visible as history, and a heartbeat or
 * successful empty read is never shown as desk work.
 *
 * Replay rule: rows first seen in the server page, the first client read, or the
 * first read after a gap (hidden tab, offline, failed read) are HISTORY and do
 * not flash. Only a row first seen on an ordinary follow-up read, recorded no
 * earlier than anything already seen, is marked fresh.
 */
import type { ChamberStatement } from "./chamber-reactions.ts";
import { adaptStatement, type NarrationEvent, type Refusal } from "./council-room-narration.ts";

export const FEED_INTERVAL_MS = 12_000;
/** Visible-history bound. The source already caps at five rows per speaker. */
export const MAX_EVENTS = 60;
/** Remembered ids, so an id that scrolled out cannot return as "new". */
export const MAX_SEEN = 500;
export const STALE_AFTER_MS = 3 * FEED_INTERVAL_MS;
export const DISCONNECTED_AFTER_FAILURES = 3;

/** history: replayed on load or after a gap. fresh: just arrived on a continuous read. live: arrived that way earlier. late: arrived live but recorded before rows already seen. */
export type Arrival = "history" | "fresh" | "live" | "late";

export type FeedEvent = NarrationEvent & { arrival: Arrival };

export type FeedState = {
  events: FeedEvent[];
  seen: string[];
  refused: Refusal[];
  /** Newest recorded time seen so far, for late-arrival detection. */
  high_water_ms: number | null;
  /** True after the first successful client read with no gap since. */
  continuous: boolean;
  last_success_ms: number | null;
  last_attempt_ms: number | null;
  last_error: string | null;
  failures: number;
};

export type FeedPhase = "loading" | "connected" | "empty" | "stale" | "error" | "disconnected" | "paused";

/** Deterministic order: newest recorded first; ties by event id. */
export function compareEvents(a: { recorded_ms: number; event_id: string }, b: { recorded_ms: number; event_id: string }): number {
  if (a.recorded_ms !== b.recorded_ms) return b.recorded_ms - a.recorded_ms;
  return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}

function emptyState(): FeedState {
  return { events: [], seen: [], refused: [], high_water_ms: null, continuous: false, last_success_ms: null, last_attempt_ms: null, last_error: null, failures: 0 };
}

function absorb(state: FeedState, rows: readonly ChamberStatement[], receivedMs: number | null, live: boolean): FeedState {
  const seen = new Set(state.seen);
  const byId = new Map<string, FeedEvent>(state.events.map((e) => [e.event_id, { ...e, arrival: e.arrival === "fresh" ? "live" : e.arrival }]));
  const refused: Refusal[] = [];
  const added: string[] = [];
  let high = state.high_water_ms;
  const priorHigh = state.high_water_ms;

  for (const row of Array.isArray(rows) ? rows : []) {
    const r = adaptStatement(row, receivedMs);
    if (!r.ok) {
      refused.push(r.refusal);
      continue;
    }
    const ev = r.event;
    if (seen.has(ev.event_id) || byId.has(ev.event_id)) continue;
    const arrival: Arrival = !live ? "history" : priorHigh != null && ev.recorded_ms < priorHigh ? "late" : "fresh";
    byId.set(ev.event_id, { ...ev, arrival });
    seen.add(ev.event_id);
    added.push(ev.event_id);
    if (high == null || ev.recorded_ms > high) high = ev.recorded_ms;
  }

  const events = [...byId.values()].sort(compareEvents).slice(0, MAX_EVENTS);
  const seenList = [...state.seen, ...added].slice(-MAX_SEEN);
  return { ...state, events, seen: seenList, refused, high_water_ms: high };
}

/** Rows rendered with the server page: history, no client receipt time. */
export function initialFeed(rows: readonly ChamberStatement[]): FeedState {
  return absorb(emptyState(), rows, null, false);
}

/** A successful client read. */
export function applyDelivery(state: FeedState, rows: readonly ChamberStatement[], receivedMs: number): FeedState {
  const next = absorb(state, rows, receivedMs, state.continuous);
  return { ...next, continuous: true, last_success_ms: receivedMs, last_attempt_ms: receivedMs, last_error: null, failures: 0 };
}

/** A failed read. Prior rows stay visible as history; nothing is invented. */
export function applyFailure(state: FeedState, error: unknown, atMs: number): FeedState {
  const message = error instanceof Error ? error.message : String(error ?? "read failed");
  return {
    ...state,
    events: state.events.map((e) => (e.arrival === "fresh" ? { ...e, arrival: "live" as const } : e)),
    continuous: false,
    last_attempt_ms: atMs,
    last_error: message.slice(0, 160) || "read failed",
    failures: state.failures + 1,
  };
}

/** A gap the reader did not fail on (tab hidden, browser offline): the next rows are replay. */
export function markGap(state: FeedState): FeedState {
  return state.continuous ? { ...state, continuous: false } : state;
}

export function feedPhase(state: FeedState, nowMs: number | null, env: { hidden: boolean; online: boolean }): FeedPhase {
  if (env.hidden) return "paused";
  if (!env.online || state.failures >= DISCONNECTED_AFTER_FAILURES) return "disconnected";
  if (state.failures > 0) return "error";
  if (state.last_success_ms == null) return "loading";
  if (nowMs != null && nowMs - state.last_success_ms > STALE_AFTER_MS) return "stale";
  if (state.events.length === 0) return "empty";
  return "connected";
}

export const PHASE_LABEL: Record<FeedPhase, string> = {
  loading: "Reading recorded events",
  connected: "Connected to the recorded event log",
  empty: "Connected · no recorded public events",
  stale: "Stale · no successful read recently",
  error: "Last read failed · showing earlier rows as history",
  disconnected: "Disconnected · showing earlier rows as history",
  paused: "Paused while this tab is hidden",
};

export type Poller = {
  start(): void;
  stop(): void;
  setHidden(hidden: boolean): void;
  setOnline(online: boolean): void;
  /** Exposed for tests: run one read now if none is in flight. */
  pullNow(): Promise<void>;
};

export type PollerDeps = {
  read: () => Promise<ChamberStatement[]>;
  onDelivery: (rows: ChamberStatement[], receivedMs: number) => void;
  onFailure: (error: unknown, atMs: number) => void;
  onGap: () => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  intervalMs?: number;
};

/**
 * One read at a time. The next read is scheduled only after the previous one
 * settles, so requests never overlap and can never complete out of order. A
 * hidden tab or offline browser schedules nothing; returning triggers one read
 * whose rows are treated as replay. A result that lands after stop() is dropped.
 */
export function createPoller(deps: PollerDeps): Poller {
  const interval = deps.intervalMs ?? FEED_INTERVAL_MS;
  let running = false;
  let hidden = false;
  let online = true;
  let inFlight = false;
  let generation = 0;
  let timer: unknown = null;

  const clear = () => {
    if (timer != null) deps.clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (running && !hidden && online) timer = deps.setTimer(() => void pull(), interval);
  };
  const pull = async () => {
    if (!running || hidden || !online || inFlight) return;
    inFlight = true;
    clear();
    const mine = generation;
    try {
      const rows = await deps.read();
      if (mine === generation && running) deps.onDelivery(Array.isArray(rows) ? rows : [], deps.now());
    } catch (error) {
      if (mine === generation && running) deps.onFailure(error, deps.now());
    } finally {
      // A read abandoned by stop() must not clear the flag of a newer generation.
      if (mine === generation) {
        inFlight = false;
        schedule();
      }
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      void pull();
    },
    stop() {
      running = false;
      generation += 1;
      inFlight = false;
      clear();
    },
    setHidden(next) {
      if (next === hidden) return;
      hidden = next;
      if (hidden) {
        clear();
        deps.onGap();
      } else void pull();
    },
    setOnline(next) {
      if (next === online) return;
      online = next;
      if (!online) {
        clear();
        deps.onGap();
      } else void pull();
    },
    pullNow: pull,
  };
}
