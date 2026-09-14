/**
 * Motion primitives for the floor. One shared 250ms ticker drives every
 * countdown and ticking age through string snapshots — a component re-renders
 * only when its DISPLAYED text changes, so twenty seat cards showing "7.4m"
 * cost one render per 6 seconds, not four per second. useSmooth is a bounded
 * rAF tween for the few leaf numbers and the two headline canvases; it stops
 * dead the instant it settles, and callers must derive colors from the TARGET
 * value, never the tweened one.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clockMs } from "./math";
import { pulseSkewMs } from "./pulse";

const TICK_MS = 250;
const tickSubs = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
// Time is sampled once per tick so every getSnapshot between two ticks
// returns the identical string — the useSyncExternalStore contract.
let tickNowMs = 0;

function tickNow(): number {
  return tickNowMs || Date.now();
}

function ensureTicker() {
  if (tickTimer || typeof window === "undefined") return;
  tickNowMs = Date.now();
  tickTimer = setInterval(() => {
    if (document.hidden) return;
    tickNowMs = Date.now();
    for (const f of tickSubs) f();
  }, TICK_MS);
}

function tickSubscribe(fn: () => void) {
  ensureTicker();
  tickSubs.add(fn);
  return () => {
    tickSubs.delete(fn);
    if (!tickSubs.size && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

function approxServerNow(): number {
  return tickNow() + pulseSkewMs();
}

/** Ticking text driven by the shared 250ms clock; re-renders only when the
 *  computed string changes. `compute` must be cheap and pure. */
function useTickText(compute: () => string): string {
  const ref = useRef(compute);
  ref.current = compute;
  return useSyncExternalStore(
    tickSubscribe,
    () => ref.current(),
    () => "—",
  );
}

/** Window countdown that runs between data frames. Clamped at 0:00. */
export function useCountdownText(closeTimeMs: number, fmt: "clock" | "mins" = "clock"): string {
  return useTickText(() => {
    const left = Math.max(0, closeTimeMs - approxServerNow());
    return fmt === "clock" ? clockMs(left) : `${(left / 60_000).toFixed(1)}m`;
  });
}

/** An age that counts up locally from its last known base — a stalled feed
 *  visibly gets older instead of freezing at its last printed age. */
export function useTickingAge(baseAgeS: number, sinceLocalMs: number): string {
  return useTickText(() => {
    const s = Math.max(0, baseAgeS + (sinceLocalMs > 0 ? (tickNow() - sinceLocalMs) / 1000 : 0));
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  });
}

/** Bounded ease-out tween toward `target`. ~30fps while moving, zero cost at
 *  rest. Snaps instantly on the first finite value and on non-finite input. */
export function useSmooth(target: number, ms = 600): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  shownRef.current = shown;
  const raf = useRef(0);
  const lastPaint = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setShown(target);
      return;
    }
    const from = Number.isFinite(shownRef.current) ? shownRef.current : target;
    if (from === target) return;
    const span = target - from;
    // Imperceptible moves snap — no animation frames for a 0.01 change.
    if (Math.abs(span) < Math.abs(target) * 1e-6 + 1e-4) {
      setShown(target);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) * (1 - p);
      if (p >= 1) {
        setShown(target);
        return;
      }
      if (now - lastPaint.current >= 33) {
        lastPaint.current = now;
        setShown(from + span * eased);
      }
      raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return shown;
}
