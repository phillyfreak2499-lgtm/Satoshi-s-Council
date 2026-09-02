import type { Candle, Lean, Phase, SessionName } from "./types";

export const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export const round = (n: number, d = 0) => {
  const p = 10 ** d;
  return Math.round(n * p) / p;
};

export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

export function ret(candles: Candle[], bars: number): number {
  if (candles.length < bars + 1) {
    if (candles.length < 2) return 0;
    const a = candles[0]!.close;
    const b = last(candles)!.close;
    return a ? (b - a) / a : 0;
  }
  const a = candles[candles.length - 1 - bars]!.close;
  const b = last(candles)!.close;
  return a ? (b - a) / a : 0;
}

export function atr(candles: Candle[], n = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  const slice = candles.slice(-n - 1);
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i]!;
    const p = slice[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return mean(trs);
}

export function volPercentile(vols: number[], lastVol: number): number {
  if (!vols.length) return 50;
  const below = vols.filter((v) => v <= lastVol).length;
  return (below / vols.length) * 100;
}

export function locationOf(candles: Candle[]): {
  location: "HIGH" | "LOW" | "MID";
  range_pos: number;
} {
  const slice = candles.slice(-20);
  if (slice.length < 4) return { location: "MID", range_pos: 0.5 };
  const hi = Math.max(...slice.map((c) => c.high));
  const lo = Math.min(...slice.map((c) => c.low));
  const close = last(slice)!.close;
  const span = hi - lo;
  const pos = span > 0 ? (close - lo) / span : 0.5;
  const location = pos >= 0.8 ? "HIGH" : pos <= 0.2 ? "LOW" : "MID";
  return { location, range_pos: pos };
}

export function aggregate(candles: Candle[], bucketMs: number): Candle[] {
  if (!candles.length) return [];
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let bucket = -1;
  for (const c of candles) {
    const b = Math.floor(c.t / bucketMs);
    if (b !== bucket) {
      if (cur) out.push({ ...cur, closed: true });
      bucket = b;
      cur = { ...c, t: b * bucketMs };
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
      cur.closed = c.closed;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function wilsonLower(hits: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return clamp((center - margin) / denom, 0, 1);
}

export function phaseOf(mins: number): Phase {
  if (mins > 12) return "ENTRY";
  if (mins >= 4) return "MID";
  return "FINAL";
}

export function sessionOf(ts: number): SessionName {
  const h = new Date(ts).getUTCHours();
  if (h >= 0 && h < 7) return "ASIA";
  if (h >= 7 && h < 13) return "EUROPE";
  if (h >= 13 && h < 17) return "US_AM";
  return "US_PM";
}

export function phaseMult(phase: Phase): number {
  if (phase === "ENTRY") return 0.85;
  if (phase === "FINAL") return 1.1;
  return 1;
}

export function healthMult(ageS: number, liveMax: number): number {
  if (!Number.isFinite(ageS) || ageS > liveMax * 8) return 0;
  if (ageS > liveMax) return 0.6;
  return 1;
}

export function directionalConf(
  edge: number,
  phase: Phase,
  health: number,
  opts?: { unclosed?: boolean; midRange?: boolean; cap?: number },
): number {
  const raw = clamp(edge, 0, 1);
  let conf = 100 * raw ** 1.15 * phaseMult(phase) * health;
  if (opts?.unclosed) conf = Math.min(conf, 40);
  if (opts?.midRange) conf = Math.min(conf, 25);
  if (opts?.cap != null) conf = Math.min(conf, opts.cap);
  return Math.round(clamp(conf, 0, 92));
}

export function signOf(n: number): Lean | "FLAT" {
  if (n > 0) return "UP";
  if (n < 0) return "DOWN";
  return "FLAT";
}

export function opposite(lean: Lean): Lean {
  if (lean === "UP") return "DOWN";
  if (lean === "DOWN") return "UP";
  return "WAIT";
}

export function fmtPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function fmtC(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}¢`;
}

export function fmtPct(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "—";
  const s = (n * 100).toFixed(d);
  return `${n >= 0 ? "+" : ""}${s}%`;
}

export function fmtBps(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)} bps`;
}

export function fmtAge(s: number): string {
  if (!Number.isFinite(s)) return "—";
  if (s < 10) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}

export function clockMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function chicagoNow(ts = Date.now()): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function patternOf(c: Candle): {
  pattern: string;
  bodyPct: number;
  upperPct: number;
  lowerPct: number;
  range: number;
  bull: boolean;
} {
  const range = Math.max(1e-9, c.high - c.low);
  const body = Math.abs(c.close - c.open);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  const bodyPct = body / range;
  const upperPct = upper / range;
  const lowerPct = lower / range;
  const bull = c.close >= c.open;
  let pattern = "spin";
  if (bodyPct < 0.12) pattern = "doji";
  else if (upperPct >= 0.55 && bodyPct <= 0.45) pattern = "pin";
  else if (lowerPct >= 0.55 && bodyPct <= 0.45) pattern = "hammer";
  else if (bodyPct >= 0.72 && upperPct < 0.12 && lowerPct < 0.12) pattern = "marubozu";
  else if (bodyPct >= 0.5) pattern = "body";
  return { pattern, bodyPct, upperPct, lowerPct, range, bull };
}

export function engulf(prev: Candle, lastC: Candle): "UP" | "DOWN" | null {
  const prevBull = prev.close >= prev.open;
  const lastBull = lastC.close >= lastC.open;
  if (lastBull && !prevBull && lastC.close >= prev.open && lastC.open <= prev.close)
    return "UP";
  if (!lastBull && prevBull && lastC.close <= prev.open && lastC.open >= prev.close)
    return "DOWN";
  return null;
}

export function binKey(conf: number): string {
  if (conf < 60) return "50-60";
  if (conf < 70) return "60-70";
  if (conf < 80) return "70-80";
  return "80-92";
}

export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
