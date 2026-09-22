/**
 * The one economic read model over the booked-position ledger.
 *
 * WHY THIS EXISTS. Four public surfaces printed four different "last week"
 * books in the same week (49/+159¢, 42/+76¢, 38/+8¢, 15/−165¢). They were the
 * same definition read at different hours, but nothing could prove it, because
 * every surface carried its own SQL, its own idea of a week and its own fee. The
 * all-time total likewise pooled 53 legacy multi-leg exits, whose "wins" are
 * positive-net positions, with 137 one-contract HOLD fills whose wins are
 * official settlements, and reported one win count.
 *
 * This module is the single arithmetic every surface can be reconciled against.
 * It takes ledger rows and an explicit SCOPE (inclusive start, exclusive end,
 * axis, time zone, ledger, as-of) and returns the book with every population
 * dimension separated: ledger, era, event kind, exit/quantity family. It never
 * invents a fill, never rewrites a recorded value, and reads its fee from the
 * versioned fee engine only.
 *
 * Pure module: no clock, no state, no database. Times are epoch milliseconds.
 */
import { CHAIR_FLOOR_SINCE_ISO, FLOOR_LIVE_SINCE } from "./book-floor.ts";
import { SELECTIVE_FROZEN_AT, SELECTIVE_V3_FROZEN_AT } from "./floor-policy.ts";
import { DEFAULT_FEE_ENGINE, allInCostCents, feeFingerprint, holdNetCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";

export const ECONOMICS_BOOK_VERSION = "ECONOMICS_BOOK_V1";

// ---------------------------------------------------------------------------
// Populations.
// ---------------------------------------------------------------------------

/** Which book a row belongs to. Never pooled. */
export type LedgerKind = "main_paper" | "shadow_70" | "arena" | "research";

export type EraId = "A0_pre_floor" | "A1_floor70" | "B_floor80_trial" | "C1_selective_v1v2" | "C2_selective_v3";

export type EraSpec = {
  id: EraId;
  /** Inclusive, UTC ISO. */
  since: string | null;
  /** Exclusive, UTC ISO; null = open. */
  until: string | null;
  entry_policy: string;
  exit_policy: string;
  /** What the rows in this era mean economically. */
  quantity: "legacy_mixed" | "one_contract_hold";
  why: string;
};

/**
 * Era boundaries, taken from the frozen constants that define them. The
 * pre-floor era carries legacy multi-leg/scalp exits (24 of its 53 fills settle
 * at a non-binary price), so it is a different population, not an earlier
 * sample of the same one.
 */
export const ERAS: readonly EraSpec[] = Object.freeze([
  { id: "A0_pre_floor", since: null, until: CHAIR_FLOOR_SINCE_ISO, entry_policy: "pre-floor (mixed)", exit_policy: "legacy scalp/multi-leg + HOLD", quantity: "legacy_mixed", why: "before the 70¢ floor shipped; settle_cents is an exit price on 24 of 53 fills" },
  { id: "A1_floor70", since: CHAIR_FLOOR_SINCE_ISO, until: FLOOR_LIVE_SINCE, entry_policy: "70¢ floor", exit_policy: "HOLD_V1", quantity: "one_contract_hold", why: "the 70¢ floor, one contract held to settlement" },
  { id: "B_floor80_trial", since: FLOOR_LIVE_SINCE, until: SELECTIVE_FROZEN_AT, entry_policy: "ENTRY_80_V1", exit_policy: "HOLD_V1", quantity: "one_contract_hold", why: "the 80¢ trial with the 70¢ shadow book on the same windows" },
  { id: "C1_selective_v1v2", since: SELECTIVE_FROZEN_AT, until: SELECTIVE_V3_FROZEN_AT, entry_policy: "ENTRY_SELECTIVE_V1/V2", exit_policy: "HOLD_V1", quantity: "one_contract_hold", why: "three-supporter quorum; zero fills" },
  { id: "C2_selective_v3", since: SELECTIVE_V3_FROZEN_AT, until: null, entry_policy: "ENTRY_SELECTIVE_V3", exit_policy: "HOLD_V1", quantity: "one_contract_hold", why: "two-supporter quorum; the current Champion" },
]);

export function eraOf(closeMs: number): EraId {
  for (const e of ERAS) {
    const since = e.since ? Date.parse(e.since) : -Infinity;
    const until = e.until ? Date.parse(e.until) : Infinity;
    if (closeMs >= since && closeMs < until) return e.id;
  }
  return "C2_selective_v3";
}

// ---------------------------------------------------------------------------
// Rows and events.
// ---------------------------------------------------------------------------

/** One ledger row, as the read model needs it. Nulls mean "not recorded", never zero. */
export type LedgerRow = {
  id: number;
  ticker: string;
  close_ms: number;
  graded_ms: number | null;
  winner: "UP" | "DOWN" | null;
  official_value: number | null;
  research_quality: string | null;
  chair_lean: string | null;
  entry_cents: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  entry_lean: "UP" | "DOWN" | null;
  entry_secs_left: number | null;
  shadow_entry_cents: number | null;
  shadow_ev_cents: number | null;
};

export type EventKind =
  | "no_decision"
  | "chair_read_no_book"
  | "booked_pending"
  | "booked_settled"
  | "booked_legacy_exit"
  | "scratch"
  | "excluded";

export type ClassifiedRow = {
  row: LedgerRow;
  era: EraId;
  event: EventKind;
  /** True when settle_cents is 0/100 and ev equals the HOLD identity within 0.05¢. */
  hold_identity: boolean | null;
  /** Official settlement win of the booked side; null when unknowable from the row. */
  official_win: boolean | null;
  /** ask + fee under the engine; null without an entry. */
  all_in_cost: number | null;
};

/** Classify one row. Excluded research quality is reported, never dropped. */
export function classifyRow(row: LedgerRow, engine: FeeEngineId = DEFAULT_FEE_ENGINE): ClassifiedRow {
  const era = eraOf(row.close_ms);
  const base = { row, era, hold_identity: null as boolean | null, official_win: null as boolean | null, all_in_cost: null as number | null };
  if (row.research_quality != null && row.research_quality !== "valid") return { ...base, event: "excluded" };
  if (row.entry_cents == null || !realAskCents(row.entry_cents)) {
    return { ...base, event: row.chair_lean === "UP" || row.chair_lean === "DOWN" ? "chair_read_no_book" : "no_decision" };
  }
  const all_in_cost = allInCostCents(row.entry_cents, engine);
  if (row.settle_cents == null || row.ev_cents == null) return { ...base, all_in_cost, event: "booked_pending" };
  const binary = row.settle_cents === 0 || row.settle_cents === 100;
  if (!binary) {
    return { ...base, all_in_cost, hold_identity: false, event: row.ev_cents === 0 ? "scratch" : "booked_legacy_exit" };
  }
  const won = row.settle_cents === 100;
  const identity = Math.abs(row.ev_cents - holdNetCents(row.entry_cents, won, engine)) <= 0.05;
  return { ...base, all_in_cost, official_win: won, hold_identity: identity, event: identity ? "booked_settled" : "booked_legacy_exit" };
}

// ---------------------------------------------------------------------------
// Scopes.
// ---------------------------------------------------------------------------

export type ScopeSpec = {
  id: string;
  ledger: LedgerKind;
  /** Inclusive lower bound on the axis, epoch ms; null = unbounded. */
  start_ms: number | null;
  /** Exclusive upper bound on the axis, epoch ms; null = unbounded. */
  end_ms: number | null;
  axis: "close_time";
  tz: "UTC" | "America/Chicago";
  /** Settlements known at this instant count; later grades are pending. */
  as_of_ms: number;
  eras?: readonly EraId[];
  /** The policy composition this scope claims, for the manifest; not used to filter. */
  policy_fingerprint?: string;
  note?: string;
};

const CHI = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Chicago calendar day of an instant, YYYY-MM-DD. */
export function chicagoDayOf(ms: number): string {
  return CHI.format(new Date(ms));
}

/** First instant of a Chicago calendar day, DST-safe (the offset is found, not assumed). */
export function chicagoDayStartMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  let t = Date.UTC(y, m - 1, d) + 5 * 3_600_000;
  for (let i = 0; i < 30 && chicagoDayOf(t) < day; i += 1) t += 3_600_000;
  for (let i = 0; i < 30 && chicagoDayOf(t) > day; i += 1) t -= 3_600_000;
  for (let i = 0; i < 24 * 60 && chicagoDayOf(t - 60_000) === day; i += 1) t -= 60_000;
  return t;
}

/** Exclusive end of a Chicago day = start of the next one. */
export function chicagoDayEndMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return chicagoDayStartMs(chicagoDayOf(Date.UTC(y, m - 1, d) + 30 * 3_600_000));
}

/** Monday-start ISO week key for a Chicago day, as the Monday's date. */
export function chicagoWeekKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const noon = Date.UTC(y, m - 1, d, 12);
  const dow = new Date(noon).getUTCDay();
  const monday = noon - ((dow + 6) % 7) * 86_400_000;
  return new Date(monday).toISOString().slice(0, 10);
}

/** /books "week": close_time in (as_of − 168h, as_of]. Rolling, not a calendar week. */
export function rollingHoursScope(asOfMs: number, hours: number, ledger: LedgerKind = "main_paper"): ScopeSpec {
  return { id: `rolling_${hours}h`, ledger, start_ms: asOfMs - hours * 3_600_000 + 1, end_ms: asOfMs + 1, axis: "close_time", tz: "UTC", as_of_ms: asOfMs, note: "close_time > as_of − hours AND close_time <= as_of" };
}

/** One Chicago calendar day, or a closed range of them (the recap's "yesterday − 6 .. yesterday"). */
export function chicagoDaysScope(fromDay: string, toDay: string, asOfMs: number, ledger: LedgerKind = "main_paper"): ScopeSpec {
  return { id: `chicago_${fromDay}_${toDay}`, ledger, start_ms: chicagoDayStartMs(fromDay), end_ms: chicagoDayEndMs(toDay), axis: "close_time", tz: "America/Chicago", as_of_ms: asOfMs };
}

/** The last completed Monday-to-Sunday Chicago week strictly before as_of's day. */
export function completedWeekScope(asOfMs: number, ledger: LedgerKind = "main_paper"): ScopeSpec {
  const today = chicagoDayOf(asOfMs);
  const monday = chicagoWeekKey(today);
  const prevMondayMs = Date.UTC(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)) - 1, Number(monday.slice(8, 10)), 12) - 7 * 86_400_000;
  const prevMonday = new Date(prevMondayMs).toISOString().slice(0, 10);
  const prevSunday = new Date(prevMondayMs + 6 * 86_400_000).toISOString().slice(0, 10);
  return { ...chicagoDaysScope(prevMonday, prevSunday, asOfMs, ledger), id: `completed_week_${prevMonday}` };
}

export function sinceScope(id: string, sinceIso: string, asOfMs: number, ledger: LedgerKind = "main_paper"): ScopeSpec {
  return { id, ledger, start_ms: Date.parse(sinceIso), end_ms: asOfMs + 1, axis: "close_time", tz: "UTC", as_of_ms: asOfMs };
}

export function allScope(asOfMs: number, ledger: LedgerKind = "main_paper"): ScopeSpec {
  return { id: "all", ledger, start_ms: null, end_ms: asOfMs + 1, axis: "close_time", tz: "UTC", as_of_ms: asOfMs };
}

export function inScope(row: LedgerRow, scope: ScopeSpec): boolean {
  if (scope.start_ms != null && row.close_ms < scope.start_ms) return false;
  if (scope.end_ms != null && row.close_ms >= scope.end_ms) return false;
  if (scope.eras && !scope.eras.includes(eraOf(row.close_ms))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The book.
// ---------------------------------------------------------------------------

export type Tail = { value: number | null; unit: string; n: number; descriptive: boolean };

export type BookSummary = {
  version: typeof ECONOMICS_BOOK_VERSION;
  scope: ScopeSpec;
  fee_fingerprint: string;
  windows: number;
  excluded_windows: number;
  /** Windows with a directional Chair read at grade OR a booked entry. */
  decisions: number;
  chair_reads_no_book: number;
  /** Fills whose settlement is unknown at as_of. Their full loss is reserved, never netted. */
  pending_fills: number;
  pending_full_loss_exposure_cents: number;
  /** Booked entries with an official 0/100 settlement and a HOLD identity. */
  settled_hold_fills: number;
  /** Booked entries the identity cannot describe (legacy exits, scratches). Reported, never netted with HOLD. */
  legacy_exit_fills: number;
  scratches: number;
  official_wins: number;
  official_wr_pct: number | null;
  needed_wr_pct: number | null;
  /** Σ ev over settled HOLD fills, after the engine fee. */
  net_cents: number;
  /** Σ ev over legacy rows, kept apart. */
  legacy_net_cents: number;
  net_per_fill: number | null;
  net_per_100_windows: number | null;
  no_book_rate_pct: number | null;
  /** UNKNOWN from the ledger alone: needs decision receipts. */
  entry_time_wait_rate_pct: null;
  avg_ask: number | null;
  avg_fee: number | null;
  losses: number;
  /** Ledger-contract fields: what precision the stored asks can claim, and the span covered. */
  price_precision: "whole_cent_stored; exact fraction UNKNOWN for asks < 10¢ or ≥ 90¢";
  start_ms: number | null;
  end_ms: number | null;
  /** Peak-to-trough on cumulative settled-HOLD net, ordered by (close_time, id). */
  max_drawdown_cents: number;
  drawdown_order: "close_time,id";
  worst_week: { week: string; net: number } | null;
  cvar5: Tail;
  /** Hours from the max-drawdown peak until cumulative net first regains it. Censored when not yet regained. */
  time_to_recover: { hours: number | null; censored: boolean; peak_at: number | null; trough_at: number | null };
  identity_mismatches: number;
  by_era: Array<{ era: EraId; windows: number; fills: number; official_wins: number; net: number; legacy: number }>;
};

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the book for a scope. `rows` may be any superset; the scope filters.
 * Settlements graded after as_of are treated as pending, so a report is
 * reproducible for the instant it claims.
 */
export function bookSummary(rows: readonly LedgerRow[], scope: ScopeSpec, engine: FeeEngineId = DEFAULT_FEE_ENGINE): BookSummary {
  const scoped = rows.filter((r) => inScope(r, scope)).sort((a, b) => a.close_ms - b.close_ms || a.id - b.id);
  const classified = scoped.map((r) => {
    const known = r.graded_ms == null || r.graded_ms <= scope.as_of_ms;
    const asOfRow: LedgerRow = known ? r : { ...r, settle_cents: null, ev_cents: null, winner: null };
    return classifyRow(asOfRow, engine);
  });
  const valid = classified.filter((c) => c.event !== "excluded");
  const settled = valid.filter((c) => c.event === "booked_settled");
  const legacy = valid.filter((c) => c.event === "booked_legacy_exit" || c.event === "scratch");
  const pending = valid.filter((c) => c.event === "booked_pending");
  const booked = settled.length + legacy.length + pending.length;
  const wins = settled.filter((c) => c.official_win === true).length;
  const asks = settled.map((c) => c.row.entry_cents!);
  const cost = settled.reduce((s, c) => s + (c.all_in_cost ?? 0), 0);
  const net = settled.reduce((s, c) => s + (c.row.ev_cents ?? 0), 0);
  const legacyNet = legacy.reduce((s, c) => s + (c.row.ev_cents ?? 0), 0);

  // Path statistics on settled HOLD fills only, in ledger order.
  let cum = 0, peak = 0, worst = 0, peakAt: number | null = null, troughAt: number | null = null, peakAtWorst: number | null = null;
  const cumSeries: Array<{ at: number; cum: number }> = [];
  for (const c of settled) {
    cum += c.row.ev_cents ?? 0;
    if (cum >= peak) { peak = cum; peakAt = c.row.close_ms; }
    const dd = cum - peak;
    if (dd < worst) { worst = dd; troughAt = c.row.close_ms; peakAtWorst = peakAt; }
    cumSeries.push({ at: c.row.close_ms, cum });
  }
  let recoverHours: number | null = null;
  let censored = false;
  if (worst < 0 && troughAt != null && peakAtWorst != null) {
    const peakLevel = cumSeries.filter((p) => p.at <= peakAtWorst).at(-1)?.cum ?? 0;
    const back = cumSeries.find((p) => p.at > troughAt && p.cum >= peakLevel);
    if (back) recoverHours = r1((back.at - peakAtWorst) / 3_600_000);
    else censored = true;
  }

  const byWeek = new Map<string, number>();
  for (const c of settled) {
    const k = chicagoWeekKey(chicagoDayOf(c.row.close_ms));
    byWeek.set(k, (byWeek.get(k) ?? 0) + (c.row.ev_cents ?? 0));
  }
  let worstWeek: { week: string; net: number } | null = null;
  for (const [week, n] of byWeek) if (!worstWeek || n < worstWeek.net) worstWeek = { week, net: r1(n) };

  const nets = settled.map((c) => c.row.ev_cents ?? 0).sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(nets.length * 0.05));
  const cvar5: Tail = {
    value: nets.length ? r1(nets.slice(0, k).reduce((s, x) => s + x, 0) / k) : null,
    unit: "cents per settled one-contract fill (mean of the worst 5%)",
    n: nets.length,
    descriptive: nets.length < 20,
  };

  const eras = new Map<EraId, { windows: number; fills: number; official_wins: number; net: number; legacy: number }>();
  for (const c of valid) {
    const e = eras.get(c.era) ?? { windows: 0, fills: 0, official_wins: 0, net: 0, legacy: 0 };
    e.windows += 1;
    if (c.event === "booked_settled" || c.event === "booked_legacy_exit" || c.event === "scratch" || c.event === "booked_pending") e.fills += 1;
    if (c.official_win) e.official_wins += 1;
    if (c.event === "booked_settled") e.net += c.row.ev_cents ?? 0;
    if (c.event === "booked_legacy_exit" || c.event === "scratch") e.legacy += c.row.ev_cents ?? 0;
    eras.set(c.era, e);
  }

  return {
    version: ECONOMICS_BOOK_VERSION,
    scope,
    fee_fingerprint: feeFingerprint(engine),
    windows: valid.length,
    excluded_windows: classified.length - valid.length,
    decisions: valid.filter((c) => c.event !== "no_decision").length,
    chair_reads_no_book: valid.filter((c) => c.event === "chair_read_no_book").length,
    pending_fills: pending.length,
    pending_full_loss_exposure_cents: r1(pending.reduce((s, c) => s + (c.all_in_cost ?? 0), 0)),
    settled_hold_fills: settled.length,
    legacy_exit_fills: legacy.length,
    scratches: valid.filter((c) => c.event === "scratch").length,
    official_wins: wins,
    official_wr_pct: settled.length ? r1((100 * wins) / settled.length) : null,
    needed_wr_pct: settled.length ? Math.round((cost / settled.length) * 100) / 100 : null,
    net_cents: r1(net),
    legacy_net_cents: r1(legacyNet),
    net_per_fill: settled.length ? Math.round((net / settled.length) * 100) / 100 : null,
    net_per_100_windows: valid.length ? r1((net / valid.length) * 100) : null,
    no_book_rate_pct: valid.length ? r1((100 * (valid.length - booked)) / valid.length) : null,
    entry_time_wait_rate_pct: null,
    avg_ask: asks.length ? r1(asks.reduce((s, a) => s + a, 0) / asks.length) : null,
    avg_fee: settled.length ? Math.round(((cost - asks.reduce((s, a) => s + a, 0)) / settled.length) * 100) / 100 : null,
    losses: settled.filter((c) => c.official_win === false).length,
    price_precision: "whole_cent_stored; exact fraction UNKNOWN for asks < 10¢ or ≥ 90¢",
    start_ms: scoped.length ? scoped[0]!.close_ms : null,
    end_ms: scoped.length ? scoped[scoped.length - 1]!.close_ms : null,
    max_drawdown_cents: r1(worst),
    drawdown_order: "close_time,id",
    worst_week: worstWeek,
    cvar5,
    time_to_recover: { hours: recoverHours, censored, peak_at: peakAtWorst, trough_at: troughAt },
    identity_mismatches: valid.filter((c) => c.hold_identity === false).length,
    by_era: [...eras.entries()].map(([era, e]) => ({ era, ...e, net: r1(e.net), legacy: r1(e.legacy) })).sort((a, b) => a.era.localeCompare(b.era)),
  };
}

// ---------------------------------------------------------------------------
// Anti-joins between two surfaces.
// ---------------------------------------------------------------------------

export type SurfaceRow = { key: string; entry_cents: number | null; settle_cents: number | null; ev_cents: number | null; fee_cents: number | null };

export type SurfaceDiff = {
  missing_in_b: string[];
  extra_in_b: string[];
  duplicate_in_a: string[];
  duplicate_in_b: string[];
  differently_graded: string[];
  differently_priced: string[];
  differently_fee_treated: string[];
  pending_in_one: string[];
};

/** Row-level explanation of why two surfaces disagree. Keys are `ticker|close_ms`. */
export function diffSurfaces(a: readonly SurfaceRow[], b: readonly SurfaceRow[]): SurfaceDiff {
  const dup = (rows: readonly SurfaceRow[]) => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  };
  const ma = new Map(a.map((r) => [r.key, r]));
  const mb = new Map(b.map((r) => [r.key, r]));
  const out: SurfaceDiff = { missing_in_b: [], extra_in_b: [], duplicate_in_a: dup(a), duplicate_in_b: dup(b), differently_graded: [], differently_priced: [], differently_fee_treated: [], pending_in_one: [] };
  for (const [k, ra] of ma) {
    const rb = mb.get(k);
    if (!rb) { out.missing_in_b.push(k); continue; }
    if ((ra.settle_cents == null) !== (rb.settle_cents == null)) { out.pending_in_one.push(k); continue; }
    if (ra.settle_cents !== rb.settle_cents) out.differently_graded.push(k);
    if (ra.entry_cents !== rb.entry_cents) out.differently_priced.push(k);
    if (ra.fee_cents != null && rb.fee_cents != null && ra.fee_cents !== rb.fee_cents) out.differently_fee_treated.push(k);
    else if (ra.entry_cents === rb.entry_cents && ra.settle_cents === rb.settle_cents && ra.ev_cents !== rb.ev_cents) out.differently_fee_treated.push(k);
  }
  for (const k of mb.keys()) if (!ma.has(k)) out.extra_in_b.push(k);
  return out;
}
