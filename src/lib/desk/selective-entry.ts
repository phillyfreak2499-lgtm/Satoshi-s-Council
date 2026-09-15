/** Owner-selected paper admission policy. Parameters are frozen, not fitted to the four losses. */
import { paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { EVIDENCE_OF } from "./seats.ts";
import type { CallLogRow, ChairResult, Snapshot } from "./types";

export const SELECTIVE_ENTRY_ID = "ENTRY_SELECTIVE_V1";
export const SELECTIVE_FROZEN_AT = "2026-09-15T14:05:13.000Z";
export const SELECTIVE_PARAMS = Object.freeze({
  floor_cents: 80,
  max_calls_per_day: 3,
  max_losses_per_day: 1,
  min_speaking: 3,
  min_families: 2,
  max_opposing: 0,
  min_seconds_left: 180,
  max_seconds_left: 600,
  min_edge_cents: 3,
  min_index_edge_cents: 0,
  max_spread_cents: 2,
  max_receipt_age_s: 10,
  max_spot_age_s: 15,
  max_index_age_s: 5,
  confirmation_seconds: 8,
  confirmation_frames: 3,
  timezone: "America/Chicago",
});

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SELECTIVE_PARAMS.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});
export function chicagoDay(t: number): string {
  return Number.isFinite(t) && t > 0 ? dayFormatter.format(new Date(t)) : "";
}
const keyOf = (r: Pick<CallLogRow, "ticker" | "close_time">) => `${r.ticker}|${r.close_time}`;

/** Separate from the clearable display log; retained and restored with server state. */
export function restoreRiskCalls(saved: unknown, log: CallLogRow[]): { calls: CallLogRow[]; valid: boolean } {
  if (saved != null && !Array.isArray(saved)) return { calls: [], valid: false };
  const rows = [...(Array.isArray(saved) ? saved : []), ...log];
  const byWindow = new Map<string, CallLogRow>();
  for (const r of rows) {
    if (!r || typeof r.ticker !== "string" || !r.ticker || !Number.isFinite(r.t) || r.t <= 0 ||
        !Number.isFinite(r.close_time) || r.close_time <= r.t ||
        (r.lean !== "UP" && r.lean !== "DOWN") || !Number.isFinite(r.cents) || r.cents <= 0 || r.cents >= 100 ||
        (r.settle != null && (!Number.isFinite(r.settle) || r.settle < 0 || r.settle > 100))) {
      return { calls: [], valid: false };
    }
    const previous = byWindow.get(keyOf(r));
    byWindow.set(keyOf(r), previous?.settle != null && r.settle == null ? previous : { ...r });
  }
  return { calls: [...byWindow.values()].sort((a, b) => b.t - a.t).slice(0, 160), valid: true };
}

export function settleRiskCalls(rows: CallLogRow[], ticker: string, close: number, winner: "UP" | "DOWN"): CallLogRow[] {
  return rows.map(r => r.settle == null && r.ticker === ticker && r.close_time === close
    ? { ...r, settle: r.lean === winner ? 100 : 0 } : r);
}

export function hasPaperPosition(rows: CallLogRow[], snap: Pick<Snapshot, "ticker" | "close_time">): boolean {
  return rows.some(r => r.ticker === snap.ticker && r.close_time === snap.close_time);
}

export function dailyAdmission(rows: CallLogRow[], now: number): { calls: number; losses: number; reason: string | null } {
  const day = chicagoDay(now);
  if (!day) return { calls: 0, losses: 0, reason: "waiting for a valid clock" };
  const calls = new Set(rows.filter(r => chicagoDay(r.t) === day).map(keyOf)).size;
  const losses = new Set(rows.filter(r => r.settle != null && chicagoDay(r.close_time) === day &&
    r.settle - r.cents - takerFeeCents(r.cents) < 0).map(keyOf)).size;
  let reason: string | null = null;
  if (losses >= SELECTIVE_PARAMS.max_losses_per_day) reason = "paused after a loss; resumes next Central day";
  else if (calls >= SELECTIVE_PARAMS.max_calls_per_day) reason = "three-call daily limit reached; resumes next Central day";
  else if (rows.some(r => r.settle == null && r.close_time <= now)) reason = "waiting for the previous paper result";
  return { calls, losses, reason };
}

export function paperSummary(rows: CallLogRow[], since: number) {
  const calls = rows.filter(r => r.t >= since);
  const settled = calls.filter(r => r.settle != null);
  const nets = settled.map(r => r.settle! - r.cents - takerFeeCents(r.cents));
  return { calls: calls.length, settled: settled.length, losses: nets.filter(n => n < 0).length,
    net_cents: Math.round(nets.reduce((sum, n) => sum + n, 0) * 10) / 10 };
}

export type EntryWatch = { key: string; side: "UP" | "DOWN"; since: number; last: number; frames: number };
export type SelectiveContext = { calls: CallLogRow[]; ready: boolean; start: number; watch: EntryWatch | null };

/** Full revalidation uses the current quote, current team and two distinct models. */
export function selectiveBlock(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext): string | null {
  const p = SELECTIVE_PARAMS;
  if (!ctx.ready) return "waiting for durable risk history";
  const daily = dailyAdmission(ctx.calls, snap.as_of);
  if (daily.reason) return daily.reason;
  if (snap.close_time - 900_000 < ctx.start) return "starts at the next complete market window";
  if (chair.lean !== "UP" && chair.lean !== "DOWN") return "waiting for a directional setup";
  if (!paperBookTeamOk(chair, chair.lean) || !Array.isArray(chair.gates) || chair.gates.some(g => g.hard && !g.pass)) {
    return "current team or entry checks no longer support this call";
  }
  const side = chair.lean;
  const against = side === "UP" ? chair.quorum.down : chair.quorum.up;
  const rows = chair.rows.filter(r => r.lean === side && r.health === "LIVE" &&
    !r.folded && !["MUTED", "VETO", "DOWN", "UNCALIBRATED", "FOLDED"].includes(r.status) &&
    EVIDENCE_OF[r.seat] !== "context");
  const supporters = new Set(rows.map(r => r.seat));
  const families = new Set(rows.map(r => EVIDENCE_OF[r.seat]));
  if (supporters.size < p.min_speaking || families.size < p.min_families || against > p.max_opposing) {
    return "needs three healthy supporters from two evidence groups, with no opposing vote";
  }
  const seconds = (snap.close_time - snap.as_of) / 1000;
  if (!Number.isFinite(seconds) || seconds < p.min_seconds_left || seconds > p.max_seconds_left) {
    return "new calls require 3–10 minutes remaining";
  }
  const receiptAge = (snap.as_of - snap.obs?.receipt_ts) / 1000;
  if (!snap.health.spot_ok || !snap.health.kalshi_ok || snap.health.spot !== "LIVE" || snap.health.kalshi !== "LIVE" ||
      snap.health.spot_divergent || snap.health.basis_wide || snap.obs?.gap !== "ok" ||
      !Number.isFinite(receiptAge) || receiptAge < 0 || receiptAge > p.max_receipt_age_s ||
      !Number.isFinite(snap.spot_age_s) || snap.spot_age_s < 0 || snap.spot_age_s > p.max_spot_age_s) {
    return "waiting for fresh, consistent market feeds";
  }
  const ask = side === "UP" ? snap.yes_ask : snap.no_ask;
  const bid = side === "UP" ? snap.yes_bid : snap.no_bid;
  // Buying YES consumes resting NO bids, and vice versa. Never fall back to a midpoint.
  const touch = side === "UP" ? snap.no_bid_size : snap.yes_bid_size;
  if (![ask, bid, touch, snap.yes_ask, snap.no_ask].every(Number.isFinite) ||
      ask < p.floor_cents || ask >= 99 || bid < 0 || bid > ask || ask - bid > p.max_spread_cents || touch < 1 ||
      snap.yes_ask + snap.no_ask < 100) return "waiting for a usable 80¢-plus ask, tight spread and resting size";
  const edge = side === "UP" ? snap.edge_up : snap.edge_down;
  if (!Number.isFinite(edge) || edge < p.min_edge_cents) return "needs at least 3¢ of model edge after fees";
  const fair = snap.lab_fair_yes;
  if (fair == null || !Number.isFinite(fair) || fair < 0 || fair > 100 ||
      !Number.isFinite(snap.lab_age_s) || snap.lab_age_s < 0 || snap.lab_age_s > p.max_index_age_s) {
    return "waiting for a fresh settlement-index estimate";
  }
  const indexEdge = (side === "UP" ? fair : 100 - fair) - ask - takerFeeCents(ask);
  if (!(indexEdge > p.min_index_edge_cents)) return "settlement-index estimate does not cover the ask and fee";
  return null;
}

/** A candidate must survive distinct fresh ticks; a sticky UI lean cannot qualify by itself. */
export function selectiveChair(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext): { chair: ChairResult; watch: EntryWatch | null } {
  if (hasPaperPosition(ctx.calls, snap)) return { chair, watch: null }; // entry rules never sell an existing position
  let reason = selectiveBlock(snap, chair, ctx);
  let watch: EntryWatch | null = null;
  if (!reason && (chair.lean === "UP" || chair.lean === "DOWN")) {
    const key = `${snap.ticker}|${snap.close_time}`;
    const old = ctx.watch;
    watch = old && old.key === key && old.side === chair.lean && snap.as_of >= old.last && snap.as_of - old.last <= 10_000
      ? { ...old, last: snap.as_of, frames: old.frames + Number(snap.as_of > old.last) }
      : { key, side: chair.lean, since: snap.as_of, last: snap.as_of, frames: 1 };
    if (watch.frames < SELECTIVE_PARAMS.confirmation_frames || snap.as_of - watch.since < SELECTIVE_PARAMS.confirmation_seconds * 1000) {
      reason = "waiting for three confirming observations over at least eight seconds";
    }
  }
  const gate = { id: "selective", label: "Selective mode · at most three calls/day · pause after one loss", hard: true, pass: !reason,
    value: reason ?? "current team, both models, feeds and daily limits passed" };
  const gates = [...chair.gates.filter(g => g.id !== "selective"), gate];
  if (!reason) return { chair: { ...chair, gates }, watch };
  return { watch, chair: { ...chair, lean: "WAIT", gates, hard_fail: true,
    decision: `WAIT · ${reason}`, hypothesis: `Selective mode: ${reason}.`,
    wait_note: reason, calc: `${chair.calc} · SELECTIVE: ${reason}` } };
}

/** Recheck at the actual write boundary, including the confirmation latch. */
export function selectiveBookOk(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext): boolean {
  if (selectiveBlock(snap, chair, ctx)) return false;
  const w = ctx.watch;
  return !!w && w.key === `${snap.ticker}|${snap.close_time}` && w.side === chair.lean && w.last === snap.as_of &&
    w.frames >= SELECTIVE_PARAMS.confirmation_frames && snap.as_of - w.since >= SELECTIVE_PARAMS.confirmation_seconds * 1000;
}
