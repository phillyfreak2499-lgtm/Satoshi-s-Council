import { last, signOf } from "./math";
import { candleFeat, readWick } from "./patterns";
import type { Lean, Snapshot } from "./types";

export type DriftRead = {
  sign5: Lean | "FLAT";
  sign15: Lean | "FLAT";
  sign30: Lean | "FLAT";
  sign1h: Lean | "FLAT";
  aligned: boolean;
  strong15: boolean;
  accel: boolean;
  decay: boolean;
  pullback: boolean;
  stack: boolean;
  chop: boolean;
  lean: Lean;
  rsi: number;
  volConfirm: boolean;
  trend: "UP" | "DOWN" | "RANGE";
  ema1mBull: boolean;
  ema5mBull: boolean;
};

export type StreakRead = {
  n: number;
  side: Lean | null;
  live: Lean;
  young: boolean;
  mid: boolean;
  extended: boolean;
  liveAgree: boolean;
  liveBreak: boolean;
  alternating: boolean;
  yesAgrees: boolean;
  yesFights: boolean;
  chips: Lean[];
};

export type ExhaustRead = {
  run: boolean;
  extreme: boolean;
  flipped: boolean;
  climax: boolean;
  inside: boolean;
  rsiDiv: boolean;
  failedPush: boolean;
  emaAgainst: boolean;
  fade: Lean;
  ret1h: number;
  rangePos: number;
  last5Name: string;
  rsi: number;
};

export function readDrift(snap: Snapshot): DriftRead {
  const sign5 = signOf(snap.ret5);
  const sign15 = signOf(snap.ret15);
  const sign30 = signOf(snap.ret30);
  const sign1h = signOf(snap.ret1h);
  const aligned = sign5 !== "FLAT" && sign5 === sign15 && sign15 === sign30;
  const strong15 = Math.abs(snap.ret15) >= 0.0025;
  const same5_15 = sign5 !== "FLAT" && sign5 === sign15;
  const accel = same5_15 && Math.abs(snap.ret5) >= Math.abs(snap.ret15) * 0.42;
  const decay = same5_15 && Math.abs(snap.ret5) < Math.abs(snap.ret15) * 0.16;
  const wick1 = readWick(snap.candles_1m.filter((c) => c.closed));
  const wick5 = readWick(snap.candles_5m);
  const trend = wick1.structure.trend;
  const ema1mBull = wick1.emaSlow !== 0 && wick1.emaFast >= wick1.emaSlow;
  const ema5mBull = wick5.emaSlow !== 0 && wick5.emaFast >= wick5.emaSlow;
  const pullback =
    sign15 !== "FLAT" &&
    sign15 === sign30 &&
    (sign5 === "FLAT" || sign5 !== sign15) &&
    Math.abs(snap.ret5) < Math.abs(snap.ret15) &&
    ((sign15 === "UP" && trend !== "DOWN") || (sign15 === "DOWN" && trend !== "UP"));
  const stack =
    strong15 &&
    sign15 !== "FLAT" &&
    ema1mBull === (sign15 === "UP") &&
    ema5mBull === (sign15 === "UP");
  const chop = !aligned && !pullback;
  let lean: Lean = "WAIT";
  if (aligned && (sign5 === "UP" || sign5 === "DOWN")) lean = sign5;
  else if (pullback && (sign15 === "UP" || sign15 === "DOWN")) lean = sign15;
  return {
    sign5,
    sign15,
    sign30,
    sign1h,
    aligned,
    strong15,
    accel,
    decay,
    pullback,
    stack,
    chop,
    lean,
    rsi: wick1.rsi,
    volConfirm: wick1.volConfirm,
    trend,
    ema1mBull,
    ema5mBull,
  };
}

export function readStreak(snap: Snapshot): StreakRead {
  const official = snap.official_settles
    .map((s) => s.lean)
    .filter((c): c is "UP" | "DOWN" => c === "UP" || c === "DOWN");
  const chips = (
    official.length ? official : snap.demo ? snap.window_memory.prior_settles : []
  )
    .filter((c): c is "UP" | "DOWN" => c === "UP" || c === "DOWN")
    .slice(-8);
  let side: Lean | null = chips.at(-1) ?? null;
  let n = 0;
  if (side === "UP" || side === "DOWN") {
    for (let i = chips.length - 1; i >= 0; i--) {
      if (chips[i] !== side) break;
      n += 1;
    }
  } else {
    side = null;
  }
  const yes = snap.yes_mid;
  const live: Lean = yes >= 55 ? "UP" : yes <= 45 ? "DOWN" : "WAIT";
  const directional = side === "UP" || side === "DOWN";
  const liveAgree = Boolean(directional && live === side);
  const young = n > 0 && n <= 3 && directional;
  const mid = n === 4 && directional;
  const extended = n >= 5 && directional;
  const last4 = chips.slice(-4);
  const alternating =
    last4.length >= 4 && last4.every((c, i) => i === 0 || c !== last4[i - 1]);
  const yesAgrees = liveAgree;
  const yesFights = Boolean(directional && live !== "WAIT" && live !== side);
  return {
    n,
    side,
    live,
    young,
    mid,
    extended,
    liveAgree,
    liveBreak: young && yesFights,
    alternating,
    yesAgrees,
    yesFights,
    chips,
  };
}

export function readExhaust(snap: Snapshot): ExhaustRead {
  const c5 = snap.candles_5m.filter((c) => c.closed);
  const last5 = last(c5);
  const prev5 = c5.at(-2);
  const ret1h = snap.ret1h;
  const flipped = Boolean(
    last5 && prev5 && ret1h !== 0 && Math.sign(last5.close - last5.open) !== Math.sign(ret1h),
  );
  const extreme = snap.range_pos >= 0.8 || snap.range_pos <= 0.2;
  const run = Math.abs(ret1h) >= 0.01;
  const wick5 = readWick(c5);
  const f = last5 ? candleFeat(last5) : null;
  const againstWick =
    Boolean(f) &&
    ((ret1h > 0 && f!.upperPct >= 0.45) || (ret1h < 0 && f!.lowerPct >= 0.45));
  const climax = run && extreme && wick5.volConfirm && againstWick;
  const inside = Boolean(
    last5 &&
      prev5 &&
      last5.high < prev5.high &&
      last5.low > prev5.low &&
      run,
  );
  const rsiDiv =
    run && ((ret1h > 0 && wick5.rsi < 42) || (ret1h < 0 && wick5.rsi > 58));
  const emaAgainst =
    run && wick5.emaSlow !== 0 && (wick5.emaFast >= wick5.emaSlow) !== ret1h > 0;
  let failedPush = false;
  if (c5.length >= 3 && run && extreme) {
    const a = c5.at(-2)!;
    const b = c5.at(-1)!;
    if (ret1h > 0 && snap.range_pos >= 0.8 && b.high <= a.high) failedPush = true;
    if (ret1h < 0 && snap.range_pos <= 0.2 && b.low >= a.low) failedPush = true;
  }
  const fade: Lean = ret1h > 0 ? "DOWN" : ret1h < 0 ? "UP" : "WAIT";
  return {
    run,
    extreme,
    flipped,
    climax,
    inside,
    rsiDiv,
    failedPush,
    emaAgainst,
    fade,
    ret1h,
    rangePos: snap.range_pos,
    last5Name: wick5.lastName,
    rsi: wick5.rsi,
  };
}
