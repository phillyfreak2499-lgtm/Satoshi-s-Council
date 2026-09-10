import type { Lean, Learner, Snapshot } from "./types";
import { takerFeeCents } from "./clock.ts";

export const CHAIR_SCALP = "SATOSHI";
const ROLL = 20;

export type OpenLeg = {
  lean: "UP" | "DOWN";
  cents: number;
  ticker: string;
  close_time: number;
};

export type SeatScalp = {
  open: OpenLeg | null;
  legs: number[];
};

export function blankScalp(): SeatScalp {
  return { open: null, legs: [] };
}

export function markSide(snap: Snapshot, lean: "UP" | "DOWN"): number {
  if (lean === "UP") return snap.yes_ask || snap.yes_mid || 0;
  return snap.no_ask || (snap.yes_mid ? 100 - snap.yes_mid : 0);
}

export function askCents(snap: Snapshot, lean: Lean): number | undefined {
  if (lean !== "UP" && lean !== "DOWN") return undefined;
  const n = markSide(snap, lean);
  return n > 0 && n < 100 ? n : undefined;
}

export function scalpAvg(legs: number[]): number | null {
  if (!legs.length) return null;
  return legs.reduce((s, x) => s + x, 0) / legs.length;
}

export function readScalp(learner: Learner, id: string): SeatScalp {
  const cur = learner.seat_scalp?.[id];
  if (!cur) return blankScalp();
  return { open: cur.open ?? null, legs: cur.legs ?? [] };
}

function scalpOf(learner: Learner, id: string): SeatScalp {
  if (!learner.seat_scalp) learner.seat_scalp = {};
  const cur = learner.seat_scalp[id] ?? blankScalp();
  if (!cur.legs) cur.legs = [];
  learner.seat_scalp[id] = cur;
  return cur;
}

function pushLeg(st: SeatScalp, pnl: number) {
  st.legs = [...st.legs, Math.round(pnl * 10) / 10].slice(-ROLL);
}

function netClose(entry: number, exit: number): number {
  const entryFee = takerFeeCents(entry);
  const exitFee = exit > 0 && exit < 100 ? takerFeeCents(exit) : 0;
  return exit - entry - entryFee - exitFee;
}

function closeOpen(st: SeatScalp, exit: number): number | null {
  if (!st.open) return null;
  const pnl = netClose(st.open.cents, exit);
  st.open = null;
  pushLeg(st, pnl);
  return pnl;
}

/** Buy this side at the ask. A flip sells the last buy at this side's current cents. WAIT sells and stays flat. */
export function onLean(learner: Learner, id: string, lean: Lean, snap: Snapshot): number | null {
  if (!learner.seat_scalp) learner.seat_scalp = {};
  const st = scalpOf(learner, id);
  const sameWindow =
    st.open && st.open.ticker === snap.ticker && st.open.close_time === snap.close_time;

  if (lean !== "UP" && lean !== "DOWN") {
    if (!sameWindow) return null;
    return closeOpen(st, markSide(snap, st.open!.lean));
  }

  const entry = markSide(snap, lean);
  if (!(entry > 0) || !(entry < 100)) return null;

  if (st.open && sameWindow && st.open.lean === lean) return null;

  let pnl: number | null = null;
  if (st.open && sameWindow && st.open.lean !== lean) {
    pnl = closeOpen(st, markSide(snap, st.open.lean));
  } else if (st.open && !sameWindow) {
    st.open = null;
  }

  st.open = { lean, cents: Math.round(entry * 10) / 10, ticker: snap.ticker, close_time: snap.close_time };
  if (!learner.seat_calls) learner.seat_calls = {};
  learner.seat_calls[id] = (learner.seat_calls[id] ?? 0) + 1;
  return pnl;
}

/** Window end: still holding → 100 if that side won, 0 if it lost. */
export function onSettle(learner: Learner, id: string, winner: "UP" | "DOWN"): number | null {
  const st = scalpOf(learner, id);
  if (!st.open) return null;
  return closeOpen(st, st.open.lean === winner ? 100 : 0);
}

export function settleAll(learner: Learner, winner: "UP" | "DOWN") {
  const keys = new Set(Object.keys(learner.seat_scalp ?? {}));
  keys.add(CHAIR_SCALP);
  for (const id of keys) onSettle(learner, id, winner);
}
