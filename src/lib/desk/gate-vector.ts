/**
 * The full admission gate vector, and the quorum a Chair read can actually reach.
 *
 * WHY THIS EXISTS. `selectiveBlock` returns the FIRST reason a paper entry is
 * refused and stops. That is the right shape for a booking guard and the wrong
 * shape for a diagnosis: since 2026-09-17 the first reason has been "waiting
 * for a directional setup" on 1,128 of 1,142 audited checkpoints, which says
 * nothing about whether a directional read, had one existed, could have cleared
 * the supporter, family, opposition, quote, edge and confirmation checks. This
 * module evaluates EVERY check independently, keeps the binding reason the
 * production guard would give, and reports the maximum quorum reachable from
 * the Chair rows under both the deployed policy and the owner's reference
 * policy. It decides nothing.
 *
 * TWO POLICIES, NAMED. The deployed Champion (ENTRY_SELECTIVE_V3) requires two
 * healthy supporters from two evidence groups. The owner's stated admission
 * requires three from two. Both are evaluated side by side; neither is relabelled
 * as the other.
 *
 * Pure module: no clock, no state, no database, no writes.
 */
import { paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { SELECTIVE_ENTRY_ID, SELECTIVE_PARAMS } from "./floor-policy.ts";
import { EVIDENCE_OF, type EvidenceFamily } from "./seats.ts";
import { eligibleSupportRows } from "./support-eligibility.ts";
import { admissionRequirements, dailyAdmission, hasPaperPosition, profitRiskBlock, selectiveBlock, type SelectiveContext } from "./selective-entry.ts";
import type { ChairResult, SeatId, SeatRow, Snapshot } from "./types";

/** The frozen params with their numeric literals widened, so a reference policy can differ in one number. */
export type AdmissionParams = { readonly [K in keyof typeof SELECTIVE_PARAMS]: (typeof SELECTIVE_PARAMS)[K] extends number ? number : (typeof SELECTIVE_PARAMS)[K] };

export type AdmissionPolicy = {
  id: string;
  label: string;
  /** "deployed" is what production runs; "owner_reference" is the stated rule. */
  kind: "deployed" | "owner_reference";
  params: AdmissionParams;
};

export const DEPLOYED_POLICY: AdmissionPolicy = Object.freeze({
  id: SELECTIVE_ENTRY_ID,
  label: "deployed Champion: two healthy supporters from two evidence groups",
  kind: "deployed",
  params: SELECTIVE_PARAMS,
});

/** The owner's stated admission (2026-09-15): three supporters from two groups; tightened mode unchanged. */
export const OWNER_REFERENCE_POLICY: AdmissionPolicy = Object.freeze({
  id: "OWNER_REFERENCE_ADMISSION_2026_09_15",
  label: "owner reference: three healthy supporters from two evidence groups",
  kind: "owner_reference",
  params: Object.freeze({ ...SELECTIVE_PARAMS, min_speaking: 3 }),
});

export type GateCheck = {
  id: string;
  label: string;
  /** null = not evaluable (needs a side that does not exist), never "passed". */
  pass: boolean | null;
  value: string;
  /** The production guard's own reason, when this is the one it would print. */
  binding: boolean;
};

export type GateVector = {
  policy_id: string;
  policy_kind: AdmissionPolicy["kind"];
  mode: "normal" | "tight";
  side: "UP" | "DOWN" | null;
  positioned: boolean;
  checks: GateCheck[];
  /** Exactly what `selectiveBlock` would say for the deployed policy; derived in production order otherwise. */
  binding_reason: string | null;
  failed: string[];
  not_evaluable: string[];
  eligible_ignoring_confirmation: boolean;
};

/** Rows that can count as supporters of `side`, mirroring `selectiveBlock` exactly. */
export function supporterRows(chair: Pick<ChairResult, "rows">, side: "UP" | "DOWN"): SeatRow[] {
  return eligibleSupportRows(chair, side);
}

export type ReachableQuorum = {
  side: "UP" | "DOWN";
  supporters: SeatId[];
  families: EvidenceFamily[];
  opposition: number;
  /** Same-side healthy seats the quorum cannot count because the Chair folded their family. */
  folded_excluded: SeatId[];
  /** Same-side reads turned into forced sits by the authority guard or whisper filter. */
  authority_excluded: SeatId[];
  /** Same-side seats excluded for status/health (UNCALIBRATED, DOWN, MUTED, VETO, STALE). */
  status_excluded: SeatId[];
  /** Context-family seats (pit crew, CLOCK) that never count. */
  context_excluded: SeatId[];
  healthy_wait: number;
  required: { supporters: number; families: number; max_opposing: number };
  reachable: boolean;
  deficit: { supporters: number; families: number; opposition: number };
};

/** What `side` could muster from these rows under `policy` in `mode`. */
export function reachableQuorum(chair: Pick<ChairResult, "rows" | "quorum">, side: "UP" | "DOWN", policy: AdmissionPolicy, mode: "normal" | "tight"): ReachableQuorum {
  const p = policy.params;
  const required = mode === "tight"
    ? { supporters: p.tight_min_speaking, families: p.tight_min_families, max_opposing: p.max_opposing }
    : { supporters: p.min_speaking, families: p.min_families, max_opposing: p.max_opposing };
  const rows = supporterRows(chair, side);
  const supporters = [...new Set(rows.map((r) => r.seat))];
  const families = [...new Set(rows.map((r) => EVIDENCE_OF[r.seat]))];
  const sameSide = chair.rows.filter((r) => r.lean === side);
  const folded = [...new Set(sameSide.filter((r) => (r.folded || r.status === "FOLDED") && r.health === "LIVE" && EVIDENCE_OF[r.seat] !== "context" && !supporters.includes(r.seat)).map((r) => r.seat))];
  const context = [...new Set(sameSide.filter((r) => EVIDENCE_OF[r.seat] === "context").map((r) => r.seat))];
  const status = sameSide.filter((r) => !folded.includes(r.seat) && !context.includes(r.seat) && !supporters.includes(r.seat)).map((r) => r.seat);
  const authority = chair.rows.filter((r) => r.forced_sit === true && r.lean === "WAIT").map((r) => r.seat);
  const opposition = side === "UP" ? chair.quorum.down : chair.quorum.up;
  const healthyWait = chair.rows.filter((r) => r.lean === "WAIT" && r.health === "LIVE" && !r.forced_sit && EVIDENCE_OF[r.seat] !== "context").length;
  return {
    side, supporters, families, opposition, folded_excluded: folded, authority_excluded: authority, status_excluded: status, context_excluded: context,
    healthy_wait: healthyWait, required,
    reachable: supporters.length >= required.supporters && families.length >= required.families && opposition <= required.max_opposing,
    deficit: {
      supporters: Math.max(0, required.supporters - supporters.length),
      families: Math.max(0, required.families - families.length),
      opposition: Math.max(0, opposition - required.max_opposing),
    },
  };
}

/** The best side's reachable quorum, so a WAIT read still says how far the table was from admission. */
export function maxReachableQuorum(chair: Pick<ChairResult, "rows" | "quorum">, policy: AdmissionPolicy, mode: "normal" | "tight"): { up: ReachableQuorum; down: ReachableQuorum; best: ReachableQuorum } {
  const up = reachableQuorum(chair, "UP", policy, mode);
  const down = reachableQuorum(chair, "DOWN", policy, mode);
  const score = (q: ReachableQuorum) => q.supporters.length * 10 + q.families.length - q.opposition;
  return { up, down, best: score(down) > score(up) ? down : up };
}

/**
 * Every admission check, evaluated independently. The production guard is
 * consulted for the binding reason under the deployed policy only; under the
 * owner-reference policy the binding reason is the first failing check in the
 * same order the guard uses, so the two are comparable.
 */
export function gateVector(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext, policy: AdmissionPolicy = DEPLOYED_POLICY): GateVector {
  const p = policy.params;
  const daily = dailyAdmission(ctx.calls, snap.as_of);
  const mode: "normal" | "tight" = daily.tightened ? "tight" : "normal";
  const required = policy.kind === "deployed" ? admissionRequirements(daily) : (daily.tightened ? {
    min_speaking: p.tight_min_speaking, min_families: p.tight_min_families, min_edge_cents: p.tight_min_edge_cents,
    min_index_edge_cents: p.tight_min_index_edge_cents, confirmation_seconds: p.tight_confirmation_seconds, confirmation_frames: p.tight_confirmation_frames,
  } : p);
  const side = chair.lean === "UP" || chair.lean === "DOWN" ? chair.lean : null;
  const rq = side ? reachableQuorum(chair, side, policy, mode) : null;
  const ask = side === "UP" ? snap.yes_ask : side === "DOWN" ? snap.no_ask : NaN;
  const bid = side === "UP" ? snap.yes_bid : side === "DOWN" ? snap.no_bid : NaN;
  const touch = side === "UP" ? snap.no_bid_size : side === "DOWN" ? snap.yes_bid_size : NaN;
  const edge = side === "UP" ? snap.edge_up : side === "DOWN" ? snap.edge_down : NaN;
  const seconds = (snap.close_time - snap.as_of) / 1000;
  const receiptAge = (snap.as_of - snap.obs?.receipt_ts) / 1000;
  const fair = snap.lab_fair_yes;
  const freshIndex = fair != null && Number.isFinite(fair) && fair >= 0 && fair <= 100 && Number.isFinite(snap.lab_age_s) && snap.lab_age_s >= 0 && snap.lab_age_s <= p.max_index_age_s;
  const indexEdge = side && freshIndex ? (side === "UP" ? fair! : 100 - fair!) - ask - takerFeeCents(ask) : NaN;
  const w = ctx.watch;
  const feedsOk = snap.health.spot_ok && snap.health.kalshi_ok && snap.health.spot === "LIVE" && snap.health.kalshi === "LIVE" &&
    !snap.health.spot_divergent && !snap.health.basis_wide && snap.obs?.gap === "ok" && Number.isFinite(receiptAge) && receiptAge >= 0 &&
    receiptAge <= p.max_receipt_age_s && Number.isFinite(snap.spot_age_s) && snap.spot_age_s >= 0 && snap.spot_age_s <= p.max_spot_age_s;
  const quoteOk = side != null && [ask, bid, touch, snap.yes_ask, snap.no_ask].every(Number.isFinite) && ask >= p.floor_cents && ask < 99 &&
    bid >= 0 && bid <= ask && ask - bid <= p.max_spread_cents && touch >= 1 && snap.yes_ask + snap.no_ask >= 100;
  const c = (id: string, label: string, pass: boolean | null, value: string): GateCheck => ({ id, label, pass, value, binding: false });
  const checks: GateCheck[] = [
    c("risk_history", "durable risk history", ctx.ready, ctx.ready ? "ready" : "not restored"),
    c("daily_risk", "prior result and daily risk", !daily.reason, daily.reason ?? `net ${daily.net_cents}¢ · open ${daily.open_risk_cents}¢`),
    c("complete_window", "complete market window since policy start", snap.close_time - 900_000 >= ctx.start, `close ${new Date(snap.close_time).toISOString()}`),
    c("direction", "directional Chair read", side != null, chair.lean),
    c("team", "current team and hard Chair gates", side == null ? null : paperBookTeamOk(chair, side) && Array.isArray(chair.gates) && !chair.gates.some((g) => g.hard && !g.pass),
      side == null ? "no side" : `quorum ${chair.quorum.up}/${chair.quorum.down} · hard fails ${chair.gates.filter((g) => g.hard && !g.pass).map((g) => g.id).join(",") || "none"}`),
    c("supporters", `at least ${required.min_speaking} healthy supporters`, rq == null ? null : rq.supporters.length >= required.min_speaking, rq ? `${rq.supporters.length}: ${rq.supporters.join("+") || "none"} · folded-out ${rq.folded_excluded.join("+") || "none"}` : "no side"),
    c("families", `at least ${required.min_families} evidence groups`, rq == null ? null : rq.families.length >= required.min_families, rq ? rq.families.join("+") || "none" : "no side"),
    c("opposition", "no opposing vote", rq == null ? null : rq.opposition <= p.max_opposing, rq ? String(rq.opposition) : "no side"),
    c("time", "3–10 minutes remaining", Number.isFinite(seconds) && seconds >= p.min_seconds_left && seconds <= p.max_seconds_left, `${seconds.toFixed(0)}s`),
    c("feeds", "fresh, consistent feeds", feedsOk, `spot ${snap.health.spot} ${snap.spot_age_s}s · kalshi ${snap.health.kalshi} · receipt ${Number.isFinite(receiptAge) ? receiptAge.toFixed(1) : "?"}s · gap ${snap.obs?.gap}`),
    c("quote", `${p.floor_cents}¢-plus ask, spread ≤ ${p.max_spread_cents}¢, resting size`, side == null ? null : quoteOk, side ? `ask ${ask} bid ${bid} touch ${touch} · yes ${snap.yes_ask} no ${snap.no_ask}` : "no side"),
    c("profit_reserve", "profit protection", side == null ? null : !profitRiskBlock(daily, ask), side ? (profitRiskBlock(daily, ask) ?? "ok") : "no side"),
    c("model_edge", `at least ${required.min_edge_cents}¢ main-model edge after fee`, side == null ? null : Number.isFinite(edge) && edge >= required.min_edge_cents, side ? `${Number.isFinite(edge) ? edge.toFixed(1) : "?"}¢` : "no side"),
    c("index_fresh", "fresh settlement-index estimate", freshIndex, `fair ${fair ?? "?"} age ${snap.lab_age_s}s`),
    c("index_edge", `settlement-index margin > ${required.min_index_edge_cents}¢`, side == null || !freshIndex ? null : indexEdge > required.min_index_edge_cents, Number.isFinite(indexEdge) ? `${indexEdge.toFixed(1)}¢` : "no fresh index"),
    c("confirmation", `${required.confirmation_frames} genuine observations over ≥ ${required.confirmation_seconds}s`,
      side == null ? null : !!w && w.mode === mode && w.key === `${snap.ticker}|${snap.close_time}` && w.side === side && w.last === snap.as_of &&
        w.frames >= required.confirmation_frames && snap.as_of - w.since >= required.confirmation_seconds * 1000,
      w ? `${w.frames} frames over ${((snap.as_of - w.since) / 1000).toFixed(0)}s (${w.mode})` : "no watch"),
  ];
  const failed = checks.filter((k) => k.pass === false).map((k) => k.id);
  const notEvaluable = checks.filter((k) => k.pass == null).map((k) => k.id);
  let binding: string | null;
  if (policy.kind === "deployed") binding = selectiveBlock(snap, chair, ctx);
  else binding = checks.find((k) => k.pass === false)?.label ?? null;
  const first = checks.find((k) => k.pass === false);
  if (first) first.binding = true;
  return {
    policy_id: policy.id, policy_kind: policy.kind, mode, side, positioned: hasPaperPosition(ctx.calls, snap), checks, binding_reason: binding,
    failed, not_evaluable: notEvaluable,
    eligible_ignoring_confirmation: checks.filter((k) => k.id !== "confirmation").every((k) => k.pass === true),
  };
}
