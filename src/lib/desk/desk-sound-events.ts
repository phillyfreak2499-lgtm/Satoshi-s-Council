import type { DeskFrame } from "./engine";

/** Presentation only. No imports at runtime and no writes into the desk. */
export type DeskCue = "chair-up" | "chair-down" | "paper-fill" | "settlement";
export type SoundFrame = Pick<DeskFrame, "snap" | "chair" | "settings" | "call_log" | "frame_at" | "brain_age_s" | "connection_error" | "lastError">;
export type SoundEvent = { key: string; window: string; kind: DeskCue };
export type SoundCursor = {
  ready: boolean;
  received: number;
  asOf: number;
  lastSound: number;
  seen: Set<string>;
  rows: Map<string, number | null>;
};
const FRESH_MS = 20_000;
const MAX_SEEN = 384;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const directional = (v: unknown) => v === "UP" || v === "DOWN";
const windowKey = (ticker: string, close: number) => `${ticker}|${close}`;

export function newSoundCursor(saved: unknown = []): SoundCursor {
  const keys = Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string" && v.length < 160).slice(-MAX_SEEN) : [];
  return { ready: false, received: 0, asOf: 0, lastSound: -Infinity, seen: new Set(keys), rows: new Map() };
}

/** First load, enable, focus return, Demo and connection recovery establish a
 * silent baseline. Only a fresh, subsequent live frame can produce a cue.
 * Exactly one cue per update; fill > settlement > read, with no catch-up queue. */
export function observeDeskSounds(cursor: SoundCursor, frame: SoundFrame, now: number, active: boolean): SoundEvent[] {
  const snap = frame.snap;
  const fresh = finite(now) && frame.settings.source === "live" && !frame.connection_error && !frame.lastError && snap != null
    && finite(frame.frame_at) && now - frame.frame_at >= -2000 && now - frame.frame_at <= FRESH_MS
    && finite(frame.brain_age_s) && frame.brain_age_s >= 0 && frame.brain_age_s <= FRESH_MS / 1000
    && finite(snap.as_of) && now - snap.as_of >= -2000 && now - snap.as_of <= FRESH_MS
    && snap.health.spot === "LIVE" && snap.health.kalshi === "LIVE"
    && /^KXBTC15M-/.test(snap.ticker) && finite(snap.close_time);
  if (!fresh || !snap) {
    cursor.ready = false;
    return [];
  }
  // Stale or repeated transport snapshots must not reset the baseline or rearm.
  if (snap.as_of < cursor.asOf || frame.frame_at < cursor.received) return [];
  if (frame.frame_at === cursor.received && snap.as_of === cursor.asOf) {
    if (!active) cursor.ready = false;
    return [];
  }
  const canPlay = active && cursor.ready && now - cursor.received <= FRESH_MS && snap.as_of > cursor.asOf;
  const currentWindow = windowKey(snap.ticker, snap.close_time);
  const candidates: SoundEvent[] = [];
  const remember = (key: string, window: string, kind: DeskCue, eligible: boolean) => {
    if (!cursor.seen.has(key)) {
      cursor.seen.add(key);
      if (canPlay && eligible) candidates.push({ key, window, kind });
    }
  };
  const lean = frame.chair?.lean;
  if (directional(lean)) {
    remember(`read:${currentWindow}:${lean}`, currentWindow, lean === "UP" ? "chair-up" : "chair-down", snap.close_time > now);
  }
  const rows = new Map<string, number | null>();
  for (const row of frame.call_log) {
    if (!/^KXBTC15M-/.test(row.ticker) || !finite(row.close_time) || !finite(row.t)
      || row.close_time < now - 4 * 60 * 60_000 || row.close_time > now + 16 * 60_000
      || row.t < row.close_time - 15 * 60_000 || row.t >= row.close_time
      || !directional(row.lean) || !finite(row.cents) || row.cents <= 0 || row.cents >= 100
      || !(row.settle === null || row.settle === 0 || row.settle === 100)) continue;
    const key = windowKey(row.ticker, row.close_time);
    const hadRow = cursor.rows.has(key);
    const wasOpen = hadRow && cursor.rows.get(key) === null;
    rows.set(key, row.settle);
    remember(`fill:${key}`, key, "paper-fill", !hadRow && key === currentWindow && row.settle === null
      && row.close_time > now && row.t > cursor.asOf && row.t <= snap.as_of + 2000
      && now - row.t >= -2000 && now - row.t <= FRESH_MS);
    if (row.settle !== null) {
      const official = snap.official_settles.find((s) => s.ticker === row.ticker && s.close_time === row.close_time
        && directional(s.lean) && finite(s.receipt_ts) && now - s.receipt_ts >= -2000 && now - s.receipt_ts <= FRESH_MS
        && row.settle === (s.lean === row.lean ? 100 : 0));
      remember(`settle:${key}`, key, "settlement", wasOpen && row.close_time <= now && official != null);
    }
  }
  cursor.rows = rows;
  cursor.received = frame.frame_at;
  cursor.asOf = snap.as_of;
  cursor.ready = active;
  while (cursor.seen.size > MAX_SEEN) cursor.seen.delete(cursor.seen.values().next().value!);
  if (!candidates.length || now - cursor.lastSound < 1500) return [];
  const priority: Record<DeskCue, number> = { "paper-fill": 0, settlement: 1, "chair-up": 2, "chair-down": 2 };
  candidates.sort((a, b) => priority[a.kind] - priority[b.kind]);
  cursor.lastSound = now;
  return [candidates[0]];
}

export function deskSoundViewActive(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  return pathname === "/" && (tab == null || tab === "satoshi" || tab === "atelier") && !params.has("seat");
}
