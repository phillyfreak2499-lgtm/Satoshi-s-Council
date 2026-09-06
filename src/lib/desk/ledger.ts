import { clamp, wilsonLower } from "./math";
import { MARK_LABEL, type MarkKind, type WickMark, type WickRead } from "./patterns";
import type { Lean, PatternStat } from "./types";

export function blankPattern(): PatternStat {
  return { n: 0, hits: 0, wilson: 0, ev_sum: 0, ev_n: 0, ev: 0, last20: [] };
}

export function refreshPattern(st: PatternStat): PatternStat {
  st.wilson = st.n > 0 ? wilsonLower(st.hits, st.n) : 0;
  st.ev = st.ev_n > 0 ? st.ev_sum / st.ev_n : 0;
  return st;
}

export function creditPattern(book: Record<string, PatternStat>, kind: string, lean: Lean, finish: "UP" | "DOWN", cents: number) {
  if (lean !== "UP" && lean !== "DOWN") return;
  const st = book[kind] ?? blankPattern();
  const hit = lean === finish ? 1 : 0;
  st.n += 1;
  st.hits += hit;
  st.last20 = [...st.last20, hit].slice(-20);
  st.ev_sum += cents;
  st.ev_n += 1;
  book[kind] = refreshPattern(st);
}

export type PatternTrust = {
  n: number;
  hits: number;
  wilson: number;
  ev: number;
  uncalibrated: boolean;
  fold: boolean;
  mul: number;
  cap: number | undefined;
  label: "n<8" | "FOLD" | "LIVE";
};

export function patternTrust(st?: PatternStat): PatternTrust {
  const n = st?.n ?? 0;
  const hits = st?.hits ?? 0;
  const wilson = st?.wilson ?? 0;
  const ev = st?.ev ?? 0;
  const uncalibrated = n < 8;
  const fold = n >= 12 && (wilson < 0.4 || (st != null && st.ev_n >= 8 && ev < -1.8));
  const mul = uncalibrated ? 0.85 : clamp(0.5 + wilson, 0.45, 1.15);
  return {
    n,
    hits,
    wilson,
    ev,
    uncalibrated,
    fold,
    mul,
    cap: uncalibrated ? 52 : undefined,
    label: fold ? "FOLD" : uncalibrated ? "n<8" : "LIVE",
  };
}

export function snapshotSetups(read: WickRead): { kind: string; lean: Lean }[] {
  const n = read.slice.length;
  const closedEnd = read.slice[n - 1]?.closed ? n : n - 1;
  const seen = new Map<string, Lean>();
  for (const m of read.marks) {
    if (m.lean !== "UP" && m.lean !== "DOWN") continue;
    if (m.i < closedEnd - 6) continue;
    seen.set(MARK_LABEL[m.kind], m.lean);
  }
  return [...seen.entries()].map(([kind, lean]) => ({ kind, lean }));
}

export function rememberPatterns(book: { window_patterns: { kind: string; lean: Lean }[] }, read: WickRead) {
  const map = new Map(book.window_patterns.map((p) => [p.kind, p]));
  for (const p of snapshotSetups(read)) map.set(p.kind, p);
  book.window_patterns = [...map.values()].slice(-10);
}

export function skillToKinds(id: string): MarkKind[] | null {
  switch (id) {
    case "WICK.pin_at_high":
      return ["pin", "shoot", "gravestone", "hanging"];
    case "WICK.hammer_at_low":
      return ["hammer", "dragonfly", "inv_ham"];
    case "WICK.engulf_at_extreme":
      return ["engulf-up", "engulf-down"];
    case "WICK.amd":
      return ["amd"];
    case "WICK.liq_sweep":
      return ["sweep-up", "sweep-dn"];
    case "WICK.morning_star":
      return ["morn"];
    case "WICK.evening_star":
      return ["even"];
    case "WICK.tweezer":
      return ["tweezer-top", "tweezer-bot"];
    case "WICK.bos_close":
      return ["bos-up", "bos-dn"];
    default:
      return null;
  }
}

export function ledgerRows(
  book: Record<string, PatternStat>,
  seeing: string[],
): (PatternStat & { kind: string; trust: PatternTrust })[] {
  const keys = new Set([...Object.keys(book), ...seeing]);
  const rows = [...keys].map((kind) => {
    const st = refreshPattern({ ...(book[kind] ?? blankPattern()) });
    return { kind, ...st, trust: patternTrust(st) };
  });
  rows.sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind));
  return rows.slice(0, 10);
}
