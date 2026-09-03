import { clamp } from "./math";
import type { Lean, Snapshot, TapeRow, WfRow } from "./types";

export type { TapeRow, WfRow };

export function tapeVec(snap: Snapshot): number[] {
  const vol = snap.vol_median > 0 ? snap.vol_last / snap.vol_median : 1;
  const sess = { ASIA: 0.15, EUROPE: 0.4, US_AM: 0.7, US_PM: 0.9 }[snap.session] ?? 0.5;
  const loc = snap.location === "HIGH" ? 1 : snap.location === "LOW" ? 0 : 0.5;
  return [
    (snap.yes_mid || 50) / 100,
    clamp(snap.range_pos, 0, 1),
    clamp(vol / 3, 0, 1),
    sess,
    clamp(snap.mins_left / 15, 0, 1),
    loc,
    clamp(0.5 + (snap.funding_rate || 0) * 200, 0, 1),
    clamp(0.5 + (snap.ret15 || 0) * 40, 0, 1),
  ];
}

function dist(a: number[], b: number[]) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
}

export function rememberTape(tapes: TapeRow[] | undefined, snap: Snapshot, finish: "UP" | "DOWN"): TapeRow[] {
  const row: TapeRow = { v: tapeVec(snap), finish, t: snap.close_time };
  return [...(tapes ?? []), row].slice(-200);
}

export function knnRead(
  tapes: TapeRow[] | undefined,
  snap: Snapshot,
  k = 8,
): { n: number; up: number; down: number; against: (lean: Lean) => number; note: string } {
  const book = tapes ?? [];
  if (!book.length) {
    return { n: 0, up: 0, down: 0, against: () => 0.5, note: "no cousins yet" };
  }
  const v = tapeVec(snap);
  const ranked = book
    .map((t) => ({ t, d: dist(v, t.v) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  const n = ranked.length;
  const up = ranked.filter((x) => x.t.finish === "UP").length;
  const down = n - up;
  return {
    n,
    up,
    down,
    against: (lean) => {
      if (lean === "UP") return down / n;
      if (lean === "DOWN") return up / n;
      return 0.5;
    },
    note: `${n} cousins · ${up} settled UP · ${down} DOWN`,
  };
}

export function walkForward(rows: WfRow[] | undefined): {
  n: number;
  train_n: number;
  test_n: number;
  train_hit: number;
  train_ev: number;
  test_hit: number;
  test_ev: number;
} | null {
  const xs = rows ?? [];
  if (xs.length < 16) return null;
  const cut = Math.max(8, Math.floor(xs.length * 0.6));
  const train = xs.slice(0, cut);
  const test = xs.slice(cut);
  if (!test.length) return null;
  const avg = (arr: WfRow[], key: "hit" | "cents") =>
    arr.reduce((s, x) => s + x[key], 0) / arr.length;
  return {
    n: xs.length,
    train_n: train.length,
    test_n: test.length,
    train_hit: avg(train, "hit"),
    train_ev: avg(train, "cents"),
    test_hit: avg(test, "hit"),
    test_ev: avg(test, "cents"),
  };
}
