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

/** Abramowitz–Stegun Φ(x). */
export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** Kalshi taker fee in cents: ceil(0.07 · P · (1−P) · 100) for 1 contract. */
export function takerFeeCents(priceCents: number): number {
  const p = clamp(priceCents, 1, 99) / 100;
  return Math.ceil(7 * p * (1 - p));
}

export function fairYesCents(snap: Snapshot): number {
  const c = readClock(snap);
  const signed = c.sigma > 0 ? c.dist / c.sigma : 0;
  return clamp(normCdf(signed) * 100, 1, 99);
}

export function centsOf(lean: Lean, snap: Snapshot, finish: "UP" | "DOWN"): number {
  if (lean !== "UP" && lean !== "DOWN") return 0;
  const px =
    lean === "UP"
      ? snap.yes_ask || snap.yes_mid || 50
      : snap.no_ask || 100 - (snap.yes_mid || 50);
  const fee = takerFeeCents(px);
  const pay = lean === finish ? 100 : 0;
  return pay - px - fee;
}
