export type HistPoint = { t: number; v: number };

export const OI_PERIOD_MS = 5 * 60_000;
export const FUNDING_PERIOD_MS = 8 * 3600_000;

export function asMs(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return t < 1e12 ? t * 1000 : t;
}

export function uniqueByT(pts: HistPoint[]): HistPoint[] {
  const m = new Map<number, HistPoint>();
  for (const p of pts) {
    if (p.t > 0 && Number.isFinite(p.v)) m.set(p.t, p);
  }
  return [...m.values()].sort((a, b) => a.t - b.t);
}

export function sortSeries(pts: HistPoint[]): HistPoint[] {
  return uniqueByT(pts);
}

export function valuesOf(pts: HistPoint[]): number[] {
  return pts.map((p) => p.v);
}

export function atOrBefore(pts: HistPoint[], t: number): HistPoint | null {
  let hit: HistPoint | null = null;
  for (const p of pts) {
    if (p.t <= t) hit = p;
    else break;
  }
  return hit;
}

/**
 * Value at `now` minus value at `now − ms`.
 * Returns 0 unless the two samples are at least half the window apart —
 * so three polls 4s apart cannot masquerade as a 3-minute delta.
 */
export function deltaOver(pts: HistPoint[], ms: number, now?: number): number {
  if (pts.length < 2 || ms <= 0) return 0;
  const end = now ?? pts[pts.length - 1]!.t;
  const a = atOrBefore(pts, end);
  const b = atOrBefore(pts, end - ms);
  if (!a || !b || a.t === b.t) return 0;
  if (a.t - b.t < ms * 0.5) return 0;
  return a.v - b.v;
}

/** Median gap between prints, snapped to 1h / 4h / 8h funding cadences. */
export function nativePeriodMs(pts: HistPoint[], fallback = FUNDING_PERIOD_MS): number {
  if (pts.length < 2) return fallback;
  const dts: number[] = [];
  for (let i = 1; i < pts.length; i++) dts.push(pts[i]!.t - pts[i - 1]!.t);
  dts.sort((a, b) => a - b);
  const med = dts[Math.floor(dts.length / 2)]!;
  if (med >= 50 * 60_000 && med <= 90 * 60_000) return 60 * 60_000;
  if (med >= 3.5 * 3600_000 && med <= 5 * 3600_000) return 4 * 3600_000;
  if (med >= 6 * 3600_000 && med <= 10 * 3600_000) return 8 * 3600_000;
  return fallback;
}

/**
 * Append a venue-period print. Same fundingTime / OI bucket, or an identical
 * snapshot inside one native period, is not new information.
 */
export function appendPeriod(
  pts: HistPoint[],
  t: number,
  v: number,
  periodMs: number,
): HistPoint[] {
  if (!Number.isFinite(v) || t <= 0) return pts;
  const last = pts.at(-1);
  if (last) {
    if (last.t === t) return pts;
    if (t - last.t < periodMs * 0.75) return pts;
    if (last.v === v && t - last.t < periodMs * 1.1) return pts;
  }
  return uniqueByT([...pts, { t, v }]).slice(-48);
}

export function spaced(values: number[], lastT: number, stepMs: number): HistPoint[] {
  const n = values.length;
  return values.map((v, i) => ({ t: lastT - (n - 1 - i) * stepMs, v }));
}
