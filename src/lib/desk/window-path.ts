/**
 * Measurement-only description of the spot path inside one 15-minute window.
 *
 * This module is pure. It consumes an already-recorded replay after the window
 * is graded, writes no state, imports no seat/Chair/learner code, and grants no
 * authority. Missing time is reported as missing rather than interpolated across
 * a feed gap.
 */

export const WINDOW_PATH_VERSION = "path-v1" as const;
export const WINDOW_PATH_MS = 15 * 60_000;
export const MAX_INTEGRATION_GAP_MS = 12_000;
const BOUNDARY_TOLERANCE_MS = 12_000;
const FLAT_MINUTE_BPS = 0.5;
const STRIKE_EPSILON = 0.005;

export type WindowPathQuality = "complete" | "partial";

export type WindowPathStats = {
  version: typeof WINDOW_PATH_VERSION;
  source: "replay-spot";
  quality: WindowPathQuality;
  n: number;
  observed_s: number;
  integrated_s: number;
  unmeasured_s: number;
  coverage_ratio: number;
  max_gap_s: number;
  strike_crossings: number;
  time_above_s: number;
  time_below_s: number;
  time_at_strike_s: number;
  longest_above_s: number;
  longest_below_s: number;
  minute_direction_changes: number;
  minute_up: number;
  minute_down: number;
  minute_flat: number;
  net_move_bps: number;
  gross_move_bps: number;
  path_efficiency: number;
  largest_sample_jump_bps: number;
  largest_jump_share: number;
  early_move_bps: number | null;
  middle_move_bps: number | null;
  final_move_bps: number | null;
};

export type WindowPathInput = {
  t0: number;
  /** Seconds after t0, as stored in replay. */
  t: readonly number[];
  spot: readonly number[];
  strike: number;
  close_time: number;
};

type Point = { t: number; px: number };
type Side = "above" | "below" | "at" | "unknown";

export function measureWindowPath(input: WindowPathInput): WindowPathStats | null {
  if (
    !Number.isFinite(input.t0) ||
    !Number.isFinite(input.strike) ||
    !(input.strike > 0) ||
    !Number.isFinite(input.close_time) ||
    input.t.length < 3 ||
    input.t.length !== input.spot.length
  ) {
    return null;
  }

  const points: Point[] = [];
  for (let i = 0; i < input.t.length; i += 1) {
    const off = input.t[i]!;
    const px = input.spot[i]!;
    if (!Number.isFinite(off) || !Number.isFinite(px) || !(px > 0)) return null;
    const t = input.t0 + off * 1000;
    if (points.length && t <= points[points.length - 1]!.t) return null;
    points.push({ t, px });
  }

  const openTime = input.close_time - WINDOW_PATH_MS;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const observedStart = Math.max(openTime, first.t);
  const observedEnd = Math.min(input.close_time, last.t);
  if (!(observedEnd > observedStart)) return null;

  let aboveMs = 0;
  let belowMs = 0;
  let atMs = 0;
  let integratedMs = 0;
  let unmeasuredMs = 0;
  let grossBps = 0;
  let largestJumpBps = 0;
  let maxGapMs = 0;
  let currentSide: Side = "unknown";
  let currentRunMs = 0;
  let longestAboveMs = 0;
  let longestBelowMs = 0;

  const add = (side: Side, ms: number) => {
    if (!(ms > 0)) return;
    if (side === "unknown") {
      currentSide = "unknown";
      currentRunMs = 0;
      return;
    }
    if (side === "above") aboveMs += ms;
    else if (side === "below") belowMs += ms;
    else atMs += ms;

    if (side === currentSide) currentRunMs += ms;
    else {
      currentSide = side;
      currentRunMs = ms;
    }
    if (side === "above") longestAboveMs = Math.max(longestAboveMs, currentRunMs);
    if (side === "below") longestBelowMs = Math.max(longestBelowMs, currentRunMs);
  };

  for (let i = 1; i < points.length; i += 1) {
    const rawA = points[i - 1]!;
    const rawB = points[i]!;
    const start = Math.max(rawA.t, openTime);
    const end = Math.min(rawB.t, input.close_time);
    if (!(end > start)) continue;

    const gapMs = rawB.t - rawA.t;
    maxGapMs = Math.max(maxGapMs, gapMs);
    const jumpBps = Math.abs(rawB.px - rawA.px) / rawA.px * 10_000;
    grossBps += jumpBps;
    largestJumpBps = Math.max(largestJumpBps, jumpBps);

    const dt = end - start;
    if (gapMs > MAX_INTEGRATION_GAP_MS) {
      unmeasuredMs += dt;
      add("unknown", dt);
      continue;
    }

    integratedMs += dt;
    const da = signedDistance(rawA.px, input.strike);
    const db = signedDistance(rawB.px, input.strike);
    const sa = sideOf(da);
    const sb = sideOf(db);

    if (sa === sb) {
      add(sa, dt);
    } else if (sa === "at") {
      add(sb, dt);
    } else if (sb === "at") {
      add(sa, dt);
    } else {
      const firstShare = Math.abs(da) / (Math.abs(da) + Math.abs(db));
      add(sa, dt * firstShare);
      add(sb, dt * (1 - firstShare));
    }
  }

  let crossings = 0;
  let prior: "above" | "below" | null = null;
  for (const point of points) {
    if (point.t < openTime || point.t > input.close_time) continue;
    const side = sideOf(signedDistance(point.px, input.strike));
    if (side === "at") continue;
    if (prior && side !== prior) crossings += 1;
    prior = side;
  }

  const minuteDirections: number[] = [];
  for (let minute = 0; minute < 15; minute += 1) {
    const lo = openTime + minute * 60_000;
    const hi = lo + 60_000;
    const bucket = points.filter((point) => point.t >= lo && point.t < hi);
    if (bucket.length < 2) continue;
    const bps = moveBps(bucket[0]!.px, bucket[bucket.length - 1]!.px);
    minuteDirections.push(Math.abs(bps) < FLAT_MINUTE_BPS ? 0 : bps > 0 ? 1 : -1);
  }
  let minuteChanges = 0;
  let priorMinute = 0;
  for (const direction of minuteDirections) {
    if (direction === 0) continue;
    if (priorMinute !== 0 && direction !== priorMinute) minuteChanges += 1;
    priorMinute = direction;
  }

  const observedMs = observedEnd - observedStart;
  const coverage = observedMs / WINDOW_PATH_MS;
  const startGap = Math.max(0, first.t - openTime);
  const endGap = Math.max(0, input.close_time - last.t);
  const quality: WindowPathQuality =
    coverage >= 0.9 &&
    startGap <= 60_000 &&
    endGap <= 15_000 &&
    maxGapMs <= MAX_INTEGRATION_GAP_MS
      ? "complete"
      : "partial";

  const firstInWindow = points.find((point) => point.t >= openTime) ?? first;
  const lastInWindow = [...points].reverse().find((point) => point.t <= input.close_time) ?? last;
  const netBps = moveBps(firstInWindow.px, lastInWindow.px);
  const totalTime = aboveMs + belowMs + atMs + unmeasuredMs;

  return {
    version: WINDOW_PATH_VERSION,
    source: "replay-spot",
    quality,
    n: points.length,
    observed_s: r1(observedMs / 1000),
    integrated_s: r1(integratedMs / 1000),
    unmeasured_s: r1(unmeasuredMs / 1000),
    coverage_ratio: r3(coverage),
    max_gap_s: r1(maxGapMs / 1000),
    strike_crossings: crossings,
    time_above_s: r1(aboveMs / 1000),
    time_below_s: r1(belowMs / 1000),
    time_at_strike_s: r1(atMs / 1000),
    longest_above_s: r1(longestAboveMs / 1000),
    longest_below_s: r1(longestBelowMs / 1000),
    minute_direction_changes: minuteChanges,
    minute_up: minuteDirections.filter((x) => x > 0).length,
    minute_down: minuteDirections.filter((x) => x < 0).length,
    minute_flat: minuteDirections.filter((x) => x === 0).length,
    net_move_bps: r2(netBps),
    gross_move_bps: r2(grossBps),
    path_efficiency: r3(grossBps > 0 ? Math.abs(netBps) / grossBps : 0),
    largest_sample_jump_bps: r2(largestJumpBps),
    largest_jump_share: r3(grossBps > 0 ? largestJumpBps / grossBps : 0),
    early_move_bps: thirdMove(points, openTime, 0),
    middle_move_bps: thirdMove(points, openTime, 1),
    final_move_bps: thirdMove(points, openTime, 2),
  };
}

function signedDistance(px: number, strike: number): number {
  const distance = px - strike;
  return Math.abs(distance) <= STRIKE_EPSILON ? 0 : distance;
}

function sideOf(distance: number): Exclude<Side, "unknown"> {
  return distance > 0 ? "above" : distance < 0 ? "below" : "at";
}

function thirdMove(points: readonly Point[], openTime: number, third: 0 | 1 | 2): number | null {
  const a = nearest(points, openTime + third * 5 * 60_000);
  const b = nearest(points, openTime + (third + 1) * 5 * 60_000);
  return a && b ? r2(moveBps(a.px, b.px)) : null;
}

function nearest(points: readonly Point[], target: number): Point | null {
  let best: Point | null = null;
  let distance = Infinity;
  for (const point of points) {
    const d = Math.abs(point.t - target);
    if (d < distance) {
      best = point;
      distance = d;
    }
  }
  return distance <= BOUNDARY_TOLERANCE_MS ? best : null;
}

function moveBps(from: number, to: number): number {
  return from > 0 ? (to - from) / from * 10_000 : 0;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
