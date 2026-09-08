import { clamp, median, wilsonLower } from "./math";
import type { LearnPhase, Learner, ThreshBook, ThreshPocket, ThreshState } from "./types";

export type ThreshSpec = {
  base: number;
  lo: number;
  hi: number;
  dir: "gte" | "lte";
  label: string;
};

export const THRESH_SPECS: Record<string, ThreshSpec> = {
  "wick.upper": { base: 0.55, lo: 0.4, hi: 0.75, dir: "gte", label: "pin wick / range" },
  "wick.lower": { base: 0.55, lo: 0.4, hi: 0.75, dir: "gte", label: "hammer wick / range" },
  "ret15.min": { base: 0.0025, lo: 0.0012, hi: 0.005, dir: "gte", label: "|ret15| min" },
  "vol.spike": { base: 2.2, lo: 1.5, hi: 3.5, dir: "gte", label: "vol spike ×" },
  "vol.dry": { base: 0.45, lo: 0.25, hi: 0.65, dir: "lte", label: "vol dry-up ×" },
  "whale.vol": { base: 2.5, lo: 1.8, hi: 4, dir: "gte", label: "whale proxy ×" },
  "cheap.cents": { base: 42, lo: 32, hi: 48, dir: "lte", label: "cheap ¢" },
  "fade.rip": { base: 8, lo: 5, hi: 14, dir: "gte", label: "YES rip ¢" },
  "atr.dead": { base: 0.12, lo: 0.06, hi: 0.22, dir: "lte", label: "dead ATR%" },
  "vol.dead_pct": { base: 25, lo: 12, hi: 40, dir: "lte", label: "dead vol pct" },
  "streak.ext": { base: 5, lo: 4, hi: 8, dir: "gte", label: "streak fade n" },
  "run.1h": { base: 0.007, lo: 0.005, hi: 0.02, dir: "gte", label: "|1h ret|" },
  "magnet.mins": { base: 2.2, lo: 1.4, hi: 3.5, dir: "lte", label: "magnet minutes" },
  "fng.lo": { base: 20, lo: 12, hi: 28, dir: "lte", label: "F&G fear" },
  "fng.hi": { base: 80, lo: 72, hi: 88, dir: "gte", label: "F&G greed" },
  "lead.bps": { base: 4, lo: 2, hi: 10, dir: "gte", label: "spot lead bps" },
  "funding.ext": { base: 0.0002, lo: 0.00008, hi: 0.0005, dir: "gte", label: "|funding| extreme" },
  "atr.expand": { base: 0.22, lo: 0.14, hi: 0.35, dir: "gte", label: "expand ATR%" },
  "vol.hot_pct": { base: 80, lo: 65, hi: 92, dir: "gte", label: "hot vol pct" },
};

export function freshThresholds(): ThreshBook {
  const book: ThreshBook = {};
  for (const [id, s] of Object.entries(THRESH_SPECS)) {
    book[id] = { value: s.base, by_regime: {} };
  }
  return book;
}

export function mergeThresholds(saved?: ThreshBook | null): ThreshBook {
  const book = freshThresholds();
  if (!saved) return book;
  for (const id of Object.keys(book)) {
    const s = saved[id];
    if (!s) continue;
    book[id] = {
      value: Number.isFinite(s.value) ? s.value : book[id]!.value,
      by_regime: { ...(s.by_regime ?? {}) },
    };
  }
  return book;
}

export function threshOf(learner: Learner, id: string, regime?: string): number {
  const spec = THRESH_SPECS[id];
  const st = learner.thresholds?.[id];
  if (!spec) return st?.value ?? 0;
  if (!st) return spec.base;
  const rk = regime ?? "";
  const pocket = rk ? st.by_regime[rk] : undefined;
  if (pocket && (pocket.samples?.length ?? 0) >= 6) return pocket.value;
  return st.value;
}

function pocketOf(st: ThreshState, regime: string): ThreshPocket {
  const p = st.by_regime[regime];
  if (p) {
    if (!p.samples) p.samples = [];
    return p;
  }
  const fresh: ThreshPocket = { value: st.value, samples: [] };
  st.by_regime[regime] = fresh;
  return fresh;
}

export function recordThresh(
  learner: Learner,
  id: string,
  regime: string,
  x: number,
  hit: number,
) {
  if (!Number.isFinite(x) || !learner.thresholds) return;
  const spec = THRESH_SPECS[id];
  if (!spec) return;
  if (!learner.thresholds[id]) {
    learner.thresholds[id] = { value: spec.base, by_regime: {} };
  }
  const st = learner.thresholds[id]!;
  const p = pocketOf(st, regime);
  p.samples = [...p.samples, { x, hit }].slice(-32);
}

export function nudgeThresh(
  learner: Learner,
  id: string,
  regime: string,
  x: number,
  hit: number,
) {
  const spec = THRESH_SPECS[id];
  const st = learner.thresholds?.[id];
  if (!spec || !st || !Number.isFinite(x)) return;
  const p = pocketOf(st, regime);
  const phase: LearnPhase = learner.learn_phase;
  const tighten = phase === "EXPLORE" ? 0.08 : phase === "CALIBRATE" ? 0.05 : 0.03;
  const relax = phase === "EXPLORE" ? 0.03 : phase === "CALIBRATE" ? 0.02 : 0.01;
  let next = p.value;
  if (spec.dir === "gte") {
    if (!hit) next = p.value + tighten * spec.base;
    else if (x <= p.value * 1.2) next = p.value - relax * spec.base;
  } else {
    if (!hit) next = p.value - tighten * spec.base;
    else if (x >= p.value * 0.85) next = p.value + relax * spec.base;
  }
  const cap = spec.base * (phase === "EXPLOIT" ? 0.08 : phase === "CALIBRATE" ? 0.14 : 0.22);
  next = clamp(next, spec.base - cap, spec.base + cap);
  p.value = clamp(next, spec.lo, spec.hi);
  const vs = Object.values(st.by_regime).map((q) => q.value);
  if (vs.length) st.value = median(vs);
}

function searchT(
  samples: { x: number; hit: number }[],
  spec: ThreshSpec,
): number | null {
  const xs = [...new Set(samples.map((s) => s.x))].sort((a, b) => a - b);
  const cands = [spec.base, spec.lo, spec.hi, ...xs];
  let bestT: number | null = null;
  let bestW = -1;
  for (const t of cands) {
    if (t < spec.lo || t > spec.hi) continue;
    let n = 0;
    let hits = 0;
    for (const s of samples) {
      const pass = spec.dir === "gte" ? s.x >= t : s.x <= t;
      if (!pass) continue;
      n += 1;
      hits += s.hit;
    }
    if (n < 6) continue;
    const w = wilsonLower(hits, n);
    if (w > bestW) {
      bestW = w;
      bestT = t;
    }
  }
  return bestT;
}

export function retuneThresholds(learner: Learner): string[] {
  const notes: string[] = [];
  if (!learner.thresholds) return notes;
  const phase = learner.learn_phase;
  const moveCap = phase === "EXPLORE" ? 0.22 : phase === "CALIBRATE" ? 0.14 : 0.08;
  for (const [id, spec] of Object.entries(THRESH_SPECS)) {
    const st = learner.thresholds[id];
    if (!st) continue;
    for (const [rk, pocket] of Object.entries(st.by_regime)) {
      if ((pocket.samples?.length ?? 0) < 8) continue;
      const best = searchT(pocket.samples, spec);
      if (best == null) continue;
      const cap = spec.base * moveCap;
      const limited = clamp(best, spec.base - cap, spec.base + cap);
      const next = clamp(0.6 * pocket.value + 0.4 * limited, spec.lo, spec.hi);
      const rel = Math.abs(next - pocket.value) / Math.max(Math.abs(spec.base), 1e-6);
      if (rel >= 0.02) {
        notes.push(`${id}@${rk} ${pocket.value.toFixed(3)}→${next.toFixed(3)}`);
      }
      pocket.value = next;
    }
    const vs = Object.values(st.by_regime).map((q) => q.value);
    if (vs.length) st.value = median(vs);
  }
  return notes;
}
