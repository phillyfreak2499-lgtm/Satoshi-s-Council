import { clamp } from "./math";
import type { Lean, Snapshot } from "./types";

export type ClockRead = {
  dist: number;
  atr: number;
  mins: number;
  sigma: number;
  z: number;
  itm: Lean;
  owns: boolean;
  magnet: boolean;
};

export function readClock(snap: Snapshot): ClockRead {
  const dist = snap.spot - snap.strike;
  const atr = Math.max(snap.atr, 1);
  const mins = Math.max(snap.mins_left, 0.35);
  const sigma = atr * Math.sqrt(mins);
  const z = sigma > 0 ? Math.abs(dist) / sigma : 0;
  const itm: Lean = dist > 0 ? "UP" : dist < 0 ? "DOWN" : "WAIT";
  return {
    dist,
    atr,
    mins,
    sigma,
    z,
    itm,
    owns: z >= 1.25 && itm !== "WAIT",
    magnet: Math.abs(dist) < 0.5 * atr && snap.mins_left < 2.2,
  };
}

export function centsOf(lean: Lean, yesMid: number, finish: "UP" | "DOWN", spread = 0): number {
  if (lean !== "UP" && lean !== "DOWN") return 0;
  const mid = clamp(yesMid, 1, 99);
  const cost = Math.max(0, spread) / 2;
  if (lean === "UP") return (finish === "UP" ? 100 : 0) - mid - cost;
  return (finish === "DOWN" ? 100 : 0) - (100 - mid) - cost;
}
