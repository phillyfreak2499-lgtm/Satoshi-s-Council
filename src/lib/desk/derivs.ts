import { last, median, signOf } from "./math";
import { candleFeat } from "./patterns";
import type { Lean, Snapshot } from "./types";

const FUND_EXT = 0.0002;
const FUND_NORM = 0.00012;

export type CarryRead = {
  last: number;
  persist: Lean | "FLAT";
  extreme: boolean;
  risingOi: boolean;
  fallingOi: boolean;
  normalize: boolean;
  withPrice: boolean;
  moderate: boolean;
  flip: Lean | "FLAT";
  lean: Lean;
};

export type ChainRead = {
  d3: number;
  d10: number;
  withPx: boolean;
  against: boolean;
  accel: boolean;
  stall: boolean;
  flushQuiet: boolean;
  lean: Lean;
};

export type CascadeRead = {
  ratio: number;
  proxy: boolean;
  early: boolean;
  volNoOi: boolean;
  exhaust: boolean;
  forceN: number;
  cluster: boolean;
  lean: Lean;
};

export type VoltRead = {
  atrPct: number;
  volPct: number;
  dead: boolean;
  expand: boolean;
  spike: boolean;
  coil: boolean;
  hot: boolean;
  lean: Lean;
};

function persistFunding(hist: number[], n: number): Lean | "FLAT" {
  if (hist.length < n) return "FLAT";
  const slice = hist.slice(-n);
  if (slice.every((x) => x > FUND_EXT)) return "UP";
  if (slice.every((x) => x < -FUND_EXT)) return "DOWN";
  return "FLAT";
}

export function readCarry(snap: Snapshot): CarryRead {
  const hist = snap.funding_history;
  const lastF = last(hist) ?? snap.funding_rate;
  const persist = persistFunding(hist, 3);
  const extreme = persist !== "FLAT" && Math.abs(lastF) > FUND_EXT;
  const risingOi = snap.oi_delta_10m > 0;
  const fallingOi = snap.oi_delta_10m < 0;
  const older = hist.length >= 4 ? persistFunding(hist.slice(0, -1), 3) : "FLAT";
  const normalize =
    older !== "FLAT" && Math.abs(lastF) < FUND_NORM;
  let flip: Lean | "FLAT" = "FLAT";
  if (older === "UP" && lastF < -FUND_NORM) flip = "DOWN";
  if (older === "DOWN" && lastF > FUND_NORM) flip = "UP";
  const withPrice =
    lastF !== 0 &&
    signOf(lastF) !== "FLAT" &&
    signOf(lastF) === signOf(snap.ret15);
  const moderate = Math.abs(lastF) >= 0.00008 && Math.abs(lastF) < FUND_EXT && risingOi && withPrice;
  let lean: Lean = "WAIT";
  if (extreme) lean = lastF > 0 ? "DOWN" : "UP";
  else if (moderate && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) as "UP" | "DOWN";
  }
  return {
    last: lastF,
    persist,
    extreme,
    risingOi,
    fallingOi,
    normalize,
    withPrice,
    moderate,
    flip,
    lean,
  };
}

export function readChain(snap: Snapshot): ChainRead {
  const d3 = snap.oi_delta_3m;
  const d10 = snap.oi_delta_10m;
  const withPx = Math.sign(d10) === Math.sign(snap.ret15) && d10 !== 0 && snap.ret15 !== 0;
  const against = Math.sign(d10) !== 0 && Math.sign(snap.ret15) !== 0 && Math.sign(d10) !== Math.sign(snap.ret15);
  const accel =
    withPx &&
    Math.abs(d10) > 0 &&
    Math.abs(d3) >= Math.abs(d10) * 0.42 &&
    Math.sign(d3) === Math.sign(d10);
  const oi = snap.open_interest || last(snap.oi_history) || 0;
  const stall = oi > 0 && Math.abs(d10) / oi < 0.002 && Math.abs(snap.ret15) >= 0.0025;
  const flushQuiet = d10 < 0 && Math.abs(snap.ret5) < 0.0015;
  let lean: Lean = "WAIT";
  if (withPx && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) as "UP" | "DOWN";
  } else if (against && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) === "UP" ? "DOWN" : "UP";
  }
  return { d3, d10, withPx, against, accel, stall, flushQuiet, lean };
}

export function readCascade(snap: Snapshot): CascadeRead {
  const ratio = snap.vol_median > 0 ? snap.vol_last / snap.vol_median : 1;
  const proxy =
    ratio > 2.2 && Math.abs(snap.ret5) > 0.002 && snap.oi_delta_10m < 0;
  const early = snap.oi_delta_10m < 0 && ratio < 1.4 && Math.abs(snap.ret5) > 0.001;
  const volNoOi = ratio > 2.2 && Math.abs(snap.ret5) > 0.002 && snap.oi_delta_10m >= 0;
  const lastC = last(snap.candles_1m.filter((c) => c.closed));
  const f = lastC ? candleFeat(lastC) : null;
  const againstWick =
    Boolean(f) &&
    ((snap.ret5 > 0 && f!.upperPct >= 0.45) || (snap.ret5 < 0 && f!.lowerPct >= 0.45));
  const exhaust = (proxy || snap.force_n >= 2) && againstWick && ratio < 1.8;
  const forceN = snap.force_n;
  const cluster = forceN >= 3 && Math.abs(snap.ret5) > 0.0015;
  let lean: Lean = "WAIT";
  if ((proxy || cluster) && (signOf(snap.ret5) === "UP" || signOf(snap.ret5) === "DOWN")) {
    lean = signOf(snap.ret5) as "UP" | "DOWN";
  } else if (volNoOi && (signOf(snap.ret5) === "UP" || signOf(snap.ret5) === "DOWN")) {
    lean = signOf(snap.ret5) as "UP" | "DOWN";
  }
  return { ratio, proxy, early, volNoOi, exhaust, forceN, cluster, lean };
}

export function readVolt(snap: Snapshot): VoltRead {
  const atrPct = snap.atr_pct;
  const volPct = snap.vol_percentile;
  const dead = atrPct < 0.12 || volPct < 25;
  const expand = atrPct >= 0.22 && Math.abs(snap.ret15) >= 0.0025;
  const bars = snap.candles_1m.filter((c) => c.closed);
  const ranges = bars.slice(-18).map((c) => c.high - c.low);
  const lastR = last(ranges) ?? 0;
  const medR = median(ranges.slice(0, -1));
  const spike = medR > 0 && lastR >= medR * 2.2 && signOf(snap.ret5) !== "FLAT";
  const recent = ranges.slice(-6);
  const prior = ranges.slice(-18, -6);
  const coil =
    recent.length >= 5 &&
    prior.length >= 6 &&
    median(recent) < median(prior) * 0.65;
  const hot = volPct >= 80 && Math.abs(snap.ret5) >= 0.0015;
  let lean: Lean = "WAIT";
  if (expand && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) as "UP" | "DOWN";
  } else if (hot && (signOf(snap.ret5) === "UP" || signOf(snap.ret5) === "DOWN")) {
    lean = signOf(snap.ret5) as "UP" | "DOWN";
  } else if (spike && (signOf(snap.ret5) === "UP" || signOf(snap.ret5) === "DOWN")) {
    lean = signOf(snap.ret5) as "UP" | "DOWN";
  }
  return { atrPct, volPct, dead, expand, spike, coil, hot, lean };
}
