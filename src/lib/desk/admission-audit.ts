/** Observational explanation of ALL entry checks; never used to permit a call. */
import { paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { SELECTIVE_PARAMS } from "./floor-policy.ts";
import { EVIDENCE_OF } from "./seats.ts";
import { admissionRequirements, dailyAdmission, hasPaperPosition, profitRiskBlock, selectiveBookOk, type SelectiveContext } from "./selective-entry.ts";
import type { ChairResult, Snapshot } from "./types";

export type AdmissionCheck = { id: string; label: string; pass: boolean | null; blocking?: boolean };
export type AdmissionAudit = { checks: AdmissionCheck[]; positioned: boolean; eligible: boolean; mode: "normal" | "tight" };

export function auditAdmission(s: Snapshot, c: ChairResult, ctx: SelectiveContext): AdmissionAudit {
  const p = SELECTIVE_PARAMS;
  const daily = dailyAdmission(ctx.calls, s.as_of);
  const required = admissionRequirements(daily);
  const side = c.lean === "UP" || c.lean === "DOWN" ? c.lean : null;
  const rows = c.rows.filter(r => r.lean === side && r.health === "LIVE" && !r.folded &&
    !["MUTED", "VETO", "DOWN", "UNCALIBRATED", "FOLDED"].includes(r.status) && EVIDENCE_OF[r.seat] !== "context");
  const ask = side === "UP" ? s.yes_ask : s.no_ask;
  const bid = side === "UP" ? s.yes_bid : s.no_bid;
  const touch = side === "UP" ? s.no_bid_size : s.yes_bid_size;
  const edge = side === "UP" ? s.edge_up : s.edge_down;
  const seconds = (s.close_time - s.as_of) / 1000;
  const age = (s.as_of - s.obs?.receipt_ts) / 1000;
  const fair = s.lab_fair_yes;
  const freshIndex = fair != null && Number.isFinite(fair) && fair >= 0 && fair <= 100 &&
    Number.isFinite(s.lab_age_s) && s.lab_age_s >= 0 && s.lab_age_s <= p.max_index_age_s;
  const w = ctx.watch;
  const mode = daily.tightened ? "tight" : "normal";
  const check = (id: string, label: string, pass: boolean | null): AdmissionCheck => ({ id, label, pass });
  return { positioned: hasPaperPosition(ctx.calls, s), eligible: selectiveBookOk(s, c, ctx), mode, checks: [
    check("risk_history", "Durable risk history", ctx.ready),
    check("daily_risk", "Prior result and daily risk", !daily.reason),
    check("complete_window", "Complete market window", s.close_time - 900_000 >= ctx.start),
    check("direction", "Directional setup", side != null),
    check("team", "Current team and hard checks", side == null ? null : paperBookTeamOk(c, side) && Array.isArray(c.gates) && !c.gates.some(g => g.hard && !g.pass)),
    check("supporters", `At least ${required.min_speaking} healthy supporters`, side == null ? null : new Set(rows.map(r => r.seat)).size >= required.min_speaking),
    check("families", `At least ${required.min_families} evidence groups`, side == null ? null : new Set(rows.map(r => EVIDENCE_OF[r.seat])).size >= required.min_families),
    check("opposition", "No opposing vote", side == null ? null : (side === "UP" ? c.quorum.down : c.quorum.up) <= p.max_opposing),
    check("time", "3–10 minutes remaining", Number.isFinite(seconds) && seconds >= p.min_seconds_left && seconds <= p.max_seconds_left),
    check("feeds", "Fresh, consistent feeds", s.health.spot_ok && s.health.kalshi_ok && s.health.spot === "LIVE" && s.health.kalshi === "LIVE" &&
      !s.health.spot_divergent && !s.health.basis_wide && s.obs?.gap === "ok" && Number.isFinite(age) && age >= 0 && age <= p.max_receipt_age_s &&
      Number.isFinite(s.spot_age_s) && s.spot_age_s >= 0 && s.spot_age_s <= p.max_spot_age_s),
    check("quote", "80¢-plus ask, tight spread and size", side == null ? null : [ask, bid, touch, s.yes_ask, s.no_ask].every(Number.isFinite) &&
      ask >= p.floor_cents && ask < 99 && bid >= 0 && bid <= ask && ask - bid <= p.max_spread_cents && touch >= 1 && s.yes_ask + s.no_ask >= 100),
    check("profit_reserve", "Profit protection", side == null ? null : !profitRiskBlock(daily, ask)),
    check("model_edge", `At least ${required.min_edge_cents}¢ model edge after fees`, side == null ? null : Number.isFinite(edge) && edge >= required.min_edge_cents),
    check("index_fresh", "Fresh settlement-index estimate", freshIndex),
    check("index_edge", "Settlement estimate covers costs", side == null || !freshIndex ? null :
      (side === "UP" ? fair! : 100 - fair!) - ask - takerFeeCents(ask) > required.min_index_edge_cents),
    check("confirmation", "Repeated confirming observations", side == null ? null : !!w && w.mode === mode && w.key === `${s.ticker}|${s.close_time}` &&
      w.side === side && w.last === s.as_of && w.frames >= required.confirmation_frames && s.as_of - w.since >= required.confirmation_seconds * 1000),
    ...c.gates.filter(g => g.id !== "selective").map(g => ({ ...check(`chair:${g.id}`, g.label, g.pass), blocking: g.hard || g.id === "bar" })),
  ] };
}
