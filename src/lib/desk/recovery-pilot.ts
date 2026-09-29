/**
 * Owner-authorized, paper-only recovery pilot.
 *
 * This deliberately does not impersonate the Chair. It publishes a bounded
 * price-favourite paper position only after a stable, fresh book has held for
 * three frames over eight seconds. Every row carries `source`, which keeps it
 * outside the canonical main-Chair follower contract.
 */
import { dailyAdmission, hasPaperPosition } from "./selective-entry.ts";
import type { CallLogRow, Snapshot } from "./types";

export const RECOVERY_PILOT_SOURCE = "RECOVERY_FAV85_V1" as const;
export const RECOVERY_PILOT_MIN_ASK = 85;
export const RECOVERY_PILOT_MAX_ASK = 94.9;
export const RECOVERY_PILOT_MAX_CALLS_PER_DAY = 3;
export const RECOVERY_PILOT_MIN_SECS_LEFT = 300;
export const RECOVERY_PILOT_MAX_SECS_LEFT = 450;
export const RECOVERY_PILOT_CONFIRM_FRAMES = 3;
export const RECOVERY_PILOT_CONFIRM_MS = 8_000;

export type RecoveryPilotCandidate = {
  side: "UP" | "DOWN";
  ask: number;
  spread: number;
  touch: number;
};

export type RecoveryPilotWatch = {
  key: string;
  side: "UP" | "DOWN";
  since: number;
  last: number;
  frames: number;
};

export type RecoveryPilotContext = {
  calls: CallLogRow[];
  ready: boolean;
  start: number;
  watch: RecoveryPilotWatch | null;
};

export type RecoveryPilotDecision = {
  candidate: RecoveryPilotCandidate | null;
  watch: RecoveryPilotWatch | null;
  eligible: boolean;
  reason: string | null;
};

export function recoveryPilotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RECOVERY_PILOT_CALLS_ENABLED === "true";
}

/**
 * Keep non-Chair pilot positions out of consumers whose contract is explicitly
 * the Chair's paper book (milestones, Chair settlement copy and exit policy).
 */
export function chairOnlyCalls(calls: CallLogRow[]): CallLogRow[] {
  return calls.filter((row) => row.source == null);
}

/**
 * A newly enabled pilot starts at the next complete market window. A persisted
 * boundary is reusable only when the previous process also persisted that the
 * pilot was enabled; otherwise it was merely an off-state housekeeping value.
 */
export function recoveryPilotStartAtBoot(
  now: number,
  enabled: boolean,
  previousEnabled: boolean,
  previousStart: unknown,
): number {
  if (enabled && previousEnabled && typeof previousStart === "number" && Number.isFinite(previousStart) && previousStart > 0) {
    return previousStart;
  }
  return Math.ceil(now / 900_000) * 900_000;
}

function feedsFresh(snap: Snapshot): boolean {
  const receiptAge = (snap.as_of - snap.obs?.receipt_ts) / 1000;
  return snap.health.spot_ok && snap.health.kalshi_ok &&
    snap.health.spot === "LIVE" && snap.health.kalshi === "LIVE" &&
    !snap.health.spot_divergent && !snap.health.basis_wide && snap.obs?.gap === "ok" &&
    Number.isFinite(receiptAge) && receiptAge >= 0 && receiptAge <= 10 &&
    Number.isFinite(snap.spot_age_s) && snap.spot_age_s >= 0 && snap.spot_age_s <= 15;
}

/** The exact market candidate. No Council vote or model estimate enters it. */
export function recoveryPilotCandidate(snap: Snapshot): RecoveryPilotCandidate | null {
  const secsLeft = (snap.close_time - snap.as_of) / 1000;
  if (secsLeft < RECOVERY_PILOT_MIN_SECS_LEFT || secsLeft > RECOVERY_PILOT_MAX_SECS_LEFT) return null;
  const up = snap.yes_ask >= snap.no_ask;
  const ask = up ? snap.yes_ask : snap.no_ask;
  const bid = up ? snap.yes_bid : snap.no_bid;
  const touch = up ? snap.no_bid_size : snap.yes_bid_size;
  if (![ask, bid, touch, snap.yes_ask, snap.no_ask].every(Number.isFinite)) return null;
  if (ask < RECOVERY_PILOT_MIN_ASK || ask > RECOVERY_PILOT_MAX_ASK || bid < 0 || bid > ask || ask - bid > 2) return null;
  if (touch < 1 || snap.yes_ask + snap.no_ask < 100 || !feedsFresh(snap)) return null;
  return { side: up ? "UP" : "DOWN", ask, spread: ask - bid, touch };
}

function baseBlock(snap: Snapshot, ctx: RecoveryPilotContext): string | null {
  if (!ctx.ready) return "waiting for durable risk history";
  if (hasPaperPosition(ctx.calls, snap)) return "a paper position already exists for this window";
  if (snap.close_time - 900_000 < ctx.start) return "starts at the next complete market window";
  const all = dailyAdmission(ctx.calls, snap.as_of);
  if (all.reason) return all.reason;
  const pilot = dailyAdmission(ctx.calls.filter((r) => r.source === RECOVERY_PILOT_SOURCE), snap.as_of);
  if (pilot.calls >= RECOVERY_PILOT_MAX_CALLS_PER_DAY) return "daily recovery-pilot call cap reached";
  if (pilot.losses >= 1) return "recovery pilot stopped after today's first settled loss";
  return null;
}

/** Advance the confirmation latch and state whether the current frame may book. */
export function recoveryPilotDecision(snap: Snapshot, ctx: RecoveryPilotContext): RecoveryPilotDecision {
  const reason = baseBlock(snap, ctx);
  const candidate = reason ? null : recoveryPilotCandidate(snap);
  if (!candidate) return { candidate: null, watch: null, eligible: false, reason: reason ?? "waiting for an 85–94.9¢ favourite on a fresh, tight book" };
  const key = `${snap.ticker}|${snap.close_time}`;
  const old = ctx.watch;
  const watch = old && old.key === key && old.side === candidate.side && snap.as_of >= old.last && snap.as_of - old.last <= 10_000
    ? { ...old, last: snap.as_of, frames: old.frames + Number(snap.as_of > old.last) }
    : { key, side: candidate.side, since: snap.as_of, last: snap.as_of, frames: 1 };
  const eligible = watch.frames >= RECOVERY_PILOT_CONFIRM_FRAMES && snap.as_of - watch.since >= RECOVERY_PILOT_CONFIRM_MS;
  return {
    candidate,
    watch,
    eligible,
    reason: eligible ? null : "waiting for three same-side observations over at least eight seconds",
  };
}

/** Recheck every non-latch invariant at the write boundary. */
export function recoveryPilotBookOk(snap: Snapshot, ctx: RecoveryPilotContext, decision: RecoveryPilotDecision): boolean {
  if (baseBlock(snap, ctx)) return false;
  const candidate = recoveryPilotCandidate(snap);
  const watch = decision.watch;
  return !!candidate && decision.eligible && !!watch && watch.key === `${snap.ticker}|${snap.close_time}` &&
    watch.side === candidate.side && watch.last === snap.as_of &&
    watch.frames >= RECOVERY_PILOT_CONFIRM_FRAMES && snap.as_of - watch.since >= RECOVERY_PILOT_CONFIRM_MS;
}

/** Make durable outbox rows from the previous 44-column schema writable. */
export function withRecoveryPilotSourceColumn(values: unknown[]): unknown[] {
  return values.length === 44 ? [...values.slice(0, 40), null, ...values.slice(40)] : values;
}
