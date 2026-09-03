import type { Lean } from "./types";

/** Hold a side until the new lean prints twice, and at least HOLD_MS on a live call. */
export const HOLD_MS = 12_000;
export const CONFIRM_TICKS = 2;

export type Stick = {
  shown: Lean;
  pending: Lean | null;
  pendingN: number;
  since: number;
};

export function stickLean(prev: Stick | undefined, next: Lean, now: number): { lean: Lean; st: Stick } {
  if (!prev) return { lean: next, st: { shown: next, pending: null, pendingN: 0, since: now } };
  if (next === prev.shown) {
    return { lean: next, st: { shown: next, pending: null, pendingN: 0, since: prev.since } };
  }
  const pendingN = prev.pending === next ? prev.pendingN + 1 : 1;
  const held = now - prev.since >= HOLD_MS || prev.shown === "WAIT";
  if (pendingN >= CONFIRM_TICKS && held) {
    return { lean: next, st: { shown: next, pending: null, pendingN: 0, since: now } };
  }
  return {
    lean: prev.shown,
    st: { shown: prev.shown, pending: next, pendingN, since: prev.since },
  };
}

/** Keep a live side until the score actually clears the opposite bar. */
export function holdScore(prev: Lean, score: number, bar: number): Lean {
  const up = score > bar;
  const dn = score < -bar;
  if (prev === "UP") {
    if (dn) return "DOWN";
    if (score > bar * 0.35) return "UP";
    return "WAIT";
  }
  if (prev === "DOWN") {
    if (up) return "UP";
    if (score < -bar * 0.35) return "DOWN";
    return "WAIT";
  }
  if (up) return "UP";
  if (dn) return "DOWN";
  return "WAIT";
}
