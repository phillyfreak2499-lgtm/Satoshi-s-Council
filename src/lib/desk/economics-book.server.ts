/**
 * The economic read model over the real ledger (server only, read-only).
 *
 * One bounded SELECT of `desk_ledger` (the raw table, so excluded rows are
 * visible), then every public scope is rebuilt through `bookSummary` and
 * compared with an INDEPENDENT reference query that mirrors the Books SQL at
 * the same as-of. A common scope must reconcile exactly; different scopes
 * report their differences row by row. Nothing here writes, and nothing here
 * reaches the Chair, the paper book, the learner or a promotion.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { CHAIR_FLOOR_SINCE_ISO, FLOOR_LIVE_SINCE } from "./book-floor.ts";
import { SELECTIVE_ENTRY_ID, SELECTIVE_FROZEN_AT, SELECTIVE_V3_FROZEN_AT, ENTRY_SELECTIVE_V3, fingerprint } from "./floor-policy.ts";
import { DEFAULT_FEE_ENGINE, feeFingerprint, type FeeEngineId } from "./fee-engine.ts";
import {
  ECONOMICS_BOOK_VERSION, allScope, bookSummary, chicagoDayOf, chicagoDaysScope, completedWeekScope, diffSurfaces, rollingHoursScope,
  sinceScope, type BookSummary, type LedgerRow, type ScopeSpec, type SurfaceDiff, type SurfaceRow,
} from "./economics-book.ts";

export const RECONCILE_VERSION = "RECONCILE_BOOK_V1";

/** The ledger read: raw table, bounded by close_time, ordered for the drawdown path. */
export const LEDGER_QUERY = `
  select id, ticker,
    (extract(epoch from close_time) * 1000)::bigint as close_ms,
    (extract(epoch from graded_at) * 1000)::bigint as graded_ms,
    winner, official_value, research_quality, chair_lean,
    entry_cents, settle_cents, ev_cents, entry_lean, entry_secs_left,
    shadow_entry_cents, shadow_ev_cents
  from desk_ledger
  where close_time >= $1::timestamptz and close_time <= $2::timestamptz
  order by close_time, id`;

/**
 * The reference totals, written to mirror books.server.ts's period query with
 * `now()` replaced by the as-of so both sides describe the same instant. Kept
 * as a string so its hash is in the manifest.
 */
export const REFERENCE_QUERY = `
  with base as (
    select ev_cents, entry_cents, winner,
      (close_time at time zone 'America/Chicago')::date = ($1::timestamptz at time zone 'America/Chicago')::date as today,
      close_time > $1::timestamptz - interval '7 days' as week,
      close_time >= $2::timestamptz as floored
    from desk_ledger_research
    where close_time <= $1::timestamptz and (graded_at is null or graded_at <= $1::timestamptz))
  select p.period,
    count(*)::int as n,
    (count(*) filter (where entry_cents is not null))::int as calls,
    (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as ev_positive,
    coalesce(sum(ev_cents), 0)::float as net
  from base
  cross join (values ('all'), ('week'), ('floor'), ('today')) as p(period)
  where p.period = 'all' or (p.period = 'week' and week) or (p.period = 'floor' and floored) or (p.period = 'today' and today)
  group by 1`;

export type ReferenceTotals = { period: string; n: number; calls: number; ev_positive: number; net: number };

export type ScopeCheck = {
  scope_id: string;
  book: BookSummary;
  reference: ReferenceTotals | null;
  /** Exact-match verdict on the cells both sides define the same way. */
  reconciled: boolean | null;
  cells: Array<{ cell: string; model: number | null; reference: number | null; equal: boolean }>;
};

export type Reconciliation = {
  version: typeof RECONCILE_VERSION;
  model_version: typeof ECONOMICS_BOOK_VERSION;
  as_of: string;
  since: string;
  source_sha: string;
  fee_fingerprint: string;
  policy_fingerprint: string;
  champion_entry_policy: string;
  ledger_query_sha256: string;
  reference_query_sha256: string;
  rows_read: number;
  scopes: ScopeCheck[];
  eras: BookSummary[];
  /** Rolling-week vs recap-week (Chicago days) anti-join: the same "week" is not the same rows. */
  week_definitions_diff: SurfaceDiff;
  notes: string[];
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function toRow(r: Record<string, unknown>): LedgerRow {
  const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const lean = (v: unknown): "UP" | "DOWN" | null => (v === "UP" || v === "DOWN" ? v : null);
  return {
    id: Number(r.id), ticker: String(r.ticker), close_ms: Number(r.close_ms), graded_ms: num(r.graded_ms),
    winner: lean(r.winner), official_value: num(r.official_value), research_quality: r.research_quality == null ? null : String(r.research_quality),
    chair_lean: r.chair_lean == null ? null : String(r.chair_lean), entry_cents: num(r.entry_cents), settle_cents: num(r.settle_cents),
    ev_cents: num(r.ev_cents), entry_lean: lean(r.entry_lean), entry_secs_left: num(r.entry_secs_left),
    shadow_entry_cents: num(r.shadow_entry_cents), shadow_ev_cents: num(r.shadow_ev_cents),
  };
}

function surface(rows: readonly LedgerRow[], scope: ScopeSpec): SurfaceRow[] {
  return rows
    .filter((r) => r.entry_cents != null && (scope.start_ms == null || r.close_ms >= scope.start_ms) && (scope.end_ms == null || r.close_ms < scope.end_ms))
    .map((r) => ({ key: `${r.ticker}|${r.close_ms}`, entry_cents: r.entry_cents, settle_cents: r.settle_cents, ev_cents: r.ev_cents, fee_cents: null }));
}

/**
 * Rebuild every public scope at one as-of. `sinceIso` bounds the read (default:
 * the ledger's first day); the bound is part of the manifest.
 */
export async function reconcileBook(opts: { asOfIso: string; sinceIso?: string; engine?: FeeEngineId; sourceSha?: string }): Promise<Reconciliation> {
  const engine = opts.engine ?? DEFAULT_FEE_ENGINE;
  const asOfMs = Date.parse(opts.asOfIso);
  const since = opts.sinceIso ?? "2026-09-01T00:00:00Z";
  const sql = await getSql();
  const raw = await sql.query<Record<string, unknown>>(LEDGER_QUERY, [since, opts.asOfIso]);
  const rows = raw.map(toRow);
  const ref = await sql.query<ReferenceTotals>(REFERENCE_QUERY, [opts.asOfIso, CHAIR_FLOOR_SINCE_ISO]);
  const refBy = new Map(ref.map((r) => [r.period, { ...r, n: Number(r.n), calls: Number(r.calls), ev_positive: Number(r.ev_positive), net: Number(r.net) }]));

  const today = chicagoDayOf(asOfMs);
  const scopes: Array<[string, ScopeSpec]> = [
    ["all", allScope(asOfMs)],
    ["week", rollingHoursScope(asOfMs, 168)],
    ["floor", sinceScope("floor", CHAIR_FLOOR_SINCE_ISO, asOfMs)],
    ["today", chicagoDaysScope(today, today, asOfMs)],
  ];
  const checks: ScopeCheck[] = scopes.map(([period, scope]) => {
    const book = bookSummary(rows, scope, engine);
    const reference = refBy.get(period) ?? null;
    const fills = book.settled_hold_fills + book.legacy_exit_fills + book.pending_fills;
    const net = Math.round((book.net_cents + book.legacy_net_cents) * 10) / 10;
    const cells = reference
      ? [
          { cell: "windows(valid)", model: book.windows, reference: reference.n, equal: book.windows === reference.n },
          { cell: "fills(any entry)", model: fills, reference: reference.calls, equal: fills === reference.calls },
          { cell: "net(all entries, incl. legacy)", model: net, reference: Math.round(reference.net * 10) / 10, equal: Math.abs(net - reference.net) < 0.051 },
        ]
      : [];
    return { scope_id: scope.id, book, reference, reconciled: reference ? cells.every((c) => c.equal) : null, cells };
  });

  const eras: BookSummary[] = [
    sinceScope("era_A0_pre_floor", since, asOfMs), sinceScope("era_A1_floor70", CHAIR_FLOOR_SINCE_ISO, asOfMs),
    sinceScope("era_B_floor80_trial", FLOOR_LIVE_SINCE, asOfMs), sinceScope("era_C1_selective_v1v2", SELECTIVE_FROZEN_AT, asOfMs),
    sinceScope("era_C2_selective_v3", SELECTIVE_V3_FROZEN_AT, asOfMs),
  ].map((s, i, all) => bookSummary(rows, { ...s, end_ms: all[i + 1]?.start_ms ?? asOfMs + 1 }, engine));

  const rolling = rollingHoursScope(asOfMs, 168);
  const yesterday = chicagoDayOf(asOfMs - 86_400_000);
  const recapFrom = chicagoDayOf(Date.parse(`${yesterday}T12:00:00Z`) - 6 * 86_400_000);
  const recap = chicagoDaysScope(recapFrom, yesterday, asOfMs);
  const completed = completedWeekScope(asOfMs);

  return {
    version: RECONCILE_VERSION,
    model_version: ECONOMICS_BOOK_VERSION,
    as_of: opts.asOfIso,
    since,
    source_sha: opts.sourceSha ?? process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "UNKNOWN",
    fee_fingerprint: feeFingerprint(engine),
    policy_fingerprint: fingerprint(ENTRY_SELECTIVE_V3),
    champion_entry_policy: SELECTIVE_ENTRY_ID,
    ledger_query_sha256: sha(LEDGER_QUERY),
    reference_query_sha256: sha(REFERENCE_QUERY),
    rows_read: rows.length,
    scopes: [
      ...checks,
      { scope_id: recap.id, book: bookSummary(rows, recap, engine), reference: null, reconciled: null, cells: [] },
      { scope_id: completed.id, book: bookSummary(rows, completed, engine), reference: null, reconciled: null, cells: [] },
    ],
    eras,
    week_definitions_diff: diffSurfaces(surface(rows, rolling), surface(rows, recap)),
    notes: [
      "reference cells count any entry (settled, pending or legacy) and net every ev, exactly as /books does; the model separates them",
      "the reference query is books.server.ts's period query with now() replaced by the as-of; it is not a second source of truth",
      "the recap week (Chicago yesterday − 6 .. yesterday) and the rolling 168h week are different populations by design",
    ],
  };
}
