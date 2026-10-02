/**
 * QUIET_CALL_LEDGER_V1 — persistence and the admin-only report. AUTHORITY: NONE.
 *
 * Every write here is fire-and-forget from the engine's point of view: callers
 * `void` these and route failures to noteErr, so a slow or failing database can
 * never block a tick, a grade, or a huddle. Capture rows use ON CONFLICT DO
 * NOTHING; grade updates only touch rows still PENDING, so a retry or a
 * restart can never rewrite a graded call.
 *
 * The JSON QuietBook (desk_state) is authoritative for the leaderboard and the
 * huddle review; this table is authoritative for kill analysis and audit.
 */
import { getSql } from "@/lib/db";
import { creditDirectional } from "./learner";
import {
  evaluateKill,
  quietBoard,
  rebuildBookFromRows,
  QUIET_SEATS,
  type KillVerdict,
  type QuietBook,
  type QuietCapture,
  type QuietGradeResult,
  type QuietRow,
} from "./quiet-call";

const iso = (ms: number) => new Date(ms);

/**
 * All quiet writes run in issue order on one chain, so a window's grade can never
 * overtake its own capture insert. A failed write rejects only its own caller
 * (who routes it to noteErr); the chain itself always continues.
 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function writeQuietCapture(c: QuietCapture): Promise<void> {
  return serial(() => insertCapture(c));
}

async function insertCapture(c: QuietCapture): Promise<void> {
  const db = await getSql();
  for (const q of c.calls) {
    await db`
      insert into desk_quiet_calls (ticker, close_time, seat, captured_at, mins_left, regime_key, side, conf_raw, p_used,
        source, paper_card_id, closed_card, admitted_lean, admitted_state, skill_used, yes_ask, no_ask, yes_mid, build_sha)
      values (${c.ticker}, ${iso(c.close_time)}, ${q.seat}, ${iso(c.as_of)}, ${c.mins_left}, ${c.regime_key}, ${q.side},
        ${q.conf_raw}, ${q.p}, ${q.source}, ${q.paper_card_id}, ${q.closed_card}, ${q.admitted_lean}, ${q.admitted_state},
        ${q.skill_used}, ${c.yes_ask}, ${c.no_ask}, ${c.yes_mid}, ${c.build_sha})
      on conflict (ticker, close_time, seat) do nothing
    `;
  }
  await db`
    insert into desk_quiet_windows (ticker, close_time, status) values (${c.ticker}, ${iso(c.close_time)}, 'CAPTURED')
    on conflict (ticker, close_time) do nothing
  `;
}

export function writeQuietMissed(ticker: string, closeTime: number): Promise<void> {
  return serial(() => insertMissed(ticker, closeTime));
}

async function insertMissed(ticker: string, closeTime: number): Promise<void> {
  const db = await getSql();
  await db`
    insert into desk_quiet_windows (ticker, close_time, status) values (${ticker}, ${iso(closeTime)}, 'MISSED')
    on conflict (ticker, close_time) do nothing
  `;
}

type GradeStatus = "GRADED" | "SKIPPED_CHALK" | "SKIPPED_UNCOUNTABLE" | "SKIPPED_IDENTITY";

/**
 * Settles a window's rows. An upsert, so it is correct even if the capture insert
 * was lost (DB outage, restart): the full call is written from the capture the
 * engine holds. A row that is already settled is never rewritten.
 */
export function writeQuietGrade(
  c: QuietCapture,
  status: GradeStatus,
  rows: QuietGradeResult["rows"],
  gradedAt: number,
): Promise<void> {
  return serial(() => upsertGrade(c, status, rows, gradedAt));
}

async function upsertGrade(c: QuietCapture, status: GradeStatus, rows: QuietGradeResult["rows"], gradedAt: number): Promise<void> {
  const db = await getSql();
  // Restore the window receipt even when the original capture insert was lost.
  await db`
    insert into desk_quiet_windows (ticker, close_time, status) values (${c.ticker}, ${iso(c.close_time)}, 'CAPTURED')
    on conflict (ticker, close_time) do nothing
  `;
  for (const q of c.calls) {
    const r = status === "GRADED" ? rows.find((x) => x.seat === q.seat) ?? null : null;
    if (status === "GRADED" && !r) continue;
    await db`
      insert into desk_quiet_calls (ticker, close_time, seat, captured_at, mins_left, regime_key, side, conf_raw, p_used,
        source, paper_card_id, closed_card, admitted_lean, admitted_state, skill_used, yes_ask, no_ask, yes_mid, build_sha,
        grade_status, finish, hit, cents, coin_cents, graded_at)
      values (${c.ticker}, ${iso(c.close_time)}, ${q.seat}, ${iso(c.as_of)}, ${c.mins_left}, ${c.regime_key}, ${q.side},
        ${q.conf_raw}, ${q.p}, ${q.source}, ${q.paper_card_id}, ${q.closed_card}, ${q.admitted_lean}, ${q.admitted_state},
        ${q.skill_used}, ${c.yes_ask}, ${c.no_ask}, ${c.yes_mid}, ${c.build_sha},
        ${status}, ${r?.finish ?? null}, ${r?.hit ?? null}, ${r?.cents ?? null}, ${r?.coin_cents ?? null}, ${iso(gradedAt)})
      on conflict (ticker, close_time, seat) do update set
        grade_status = excluded.grade_status, finish = excluded.finish, hit = excluded.hit, cents = excluded.cents,
        coin_cents = excluded.coin_cents, graded_at = excluded.graded_at
      where desk_quiet_calls.grade_status = 'PENDING'
    `;
  }
}

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : Number(v));
const n = (v: unknown) => (v == null ? null : Number(v));

/** Graded and skipped rows for windows captured since activation. Read-only. */
export async function loadQuietRows(activatedAt: number): Promise<QuietRow[]> {
  const db = await getSql();
  const rows = await db<Record<string, unknown>>`
    select ticker, close_time, seat, source, grade_status, hit, cents, coin_cents, p_used, admitted_state, regime_key, captured_at
    from desk_quiet_calls
    where captured_at >= ${iso(activatedAt)} and grade_status <> 'PENDING'
    order by close_time asc, seat asc
  `;
  return rows.map((r) => ({
    ticker: String(r.ticker),
    close_time: ms(r.close_time),
    seat: String(r.seat),
    source: String(r.source),
    grade_status: String(r.grade_status),
    hit: n(r.hit),
    cents: n(r.cents),
    coin_cents: n(r.coin_cents),
    p_used: Number(r.p_used),
    admitted_state: String(r.admitted_state),
    regime_key: String(r.regime_key),
    captured_at: ms(r.captured_at),
  }));
}

/** The pre-registered §9 evaluation, run once when the huddle review says it is due. */
export async function runQuietKill(book: QuietBook, now: number): Promise<KillVerdict> {
  const frozen = structuredClone(book);
  return serial(async () => {
    const rows = await loadQuietRows(frozen.activated_at);
    return evaluateKill(rows, frozen, now);
  });
}

/** Admin-only research report: the leaderboard plus table↔book reconciliation. */
export async function quietReport(book: QuietBook, enabled: boolean, pendingCaptures: number) {
  const board = quietBoard(book);
  let reconciliation: { ok: boolean; drift_seats: string[]; table_windows: number; error?: string } | null = null;
  if (book.activated_at > 0) {
    try {
      const rows = await loadQuietRows(book.activated_at);
      const rebuilt = rebuildBookFromRows(rows, creditDirectional, book.activated_at);
      const drift = QUIET_SEATS.filter((s) => {
        const a = book.seats[s]?.all;
        const b = rebuilt.seats[s]?.all;
        return (a?.n ?? 0) !== (b?.n ?? 0) || (a?.hits ?? 0) !== (b?.hits ?? 0);
      });
      reconciliation = { ok: drift.length === 0, drift_seats: drift, table_windows: rebuilt.graded_windows };
    } catch (err) {
      reconciliation = { ok: false, drift_seats: [], table_windows: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return {
    experiment: "QUIET_CALL_LEDGER_V1",
    enabled,
    pending_captures: pendingCaptures,
    board,
    reconciliation,
    authority: { production_authority: "NONE", promotes_nothing: true, books_nothing: true, paper_only: true, simulated_only: true },
  };
}
