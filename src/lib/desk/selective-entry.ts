/** Owner-selected paper admission policy. Parameters are frozen, not fitted to the four losses. */
import { paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { familySupport } from "./family-support.ts";
import type { CallLogRow, ChairResult, Snapshot } from "./types";

import { SELECTIVE_PARAMS } from "./floor-policy.ts";
export { SELECTIVE_ENTRY_ID, SELECTIVE_FROZEN_AT, SELECTIVE_PARAMS } from "./floor-policy.ts";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SELECTIVE_PARAMS.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});
export function chicagoDay(t: number): string {
  return Number.isFinite(t) && t > 0 && Number.isFinite(new Date(t).getTime()) ? dayFormatter.format(new Date(t)) : "";
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

export function dailyAdmission(rows: CallLogRow[], now: number) {
  const day = chicagoDay(now);
  const history = restoreRiskCalls(rows, []);
  const unique = history.calls;
  const calls = day ? unique.filter(r => chicagoDay(r.t) === day).length : 0;
  const settled = day ? unique.filter(r => r.settle != null && r.close_time <= now && chicagoDay(r.close_time) === day)
    .sort((a, b) => a.close_time - b.close_time) : [];
  let net = 0, peak = 0, low = 0, wins = 0, losses = 0;
  for (const r of settled) {
    const cents = Math.round((r.settle! - r.cents - takerFeeCents(r.cents)) * 10);
    net += cents;
    peak = Math.max(peak, net);
    low = Math.min(low, net);
    if (cents > 0) wins++;
    if (cents < 0) losses++;
  }
  const unresolved = unique.filter(r => r.settle == null);
  const missingPrior = unresolved.filter(r => day && r.close_time <= now && chicagoDay(r.close_time) < day);
  const currentRisk = unresolved.filter(r => !missingPrior.includes(r));
  const openRisk = currentRisk.reduce((sum, r) => sum + Math.ceil((r.cents + takerFeeCents(r.cents)) * 10), 0);
  let reason: string | null = null;
  if (!day) reason = "waiting for a valid clock";
  else if (!history.valid) reason = "waiting for valid durable risk history";
  else if (currentRisk.some(r => r.close_time <= now)) reason = "waiting for the previous paper result";
  return { calls, wins, losses, net_cents: net / 10, peak_net_cents: peak / 10, low_net_cents: low / 10,
    open_risk_cents: openRisk / 10,
    missing_prior_days: missingPrior.map(r => ({ ticker: r.ticker, close_time: r.close_time, status: "MISSING" as const })),
    tightened: low <= SELECTIVE_PARAMS.tighten_at_net_cents * 10,
    profit_protected: net > 0 && (wins >= SELECTIVE_PARAMS.protect_after_wins || peak >= SELECTIVE_PARAMS.protect_after_net_cents * 10),
    reason };
}

export function admissionRequirements(daily: ReturnType<typeof dailyAdmission>) {
  const p = SELECTIVE_PARAMS;
  return daily.tightened ? {
    min_speaking: p.tight_min_speaking, min_families: p.tight_min_families,
    min_edge_cents: p.tight_min_edge_cents, min_index_edge_cents: p.tight_min_index_edge_cents,
    confirmation_seconds: p.tight_confirmation_seconds, confirmation_frames: p.tight_confirmation_frames,
  } : p;
}

export function profitRiskBlock(daily: ReturnType<typeof dailyAdmission>, ask: number): string | null {
  if (!daily.profit_protected) return null;
  if (!Number.isFinite(ask) || ask <= 0 || ask >= 100) return "waiting for a valid ask before reserving the possible loss";
  const remaining = Math.round((daily.net_cents - daily.open_risk_cents) * 10) - Math.ceil((ask + takerFeeCents(ask)) * 10);
  return remaining <= 0 ? "protecting today's profit: a full loss at this ask plus fees would leave the day flat or red" : null;
}

export function paperSummary(rows: CallLogRow[], since: number) {
  const calls = rows.filter(r => r.t >= since);
  const settled = calls.filter(r => r.settle != null);
  const nets = settled.map(r => r.settle! - r.cents - takerFeeCents(r.cents));
  return { calls: calls.length, settled: settled.length, losses: nets.filter(n => n < 0).length,
    net_cents: Math.round(nets.reduce((sum, n) => sum + n, 0) * 10) / 10 };
}

export type EntryWatch = { key: string; side: "UP" | "DOWN"; since: number; last: number; frames: number; mode: "normal" | "tight" };
export type SelectiveContext = { calls: CallLogRow[]; ready: boolean; start: number; watch: EntryWatch | null };

/** Full revalidation uses the current quote, current team and two distinct models. */
export function selectiveBlock(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext): string | null {
  const p = SELECTIVE_PARAMS;
  if (!ctx.ready) return "waiting for durable risk history";
  const daily = dailyAdmission(ctx.calls, snap.as_of);
  const required = admissionRequirements(daily);
  if (daily.reason) return daily.reason;
  if (snap.close_time - 900_000 < ctx.start) return "starts at the next complete market window";
  if (chair.lean !== "UP" && chair.lean !== "DOWN") return "waiting for a directional setup";
  if (!paperBookTeamOk(chair, chair.lean) || !Array.isArray(chair.gates) || chair.gates.some(g => g.hard && !g.pass)) {
    return "current team or entry checks no longer support this call";
  }
  const side = chair.lean;
  const against = side === "UP" ? chair.quorum.down : chair.quorum.up;
  const support = familySupport(chair.rows, side);
  const supporters = new Set(support.seats);
  const families = new Set(support.families);
  if (supporters.size < required.min_speaking || families.size < required.min_families || against > p.max_opposing) {
    return daily.tightened ? "tighter mode: needs four healthy supporters from three evidence groups, with no opposing vote"
      : "needs two healthy supporters from two evidence groups, with no opposing vote";
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
  const touch = side === "UP" ? snap.no_bid_size : snap.yes_bid_size;
  if (![ask, bid, touch, snap.yes_ask, snap.no_ask].every(Number.isFinite) ||
      ask < p.floor_cents || ask >= 99 || bid < 0 || bid > ask || ask - bid > p.max_spread_cents || touch < 1 ||
      snap.yes_ask + snap.no_ask < 100) return "waiting for a usable 80¢-plus ask, tight spread and resting size";
  const edge = side === "UP" ? snap.edge_up : snap.edge_down;
  const riskReason = profitRiskBlock(daily, ask);
  if (riskReason) return riskReason;
  if (!Number.isFinite(edge) || edge < required.min_edge_cents) return `needs at least ${required.min_edge_cents}¢ of model edge after fees`;
  const fair = snap.lab_fair_yes;
  if (fair == null || !Number.isFinite(fair) || fair < 0 || fair > 100 ||
      !Number.isFinite(snap.lab_age_s) || snap.lab_age_s < 0 || snap.lab_age_s > p.max_index_age_s) {
    return "waiting for a fresh settlement-index estimate";
  }
  const indexEdge = (side === "UP" ? fair : 100 - fair) - ask - takerFeeCents(ask);
  if (!(indexEdge > required.min_index_edge_cents)) return daily.tightened
    ? "tighter mode: settlement-index margin must exceed 2¢ after the ask and fee"
    : "settlement-index estimate does not cover the ask and fee";
  return null;
}

export function selectiveChair(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext): { chair: ChairResult; watch: EntryWatch | null } {
  if (hasPaperPosition(ctx.calls, snap)) return { chair, watch: null };
  let reason = selectiveBlock(snap, chair, ctx);
  const daily = dailyAdmission(ctx.calls, snap.as_of);
  const required = admissionRequirements(daily);
  let watch: EntryWatch | null = null;
  if (!reason && (chair.lean === "UP" || chair.lean === "DOWN")) {
    const key = `${snap.ticker}|${snap.close_time}`;
    const old = ctx.watch;
    const mode = daily.tightened ? "tight" : "normal";
    watch = old && old.mode === mode && old.key === key && old.side === chair.lean && snap.as_of >= old.last && snap.as_of - old.last <= 10_000
      ? { ...old, last: snap.as_of, frames: old.frames + Number(snap.as_of > old.last) }
      : { key, side: chair.lean, since: snap.as_of, last: snap.as_of, frames: 1, mode };
    if (watch.frames < required.confirmation_frames || snap.as_of - watch.since < required.confirmation_seconds * 1000) {
      reason = daily.tightened ? "tighter mode: waiting for five confirming observations over at least twenty seconds"
        : "waiting for three confirming observations over at least eight seconds";
    }
  }
  const gate = { id: "selective", label: daily.tightened ? "Paper entry · tighter mode after −100¢" : "Paper entry · selective mode", hard: false, pass: !reason,
    value: reason ?? "current team, both models, feeds and daily risk checks passed" };
  const gates = [...chair.gates.filter(g => g.id !== "selective"), gate];
  return { watch, chair: { ...chair, gates } };
}

export function selectiveBookOk(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext): boolean {
  if (selectiveBlock(snap, chair, ctx)) return false;
  const w = ctx.watch;
  const daily = dailyAdmission(ctx.calls, snap.as_of);
  const required = admissionRequirements(daily);
  return !!w && w.mode === (daily.tightened ? "tight" : "normal") && w.key === `${snap.ticker}|${snap.close_time}` && w.side === chair.lean && w.last === snap.as_of &&
    w.frames >= required.confirmation_frames && snap.as_of - w.since >= required.confirmation_seconds * 1000;
}
