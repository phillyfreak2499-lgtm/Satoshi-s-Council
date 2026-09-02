import { last, mean } from "./math";
import type { Candle, Lean } from "./types";

export type CandleFeat = {
  body: number;
  range: number;
  upper: number;
  lower: number;
  bodyPct: number;
  upperPct: number;
  lowerPct: number;
  closePos: number;
  bull: boolean;
  vol: number;
};

export type SingleKind =
  | "doji"
  | "long_legged"
  | "dragonfly"
  | "gravestone"
  | "marubozu"
  | "hammer"
  | "hanging_man"
  | "inv_hammer"
  | "shooting_star"
  | "spinning_top"
  | "high_wave"
  | "pin"
  | "body"
  | "spin";

export type MarkKind =
  | "pin"
  | "hammer"
  | "hanging"
  | "inv_ham"
  | "shoot"
  | "doji"
  | "dragonfly"
  | "gravestone"
  | "long_leg"
  | "marubozu"
  | "spin_top"
  | "high_wave"
  | "engulf-up"
  | "engulf-down"
  | "pierce"
  | "dark"
  | "tweezer-top"
  | "tweezer-bot"
  | "harami-up"
  | "harami-dn"
  | "morn"
  | "even"
  | "soldiers"
  | "crows"
  | "sweep-up"
  | "sweep-dn"
  | "bos-up"
  | "bos-dn"
  | "amd";

export type WickMark = {
  i: number;
  kind: MarkKind;
  lean: Lean;
  span: number;
  loc: "HIGH" | "LOW" | "MID";
  confirmed: boolean;
  pending: boolean;
  contextOk: boolean;
  confluence: number;
};

export type AmdModel = {
  phase: "ACCUMULATION" | "MANIPULATION" | "DISTRIBUTION";
  lean: Lean;
  acc: { i0: number; i1: number; hi: number; lo: number };
  manipI: number | null;
  distI: number | null;
  quality: number;
};

export type Swing = { i: number; px: number };

export type StructureModel = {
  trend: "UP" | "DOWN" | "RANGE";
  highs: Swing[];
  lows: Swing[];
  bos: Lean | null;
  bosI: number | null;
};

export type WickRead = {
  slice: Candle[];
  lastName: SingleKind;
  lastFeat: CandleFeat;
  marks: WickMark[];
  amd: AmdModel | null;
  structure: StructureModel;
  rsi: number;
  emaFast: number;
  emaSlow: number;
  volConfirm: boolean;
  mtfTrend: StructureModel["trend"];
};

export const MARK_LABEL: Record<MarkKind, string> = {
  pin: "PIN",
  hammer: "HAM",
  hanging: "HANG",
  inv_ham: "INVH",
  shoot: "SHOOT",
  doji: "DOJI",
  dragonfly: "DRAG",
  gravestone: "GRAV",
  long_leg: "LLDOJ",
  marubozu: "MARU",
  spin_top: "SPIN",
  high_wave: "WAVE",
  "engulf-up": "ENG UL",
  "engulf-down": "ENG DN",
  pierce: "PIERCE",
  dark: "DARK",
  "tweezer-top": "TWZ HI",
  "tweezer-bot": "TWZ LO",
  "harami-up": "HAR UL",
  "harami-dn": "HAR DN",
  morn: "MORN",
  even: "EVEN",
  soldiers: "3SOL",
  crows: "3CRW",
  "sweep-up": "SWP UL",
  "sweep-dn": "SWP DN",
  "bos-up": "BOS UL",
  "bos-dn": "BOS DN",
  amd: "AMD",
};

export function candleFeat(c: Candle): CandleFeat {
  const range = Math.max(1e-9, c.high - c.low);
  const body = Math.abs(c.close - c.open);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  return {
    range,
    body,
    upper,
    lower,
    bodyPct: body / range,
    upperPct: upper / range,
    lowerPct: lower / range,
    closePos: (c.close - c.low) / range,
    bull: c.close >= c.open,
    vol: c.volume,
  };
}

export function locAt(slice: Candle[], i: number): "HIGH" | "LOW" | "MID" {
  const w = slice.slice(Math.max(0, i - 19), i + 1);
  if (w.length < 4) return "MID";
  const hi = Math.max(...w.map((c) => c.high));
  const lo = Math.min(...w.map((c) => c.low));
  const span = hi - lo;
  const pos = span > 0 ? (slice[i]!.close - lo) / span : 0.5;
  if (pos >= 0.8) return "HIGH";
  if (pos <= 0.2) return "LOW";
  return "MID";
}

export function classifySingle(f: CandleFeat, loc: "HIGH" | "LOW" | "MID"): SingleKind {
  const { bodyPct, upperPct, lowerPct } = f;
  if (bodyPct < 0.12) {
    if (lowerPct >= 0.55 && upperPct < 0.18) return "dragonfly";
    if (upperPct >= 0.55 && lowerPct < 0.18) return "gravestone";
    if (upperPct >= 0.3 && lowerPct >= 0.3) return "long_legged";
    return "doji";
  }
  if (bodyPct >= 0.72 && upperPct < 0.12 && lowerPct < 0.12) return "marubozu";
  if (lowerPct >= 0.55 && bodyPct <= 0.38) return loc === "HIGH" ? "hanging_man" : "hammer";
  if (upperPct >= 0.55 && bodyPct <= 0.38) {
    if (loc === "HIGH") return "shooting_star";
    if (loc === "LOW") return "inv_hammer";
    return "pin";
  }
  if (bodyPct <= 0.32 && upperPct >= 0.22 && lowerPct >= 0.22) {
    return upperPct + lowerPct >= 0.78 ? "high_wave" : "spinning_top";
  }
  if (bodyPct >= 0.5) return "body";
  return "spin";
}

function singleMark(name: SingleKind): MarkKind | null {
  switch (name) {
    case "pin":
      return "pin";
    case "hammer":
      return "hammer";
    case "hanging_man":
      return "hanging";
    case "inv_hammer":
      return "inv_ham";
    case "shooting_star":
      return "shoot";
    case "doji":
      return "doji";
    case "dragonfly":
      return "dragonfly";
    case "gravestone":
      return "gravestone";
    case "long_legged":
      return "long_leg";
    case "marubozu":
      return "marubozu";
    case "spinning_top":
      return "spin_top";
    case "high_wave":
      return "high_wave";
    default:
      return null;
  }
}

function engulfing(prev: Candle, lastC: Candle): Lean | null {
  const pb = prev.close >= prev.open;
  const lb = lastC.close >= lastC.open;
  const pBody = Math.abs(prev.close - prev.open);
  const lBody = Math.abs(lastC.close - lastC.open);
  if (lBody < pBody * 0.9) return null;
  if (lb && !pb && lastC.close >= prev.open && lastC.open <= prev.close) return "UP";
  if (!lb && pb && lastC.close <= prev.open && lastC.open >= prev.close) return "DOWN";
  return null;
}

function piercing(prev: Candle, lastC: Candle): boolean {
  if (prev.close >= prev.open || lastC.close < lastC.open) return false;
  const mid = (prev.open + prev.close) / 2;
  return lastC.open < prev.close && lastC.close > mid && lastC.close < prev.open;
}

function darkCloud(prev: Candle, lastC: Candle): boolean {
  if (prev.close < prev.open || lastC.close >= lastC.open) return false;
  const mid = (prev.open + prev.close) / 2;
  return lastC.open > prev.close && lastC.close < mid && lastC.close > prev.open;
}

function tweezer(prev: Candle, lastC: Candle, side: "high" | "low"): boolean {
  const f0 = candleFeat(prev);
  const f1 = candleFeat(lastC);
  if (side === "high") {
    if (f0.upperPct < 0.28 || f1.upperPct < 0.28) return false;
  } else if (f0.lowerPct < 0.28 || f1.lowerPct < 0.28) return false;
  const ref = side === "high" ? Math.max(prev.high, lastC.high) : Math.min(prev.low, lastC.low);
  const a = side === "high" ? prev.high : prev.low;
  const b = side === "high" ? lastC.high : lastC.low;
  const tol = Math.max(ref * 0.00012, 2);
  return Math.abs(a - b) <= tol;
}

function harami(prev: Candle, lastC: Candle): Lean | null {
  const pLo = Math.min(prev.open, prev.close);
  const pHi = Math.max(prev.open, prev.close);
  const lLo = Math.min(lastC.open, lastC.close);
  const lHi = Math.max(lastC.open, lastC.close);
  const pBody = pHi - pLo;
  const lBody = lHi - lLo;
  if (pBody < 1e-9 || lBody > pBody * 0.5) return null;
  if (lLo < pLo || lHi > pHi) return null;
  const prevBull = prev.close >= prev.open;
  const lastBull = lastC.close >= lastC.open;
  if (prevBull === lastBull) return null;
  return lastBull ? "UP" : "DOWN";
}

function morningStar(a: Candle, b: Candle, c: Candle): boolean {
  const aF = candleFeat(a);
  const bF = candleFeat(b);
  const cF = candleFeat(c);
  if (aF.bull || aF.bodyPct < 0.4) return false;
  if (bF.bodyPct > 0.35) return false;
  if (!cF.bull || cF.bodyPct < 0.35) return false;
  const aMid = (a.open + a.close) / 2;
  return c.close > aMid;
}

function eveningStar(a: Candle, b: Candle, c: Candle): boolean {
  const aF = candleFeat(a);
  const bF = candleFeat(b);
  const cF = candleFeat(c);
  if (!aF.bull || aF.bodyPct < 0.4) return false;
  if (bF.bodyPct > 0.35) return false;
  if (cF.bull || cF.bodyPct < 0.35) return false;
  const aMid = (a.open + a.close) / 2;
  return c.close < aMid;
}

function threeRun(a: Candle, b: Candle, c: Candle, bull: boolean): boolean {
  const bars = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const f = candleFeat(bars[i]!);
    if (f.bull !== bull || f.bodyPct < 0.48) return false;
    if (i > 0) {
      const prev = bars[i - 1]!;
      if (bull && bars[i]!.close <= prev.close) return false;
      if (!bull && bars[i]!.close >= prev.close) return false;
    }
  }
  return true;
}

function rsi14(closes: number[]): number {
  if (closes.length < 15) return 50;
  const slice = closes.slice(-15);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i]! - slice[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss < 1e-12) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function ema(closes: number[], n: number): number {
  if (!closes.length) return 0;
  const k = 2 / (n + 1);
  let e = closes[0]!;
  for (let i = 1; i < closes.length; i++) e = closes[i]! * k + e * (1 - k);
  return e;
}

function swingsOf(slice: Candle[], k = 2): { highs: Swing[]; lows: Swing[] } {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  const n = slice.length;
  for (let i = k; i < n - k; i++) {
    const h = slice[i]!.high;
    const l = slice[i]!.low;
    let isH = true;
    let isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (slice[j]!.high >= h) isH = false;
      if (slice[j]!.low <= l) isL = false;
    }
    if (isH) highs.push({ i, px: h });
    if (isL) lows.push({ i, px: l });
  }
  return { highs, lows };
}

function structureOf(slice: Candle[]): StructureModel {
  const { highs, lows } = swingsOf(slice);
  const lastH = highs.slice(-3);
  const lastL = lows.slice(-3);
  let hh = 0;
  let lh = 0;
  let hl = 0;
  let ll = 0;
  for (let i = 1; i < lastH.length; i++) {
    if (lastH[i]!.px > lastH[i - 1]!.px) hh++;
    else lh++;
  }
  for (let i = 1; i < lastL.length; i++) {
    if (lastL[i]!.px > lastL[i - 1]!.px) hl++;
    else ll++;
  }
  let trend: StructureModel["trend"] = "RANGE";
  if (hh >= 1 && hl >= 1 && lh === 0) trend = "UP";
  else if (lh >= 1 && ll >= 1 && hl === 0) trend = "DOWN";
  const lastC = last(slice);
  let bos: Lean | null = null;
  let bosI: number | null = null;
  if (lastC && highs.length && lows.length) {
    const sh = last(highs)!;
    const sl = last(lows)!;
    const i = slice.length - 1;
    const prevC = slice[i - 1];
    if (lastC.close > sh.px && i > sh.i && (!prevC || prevC.close <= sh.px)) {
      bos = "UP";
      bosI = i;
    } else if (lastC.close < sl.px && i > sl.i && (!prevC || prevC.close >= sl.px)) {
      bos = "DOWN";
      bosI = i;
    }
  }
  return { trend, highs, lows, bos, bosI };
}

function tightBox(slice: Candle[]): AmdModel["acc"] | null {
  const n = slice.length;
  if (n < 14) return null;
  const ranges = slice.slice(-20).map((c) => c.high - c.low);
  const recentAtr = Math.max(mean(ranges), 1e-9);
  let best: AmdModel["acc"] | null = null;
  let bestScore = 0;
  for (let len = 8; len <= 16; len++) {
    const i0Max = n - len - 1;
    const i0Min = Math.max(0, n - 40);
    for (let i0 = i0Min; i0 <= i0Max; i0++) {
      const i1 = i0 + len - 1;
      const win = slice.slice(i0, i1 + 1);
      const hi = Math.max(...win.map((c) => c.high));
      const lo = Math.min(...win.map((c) => c.low));
      const width = hi - lo;
      if (width < 1e-9 || width > recentAtr * 4.5) continue;
      const touchesHi = win.filter((c) => (hi - c.high) / width < 0.14).length;
      const touchesLo = win.filter((c) => (c.low - lo) / width < 0.14).length;
      if (touchesHi < 2 || touchesLo < 2) continue;
      const score = ((touchesHi + touchesLo) / len) * (recentAtr / width);
      if (score > bestScore) {
        bestScore = score;
        best = { i0, i1, hi, lo };
      }
    }
  }
  return best;
}

function amdOf(slice: Candle[]): AmdModel | null {
  const acc = tightBox(slice);
  if (!acc) return null;
  const atr = Math.max(mean(slice.slice(-20).map((c) => c.high - c.low)), 1e-9);
  let manipI: number | null = null;
  let manipSide: "high" | "low" | null = null;
  for (let i = acc.i1 + 1; i < slice.length; i++) {
    const b = slice[i]!;
    const sweepLo = b.low < acc.lo - atr * 0.08 && b.close > acc.lo;
    const sweepHi = b.high > acc.hi + atr * 0.08 && b.close < acc.hi;
    if (sweepLo || sweepHi) {
      manipI = i;
      manipSide = sweepLo ? "low" : "high";
    }
  }
  if (manipI == null || !manipSide) {
    return { phase: "ACCUMULATION", lean: "WAIT", acc, manipI: null, distI: null, quality: 0.4 };
  }
  let distI: number | null = null;
  for (let i = manipI + 1; i < Math.min(slice.length, manipI + 4); i++) {
    const b = slice[i]!;
    if (manipSide === "low" && b.close > acc.hi) {
      distI = i;
      break;
    }
    if (manipSide === "high" && b.close < acc.lo) {
      distI = i;
      break;
    }
  }
  if (distI != null) {
    return {
      phase: "DISTRIBUTION",
      lean: manipSide === "low" ? "UP" : "DOWN",
      acc,
      manipI,
      distI,
      quality: 0.72,
    };
  }
  return {
    phase: "MANIPULATION",
    lean: manipSide === "low" ? "UP" : "DOWN",
    acc,
    manipI,
    distI: null,
    quality: 0.55,
  };
}

function liquiditySweep(slice: Candle[], st: StructureModel): WickMark | null {
  if (slice.length < 8) return null;
  const lastC = last(slice)!;
  const i = slice.length - 1;
  const f = candleFeat(lastC);
  const loc = locAt(slice, i);
  const sl = last(st.lows);
  const sh = last(st.highs);
  if (sl && lastC.low < sl.px && lastC.close > sl.px && f.lowerPct >= 0.4 && i - sl.i >= 2) {
    return mark(i, "sweep-up", "UP", 1, loc);
  }
  if (sh && lastC.high > sh.px && lastC.close < sh.px && f.upperPct >= 0.4 && i - sh.i >= 2) {
    return mark(i, "sweep-dn", "DOWN", 1, loc);
  }
  return null;
}

function mark(
  i: number,
  kind: MarkKind,
  lean: Lean,
  span: number,
  loc: "HIGH" | "LOW" | "MID",
): WickMark {
  return {
    i,
    kind,
    lean,
    span,
    loc,
    confirmed: false,
    pending: true,
    contextOk: false,
    confluence: 0,
  };
}

const BULL_REV = new Set<MarkKind>([
  "hammer",
  "dragonfly",
  "inv_ham",
  "engulf-up",
  "pierce",
  "tweezer-bot",
  "harami-up",
  "morn",
  "sweep-up",
]);
const BEAR_REV = new Set<MarkKind>([
  "shoot",
  "gravestone",
  "hanging",
  "pin",
  "engulf-down",
  "dark",
  "tweezer-top",
  "harami-dn",
  "even",
  "sweep-dn",
]);

function contextOf(m: WickMark): boolean {
  if (m.lean === "WAIT") return true;
  if (m.kind === "amd" || m.kind === "bos-up" || m.kind === "bos-dn") return true;
  if (BULL_REV.has(m.kind)) return m.loc === "LOW";
  if (BEAR_REV.has(m.kind)) return m.loc === "HIGH";
  return m.loc !== "MID";
}

function confirmOf(
  slice: Candle[],
  m: WickMark,
  closedEnd: number,
): { confirmed: boolean; pending: boolean } {
  if (m.lean === "WAIT") return { confirmed: true, pending: false };
  if (m.kind === "amd" || m.span >= 3) return { confirmed: true, pending: false };
  const nextI = m.i + 1;
  if (nextI >= closedEnd) return { confirmed: false, pending: true };
  const bar = slice[m.i]!;
  const next = slice[nextI]!;
  const ok = m.lean === "UP" ? next.close > bar.close : m.lean === "DOWN" ? next.close < bar.close : false;
  return { confirmed: ok, pending: false };
}

function confluenceOf(
  m: WickMark,
  rsi: number,
  emaFast: number,
  emaSlow: number,
  volConfirm: boolean,
  mtfTrend: StructureModel["trend"],
): number {
  let n = 0;
  let d = 0;
  const add = (ok: boolean) => {
    d += 1;
    if (ok) n += 1;
  };
  add(true);
  add(m.confirmed);
  add(m.loc !== "MID" || m.kind === "amd" || m.kind.startsWith("bos"));
  add(m.contextOk);
  add(volConfirm);
  add(m.lean === "UP" ? rsi <= 45 : m.lean === "DOWN" ? rsi >= 55 : true);
  add(
    mtfTrend === "RANGE" ||
      (m.lean === "UP" && mtfTrend === "UP") ||
      (m.lean === "DOWN" && mtfTrend === "DOWN") ||
      m.lean === "WAIT",
  );
  add(m.lean === "UP" ? emaFast >= emaSlow : m.lean === "DOWN" ? emaFast <= emaSlow : true);
  return d ? n / d : 0;
}

function qualifyMarks(
  slice: Candle[],
  marks: WickMark[],
  closedEnd: number,
  rsi: number,
  emaFast: number,
  emaSlow: number,
  volConfirm: boolean,
  mtfTrend: StructureModel["trend"],
) {
  for (const m of marks) {
    const c = confirmOf(slice, m, closedEnd);
    m.confirmed = c.confirmed;
    m.pending = c.pending;
    m.contextOk = contextOf(m);
    m.confluence = confluenceOf(m, rsi, emaFast, emaSlow, volConfirm, mtfTrend);
  }
}

export function readWick(bars: Candle[], mtfTrend: StructureModel["trend"] = "RANGE"): WickRead {
  const slice = bars.slice(-60);
  const emptyFeat: CandleFeat = {
    body: 0,
    range: 1,
    upper: 0,
    lower: 0,
    bodyPct: 0,
    upperPct: 0,
    lowerPct: 0,
    closePos: 0.5,
    bull: true,
    vol: 0,
  };
  if (!slice.length) {
    return {
      slice,
      lastName: "spin",
      lastFeat: emptyFeat,
      marks: [],
      amd: null,
      structure: { trend: "RANGE", highs: [], lows: [], bos: null, bosI: null },
      rsi: 50,
      emaFast: 0,
      emaSlow: 0,
      volConfirm: false,
      mtfTrend,
    };
  }
  const marks: WickMark[] = [];
  const closedEnd = slice[slice.length - 1]!.closed ? slice.length : slice.length - 1;
  for (let i = 0; i < closedEnd; i++) {
    const loc = locAt(slice, i);
    const name = classifySingle(candleFeat(slice[i]!), loc);
    const kind = singleMark(name);
    if (kind) {
      const lean: Lean =
        kind === "hammer" || kind === "dragonfly" || kind === "inv_ham"
          ? "UP"
          : kind === "shoot" || kind === "gravestone" || kind === "hanging" || kind === "pin"
            ? "DOWN"
            : "WAIT";
      marks.push(mark(i, kind, lean, 1, loc));
    }
    if (i >= 1 && i >= closedEnd - 16) {
      const prev = slice[i - 1]!;
      const bar = slice[i]!;
      const eng = engulfing(prev, bar);
      if (eng) marks.push(mark(i, eng === "UP" ? "engulf-up" : "engulf-down", eng, 2, loc));
      if (piercing(prev, bar) && loc !== "HIGH") marks.push(mark(i, "pierce", "UP", 2, loc));
      if (darkCloud(prev, bar) && loc !== "LOW") marks.push(mark(i, "dark", "DOWN", 2, loc));
      if (tweezer(prev, bar, "high") && loc === "HIGH" && i >= closedEnd - 3)
        marks.push(mark(i, "tweezer-top", "DOWN", 2, loc));
      if (tweezer(prev, bar, "low") && loc === "LOW" && i >= closedEnd - 3)
        marks.push(mark(i, "tweezer-bot", "UP", 2, loc));
      const har = harami(prev, bar);
      if (har) marks.push(mark(i, har === "UP" ? "harami-up" : "harami-dn", har, 2, loc));
    }
    if (i >= 2 && i >= closedEnd - 16) {
      const a = slice[i - 2]!;
      const b = slice[i - 1]!;
      const c = slice[i]!;
      if (morningStar(a, b, c)) marks.push(mark(i, "morn", "UP", 3, loc));
      if (eveningStar(a, b, c)) marks.push(mark(i, "even", "DOWN", 3, loc));
      if (threeRun(a, b, c, true)) marks.push(mark(i, "soldiers", "UP", 3, loc));
      if (threeRun(a, b, c, false)) marks.push(mark(i, "crows", "DOWN", 3, loc));
    }
  }
  const structure = structureOf(slice);
  if (structure.bos && structure.bosI != null) {
    marks.push(
      mark(
        structure.bosI,
        structure.bos === "UP" ? "bos-up" : "bos-dn",
        structure.bos,
        1,
        locAt(slice, structure.bosI),
      ),
    );
  }
  const sweep = liquiditySweep(slice.slice(0, closedEnd), structure);
  if (sweep) marks.push(sweep);
  const amd = amdOf(slice.slice(0, closedEnd));
  if (amd && amd.phase !== "ACCUMULATION") {
    const i = amd.distI ?? amd.manipI ?? amd.acc.i1;
    marks.push(mark(i, "amd", amd.lean, amd.acc.i1 - amd.acc.i0 + 1, locAt(slice, i)));
  }
  const lastI = Math.max(0, closedEnd - 1);
  const lastC = slice[lastI]!;
  const lastFeat = candleFeat(lastC);
  const lastName = classifySingle(lastFeat, locAt(slice, lastI));
  const closes = slice.map((c) => c.close);
  const vols = slice.map((c) => c.volume);
  const medVol = [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)] ?? 1;
  const rsi = rsi14(closes);
  const emaFast = ema(closes, 8);
  const emaSlow = ema(closes, 21);
  const volConfirm = lastC.volume >= medVol * 1.4;
  qualifyMarks(slice, marks, closedEnd, rsi, emaFast, emaSlow, volConfirm, mtfTrend);
  return {
    slice,
    lastName,
    lastFeat,
    marks,
    amd,
    structure,
    rsi,
    emaFast,
    emaSlow,
    volConfirm,
    mtfTrend,
  };
}

export function lastMark(read: WickRead, kind: MarkKind | MarkKind[]): WickMark | undefined {
  const set = new Set(Array.isArray(kind) ? kind : [kind]);
  const minI = read.slice.length - 6;
  let pending: WickMark | undefined;
  for (let i = read.marks.length - 1; i >= 0; i--) {
    const m = read.marks[i]!;
    if (!set.has(m.kind) || m.i < minI) continue;
    if (m.confirmed && m.contextOk) return m;
    if (!pending) pending = m;
  }
  return pending;
}

export function readyOf(read: WickRead, kind: MarkKind | MarkKind[]): WickMark | undefined {
  const m = lastMark(read, kind);
  if (m && m.confirmed && m.contextOk) return m;
  return undefined;
}
