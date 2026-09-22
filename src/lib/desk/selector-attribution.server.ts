/**
 * SELECTOR ATTRIBUTION v1 — the writer and the per-tick observer step (server only).
 *
 * Called ONLY from the shadow-lab observer (`shadowLabTick`), with the cloned
 * frame the observer already holds, so it is gated by the same switch
 * (SHADOW_LAB_ENABLED=true) and can never run before the shadow manifests'
 * durable prospective boundary exists: it reads that boundary from
 * desk_shadow_manifests, refuses to write anything until all three initial
 * experiments carry one, and stamps it on every row. Windows that STARTED
 * before the boundary are never recorded (the table's check repeats this).
 *
 * WHAT IT WRITES. Only desk_selector_attribution, append-only through the
 * primary key (ON CONFLICT DO NOTHING); the settle sweep fills official_winner,
 * net_cents and the settled counterfactual block on rows that have no result
 * yet, from the official ledger row. It never touches desk_ledger, desk_state,
 * the learner, a seat or card status, a threshold, the Chair, the paper book,
 * a manifest or a shadow receipt. Every error is counted into its own health
 * record; nothing here can throw into the observer, let alone the engine.
 */
import type { Sql } from "@/lib/db";
import {
  ATTRIBUTION_BAND_SECS, SELECTOR_ATTRIBUTION_VERSION, WINDOW_MS, attributionKey, blankTrack, blindEligibleRow, blindOpportunity, chairFillRow, chairState,
  contextFromFrame, noteTick, settleAttribution, sideQuote, windowRow, type AttributionRow, type ProductionAudit, type Side, type WindowTrack,
} from "./selector-attribution.ts";
import { INITIAL_SHADOW_COLLECTION_IDS } from "./shadow-manifests.ts";
import type { CallLogRow, ChairResult, Snapshot } from "./types";

export type AttributionTracker = {
  /** The durable boundary, once read: every row is stamped with it. */
  boundary_ms: number | null;
  boundary_iso: string | null;
  windows: Map<string, WindowTrack>;
  decided: Set<string>;
  written: number;
  failed: number;
  settled: number;
  error: string | null;
  last_write: number | null;
};

export const blankAttributionTracker = (): AttributionTracker => ({ boundary_ms: null, boundary_iso: null, windows: new Map(), decided: new Set(), written: 0, failed: 0, settled: 0, error: null, last_write: null });

const buildSha = () => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

// ---------------------------------------------------------------------------
// The boundary.
// ---------------------------------------------------------------------------

/**
 * The prospective boundary: the (single) prospective_start_at the atomic
 * activation stamped on the three initial experiments. Null until all three
 * are SHADOW with a timestamp; the observer then writes nothing.
 */
export async function readProspectiveBoundary(sql: Sql): Promise<{ ms: number; iso: string } | null> {
  const [e1, e2, e3] = INITIAL_SHADOW_COLLECTION_IDS;
  const rows = await sql<{ n: number | string; ms: number | string | null; iso: string | null }>`
    select count(*)::int as n,
           (extract(epoch from min(prospective_start_at)) * 1000)::bigint as ms,
           to_char(min(prospective_start_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso
    from desk_shadow_manifests
    where experiment in (${e1}, ${e2}, ${e3}) and experiment_version = 1
      and status = 'SHADOW' and prospective_start_at is not null`;
  const r = rows[0];
  if (!r || Number(r.n) !== 3 || r.ms == null || !r.iso) return null;
  const ms = Number(r.ms);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return { ms, iso: r.iso };
}

// ---------------------------------------------------------------------------
// Writes: append-only, idempotent.
// ---------------------------------------------------------------------------

/** Insert one row; true when it was new. The primary key is the idempotent key. */
export async function recordAttributionRow(sql: Sql, r: AttributionRow, boundaryIso: string): Promise<boolean> {
  const rows = await sql<{ ticker: string }>`
    insert into desk_selector_attribution (ticker, close_time, kind, decided_at, prospective_start_at, side, ask_cents, ask_whole_cents, fee_engine, fee_cents,
      spread_cents, size_at_ask, chair_lean, chair_confidence, chair_score, chair_bar, model_fair_yes, market_yes_mid, lab_fair_yes, model_edge_cents,
      index_margin_cents, feeds_ok, quorum_up, quorum_down, quorum_wait, eligible, rejection_reason, divergence, chalk, cap_blocked, counterfactual, payload, build_sha, research_version)
    values (${r.ticker}, ${new Date(r.close_ms).toISOString()}::timestamptz, ${r.kind}, ${new Date(r.decided_ms).toISOString()}::timestamptz, ${boundaryIso}::timestamptz,
      ${r.side}, ${r.ask_cents}, ${r.ask_whole_cents}, ${r.fee_engine}, ${r.fee_cents}, ${r.spread_cents}, ${r.size_at_ask}, ${r.chair_lean}, ${r.chair_confidence}, ${r.chair_score}, ${r.chair_bar},
      ${r.model_fair_yes}, ${r.market_yes_mid}, ${r.lab_fair_yes}, ${r.model_edge_cents}, ${r.index_margin_cents}, ${r.feeds_ok}, ${r.quorum_up}, ${r.quorum_down}, ${r.quorum_wait},
      ${r.eligible}, ${r.rejection_reason}, ${r.divergence}, ${r.chalk}, ${r.cap_blocked}, ${JSON.stringify(r.counterfactual)}::jsonb, ${JSON.stringify(r.payload)}::jsonb, ${buildSha()}, ${SELECTOR_ATTRIBUTION_VERSION})
    on conflict (ticker, close_time, kind) do nothing
    returning ticker`;
  return rows.length > 0;
}

/**
 * Settle open rows from the official ledger row (research_quality = valid,
 * kalshi-result). The net and the counterfactual P&L are computed in the pure
 * module from the values the row already carries; the update touches only rows
 * with no result yet.
 */
export async function settleAttributionRows(sql: Sql, limit = 500): Promise<number> {
  const open = await sql<{ ticker: string; close_iso: string; kind: AttributionRow["kind"]; side: Side | null; ask_cents: number | string | null; fee_cents: number | string | null; cap_blocked: boolean | null; counterfactual: Record<string, unknown> | string | null; winner: Side }>`
    select a.ticker, a.close_time::text as close_iso, a.kind, a.side, a.ask_cents, a.fee_cents, a.cap_blocked, a.counterfactual, l.winner
    from desk_selector_attribution a
    join desk_ledger_research l on l.ticker = a.ticker and l.close_time = a.close_time
    where a.official_winner is null and l.winner in ('UP', 'DOWN') and l.source = 'kalshi-result'
    limit ${limit}`;
  let n = 0;
  for (const o of open) {
    const cf = typeof o.counterfactual === "string" ? (JSON.parse(o.counterfactual) as Record<string, unknown>) : (o.counterfactual ?? {});
    const s = settleAttribution({ kind: o.kind, side: o.side, ask_cents: o.ask_cents == null ? null : Number(o.ask_cents), fee_cents: o.fee_cents == null ? null : Number(o.fee_cents), cap_blocked: o.cap_blocked, counterfactual: cf }, o.winner);
    const rows = await sql<{ ticker: string }>`
      update desk_selector_attribution
         set official_winner = ${s.official_winner}, net_cents = ${s.net_cents}, counterfactual = counterfactual || ${JSON.stringify(s.counterfactual)}::jsonb
       where ticker = ${o.ticker} and close_time = ${o.close_iso}::timestamptz and kind = ${o.kind} and official_winner is null
       returning ticker`;
    n += rows.length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The per-tick step.
// ---------------------------------------------------------------------------

export type AttributionInput = {
  snap: Snapshot;
  /** The PRODUCTION Chair result for this tick (not the E1 shadow Chair). */
  chair: ChairResult;
  call_log: readonly CallLogRow[];
  audit: ProductionAudit;
  ready: boolean | undefined;
  start: number | undefined;
  /** The observer session's own start: a market already open when this process began is never recorded (partial observation). */
  session_started_ms?: number;
};

async function write(sql: Sql, t: AttributionTracker, row: AttributionRow, now: number): Promise<void> {
  const k = attributionKey(row);
  if (t.decided.has(k) || t.boundary_iso == null) return;
  t.decided.add(k);
  if (t.decided.size > 3_000) t.decided = new Set([...t.decided].slice(-1_500));
  try {
    if (await recordAttributionRow(sql, row, t.boundary_iso)) { t.written += 1; t.last_write = now; }
  } catch (error) {
    t.failed += 1;
    t.error = error instanceof Error ? error.message : String(error);
  }
}

async function finalize(sql: Sql, t: AttributionTracker, track: WindowTrack, now: number): Promise<void> {
  if (track.finalized) return;
  track.finalized = true;
  if (track.ticks > 0) await write(sql, t, windowRow(track), now);
}

/**
 * One tick of attribution. Never throws: the caller records nothing about it
 * except through the tracker's own health fields.
 *
 * Order matters for the rails: windows that left the band are finalized first
 * (a write only if the window was tracked), then an out-of-band tick returns
 * before the boundary is even read, so an idle observer touches no table.
 */
export async function observeSelectorAttribution(sql: Sql, input: AttributionInput, t: AttributionTracker, now = Date.now()): Promise<void> {
  const { snap, chair } = input;
  const secs = (snap.close_time - snap.as_of) / 1000;
  const key = `${snap.ticker}|${snap.close_time}`;
  // Close out any window that is no longer in its band.
  for (const [k, track] of [...t.windows]) {
    if (k !== key || secs < ATTRIBUTION_BAND_SECS.min) {
      await finalize(sql, t, track, now);
      t.windows.delete(k);
    }
  }
  if (!(secs >= ATTRIBUTION_BAND_SECS.min && secs <= ATTRIBUTION_BAND_SECS.max)) return;
  if (t.boundary_ms == null) {
    const b = await readProspectiveBoundary(sql);
    if (!b) return;
    t.boundary_ms = b.ms; t.boundary_iso = b.iso;
  }
  // Prospective only: the window must have started after the boundary, and
  // after this observer session began (a restart never records a market it
  // only saw part of).
  if (snap.close_time - WINDOW_MS < t.boundary_ms) return;
  if (input.session_started_ms && snap.close_time - WINDOW_MS < input.session_started_ms) return;
  let track = t.windows.get(key);
  if (!track) { track = blankTrack(snap); t.windows.set(key, track); }
  noteTick(track, snap, chair.lean);
  const ctx = contextFromFrame(input.call_log, { ready: input.ready, start: input.start });
  const state = chairState(snap, chair, ctx, input.audit ?? null);

  if (!track.blind) {
    const opp = blindOpportunity(snap);
    if (opp) {
      track.blind = { side: opp.side, ask_exact: opp.quote.ask_exact, ask_whole: opp.quote.ask_whole, fee_exact: opp.fee_exact, decided_ms: snap.as_of, chair_lean_at: chair.lean, rejection_reason: state.gate?.binding_reason ?? null, eligible_at: state.gate ? state.gate.eligible_ignoring_confirmation : null };
      await write(sql, t, blindEligibleRow(snap, opp, state, { chair_positioned: state.gate?.positioned ?? null, ticks_in_band: track.ticks }), now);
    }
  }
  if (!track.chair) {
    const fill = (input.call_log ?? []).find((r) => r && r.ticker === snap.ticker && r.close_time === snap.close_time && (r.lean === "UP" || r.lean === "DOWN"));
    if (fill) {
      const q = sideQuote(snap, fill.lean);
      track.chair = { side: fill.lean, cents: fill.cents, booked_ms: fill.t, observed_ms: snap.as_of, ask_exact_observed: Number.isFinite(q.ask_exact) ? q.ask_exact : null };
      await write(sql, t, chairFillRow(snap, fill, state, track.blind ? { side: track.blind.side, ask_exact: track.blind.ask_exact, decided_ms: track.blind.decided_ms } : null, { ticks_in_band: track.ticks }), now);
    }
  }
}

export function attributionHealth(t: AttributionTracker | undefined): { boundary: string | null; tracking: number; written: number; failed: number; settled: number; error: string | null; last_write: number | null } {
  return { boundary: t?.boundary_iso ?? null, tracking: t?.windows.size ?? 0, written: t?.written ?? 0, failed: t?.failed ?? 0, settled: t?.settled ?? 0, error: t?.error ?? null, last_write: t?.last_write ?? null };
}
