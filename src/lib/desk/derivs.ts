import { last, median, signOf } from "./math";
import { candleFeat } from "./patterns";
import { FUNDING_PERIOD_MS, nativePeriodMs, type HistPoint } from "./hist";
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
  d10usd: number;
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

function persistFunding(series: HistPoint[], n: number): Lean | "FLAT" {
  if (series.length < n) return "FLAT";
  const slice = series.slice(-n);
  const period = nativePeriodMs(series, FUNDING_PERIOD_MS);
  for (let i = 1; i < slice.length; i++) {
    if (slice[i]!.t - slice[i - 1]!.t < period * 0.75) return "FLAT";
  }
  if (slice.every((x) => x.v > FUND_EXT)) return "UP";
  if (slice.every((x) => x.v < -FUND_EXT)) return "DOWN";
  return "FLAT";
}

export function readCarry(snap: Snapshot): CarryRead {
  const hist = snap.funding_series;
  const lastF = snap.funding_rate || last(hist)?.v || 0;
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
  const d10usd = snap.oi_usd_delta_10m;
  const px = Math.sign(snap.ret15);
  const btcSign = Math.sign(d10);
  const usdSign = Math.sign(d10usd);
  const btcWith = btcSign !== 0 && px !== 0 && btcSign === px;
  const usdWith = usdSign !== 0 && px !== 0 && usdSign === px;
  const withPx = btcWith && usdWith;
  const against = btcSign !== 0 && usdSign !== 0 && px !== 0 && btcSign !== px && usdSign !== px;
  const disagree = btcSign !== 0 && usdSign !== 0 && btcSign !== usdSign;
  const accel =
    withPx &&
    Math.abs(d10) > 0 &&
    Math.abs(d3) >= Math.abs(d10) * 0.42 &&
    Math.sign(d3) === Math.sign(d10);
  const oi = snap.open_interest || last(snap.oi_history) || 0;
  const stall =
    disagree || (oi > 0 && Math.abs(d10) / oi < 0.002 && Math.abs(snap.ret15) >= 0.0025);
  const flushQuiet = d10 < 0 && d10usd < 0 && Math.abs(snap.ret5) < 0.0015;
  let lean: Lean = "WAIT";
  if (withPx && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) as "UP" | "DOWN";
  } else if (against && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) === "UP" ? "DOWN" : "UP";
  }
  return { d3, d10, d10usd, withPx, against, accel, stall, flushQuiet, lean };
}

export function readCascade(snap: Snapshot): CascadeRead {
  const ratio = snap.vol_median > 0 ? snap.vol_last / snap.vol_median : 1;
  const liqUsd = snap.liq_long_usd + snap.liq_short_usd;
  const real = snap.liq_source !== "DOWN" && snap.liq_n >= 1 && liqUsd > 10_000;
  const volProxy = ratio > 2.2 && Math.abs(snap.ret5) > 0.002 && snap.oi_delta_10m < 0;
  const proxy = real || volProxy;
  const early = snap.oi_delta_10m < 0 && ratio < 1.4 && Math.abs(snap.ret5) > 0.001 && !real;
  const volNoOi = ratio > 2.2 && Math.abs(snap.ret5) > 0.002 && snap.oi_delta_10m >= 0 && !real;
  const lastC = last(snap.candles_1m.filter((c) => c.closed));
  const f = lastC ? candleFeat(lastC) : null;
  const againstWick =
    Boolean(f) &&
    ((snap.ret5 > 0 && f!.upperPct >= 0.45) || (snap.ret5 < 0 && f!.lowerPct >= 0.45));
  const exhaust = (real || volProxy) && againstWick;
  const forceN = real ? snap.liq_n : snap.force_n;
  const cluster = forceN >= 3 && Math.abs(snap.ret5) > 0.0015;
  let lean: Lean = "WAIT";
  if ((real || cluster || volProxy) && (signOf(snap.ret5) === "UP" || signOf(snap.ret5) === "DOWN")) {
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
