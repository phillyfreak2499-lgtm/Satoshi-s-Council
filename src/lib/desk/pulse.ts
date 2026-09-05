/**
 * Client side of the fast lane. Polls GET /pulse every ~1.5s in Live mode and
 * feeds LEAF components only — the engine's 4s DeskFrame pipeline never sees
 * it, so the full tree keeps its slow cadence while spot, the book, and the
 * headline charts move. Honesty rules: out-of-order pulses are dropped, and
 * usePulse() returns null the moment the data stops being provably fresh —
 * every consumer must fall back to the frame snapshot on null.
 */
import { useSyncExternalStore } from "react";
import type { DeskPulse } from "./server-engine";

const POLL_MS = 1_500;
const FRESH_MS = 6_000;
const MAX_FAILS = 3;

let data: DeskPulse | null = null;
let receivedAt = 0;
let fails = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
const subs = new Set<() => void>();

function notify() {
  for (const f of subs) f();
}

async function poll() {
  if (inflight) return;
  inflight = true;
  try {
    const r = await fetch("/pulse", {
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(String(r.status));
    const p = (await r.json()) as DeskPulse;
    if (p && p.as_of > 0 && p.as_of >= (data?.as_of ?? 0)) {
      data = p;
      receivedAt = Date.now();
      fails = 0;
      notify();
      return;
    }
    if (p?.stale) {
      fails += 1;
      notify();
      return;
    }
  } catch {
    fails += 1;
    notify();
  } finally {
    inflight = false;
  }
}

export function startPulse() {
  if (timer) return;
  timer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    void poll();
  }, POLL_MS);
  void poll();
}

export function stopPulse() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Fresh pulse or null. Null means: use the frame snapshot and stop moving. */
export function freshPulse(): DeskPulse | null {
  if (!data || data.stale) return null;
  if (fails >= MAX_FAILS) return null;
  if (Date.now() - receivedAt > FRESH_MS) return null;
  return data;
}

/** Server-clock minus local-clock, for skew-corrected countdowns. 0 until known. */
export function pulseSkewMs(): number {
  if (!data || !receivedAt) return 0;
  return data.as_of - receivedAt;
}

/** Local wall-clock ms when the current pulse was received (0 if none). */
export function pulseReceivedAt(): number {
  return receivedAt;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function snapshot(): DeskPulse | null {
  return freshPulse();
}

function serverSnapshot(): DeskPulse | null {
  return null;
}

/** Leaf-component hook. Re-renders on each accepted pulse (and on stale flips). */
export function usePulse(): DeskPulse | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
