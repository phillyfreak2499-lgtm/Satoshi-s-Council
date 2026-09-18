/**
 * The hourly closer — a shadow grader for the hourly book. Pure.
 *
 * After a KXBTCD hour closes and Kalshi's public record shows how it settled,
 * the closer turns that hour into one row for desk_hour_ledger. The row is a
 * WAIT sit until a frozen hourly rule exists and is marked live; today no
 * such rule exists, so every row the closer writes is a sit with no fill.
 * A fill is never invented to have something to show, and an hour whose
 * settlement is not known is skipped and left missing rather than guessed.
 *
 * The contract is a strike ladder ("$X or above" at the top of the hour,
 * Eastern, on the CF Benchmarks value), never the 15-minute UP/DOWN. Nothing
 * here reads or writes the 15-minute ledger, the Chair, the learner, or any
 * promotion gate. Authority: none. Paper only. No live orders.
 */
import { HOUR_BOOK_AUTHORITY, HOUR_POSTURE, HOUR_SERIES, hourQuestion, parseHourTicker, type HourMarketRow, type HourTicker } from "./hour.ts";

/** How far back a closed hour may be before the closer stops trying to grade it. A restart gap longer than this leaves the hour missing. */
export const HOUR_CLOSER_LOOKBACK_MS = 3 * 60 * 60 * 1000;
/** How often the closer asks the public record for newly settled hours. */
export const HOUR_CLOSER_EVERY_MS = 5 * 60 * 1000;
/** The first pass waits for the server to finish booting; the closer never races the 15-minute floor. */
export const HOUR_CLOSER_FIRST_DELAY_MS = 15_000;
/** Written into every row: where the settlement came from. */
export const HOUR_CLOSER_SOURCE = "kalshi-settled";
/** The provider's close may drift this much from the ticker's own clock before the row is distrusted. */
const CLOSE_TOLERANCE_MS = 60_000;

const SETTLED_STATUSES = new Set(["settled", "finalized", "determined", "closed_settled"]);

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The settled side, from Kalshi's own result field. Anything else is unknown, never a guess. */
export function settledSide(row: HourMarketRow): "YES" | "NO" | null {
  const r = String(row.result ?? "").trim().toLowerCase();
  if (r === "yes") return "YES";
  if (r === "no") return "NO";
  return null;
}

/** True when the provider marks the market settled or already carries a result. */
export function isSettled(row: HourMarketRow): boolean {
  return SETTLED_STATUSES.has(String(row.status ?? "").trim().toLowerCase()) || settledSide(row) != null;
}

/** The official underlying at the close, when the provider exposes one (`expiration_value`); null otherwise. */
export function officialValue(row: HourMarketRow): number | null {
  const v = num(row.expiration_value);
  return v != null && v > 0 ? v : null;
}

/** The posture the closer records at the close: WAIT until an hourly rule is frozen and marked live. */
export function postureAtClose(): "WAIT" | "YES" | "NO" {
  return HOUR_POSTURE.live_rule ? HOUR_POSTURE.lean : "WAIT";
}

/** One hourly ledger row, exactly as the closer writes it. A sit carries no fill fields. */
export type HourClose = {
  ticker: string;
  event_ticker: string;
  /** ISO instant of the top-of-hour Eastern close. */
  close_time: string;
  strike: number | null;
  question: string;
  chair_lean: "WAIT" | "YES" | "NO";
  entry_side: null;
  entry_cents: null;
  entry_fee_cents: null;
  settle_cents: null;
  ev_cents: null;
  result: "YES" | "NO";
  official_value: number | null;
  source: typeof HOUR_CLOSER_SOURCE;
  authority: typeof HOUR_BOOK_AUTHORITY;
  /** How the rung was chosen on the ladder: nearest the official close, or the middle rung when no official value was exposed. */
  pick: "nearest-official" | "middle-rung";
  /** How many rungs the hour's ladder had in the settled record. */
  ladder: number;
};

export type HourSkip = { event_ticker: string; close_time: string; reason: "unsettled" | "no-result" };

export type HourCloserPass = { rows: HourClose[]; skipped: HourSkip[] };

type Rung = { row: HourMarketRow; parsed: HourTicker; ticker: string; strike: number | null };

/**
 * Turn the provider's settled hourly markets into ledger rows: one per closed
 * hour inside the lookback, on the rung nearest the official close (or the
 * middle rung when no official value is exposed). An hour is skipped when it
 * is not settled or carries no result; nothing is guessed.
 */
export function closeHourWindows(rows: readonly HourMarketRow[] | undefined, now: number, lookbackMs = HOUR_CLOSER_LOOKBACK_MS): HourCloserPass {
  const byClose = new Map<number, Rung[]>();
  for (const row of rows ?? []) {
    const ticker = String(row.ticker ?? "");
    const parsed = parseHourTicker(ticker);
    if (!parsed || parsed.series !== HOUR_SERIES) continue;
    const providerClose = Date.parse(String(row.close_time ?? ""));
    if (Number.isFinite(providerClose) && Math.abs(providerClose - parsed.close_ms) > CLOSE_TOLERANCE_MS) continue;
    if (parsed.close_ms > now || parsed.close_ms < now - lookbackMs) continue;
    const list = byClose.get(parsed.close_ms) ?? [];
    list.push({ row, parsed, ticker, strike: num(row.floor_strike) ?? parsed.strike });
    byClose.set(parsed.close_ms, list);
  }
  const out: HourCloserPass = { rows: [], skipped: [] };
  for (const [closeMs, rungs] of [...byClose.entries()].sort((a, b) => a[0] - b[0])) {
    const close_time = new Date(closeMs).toISOString();
    const event_ticker = String(rungs[0]!.row.event_ticker ?? rungs[0]!.parsed.event_ticker);
    const settled = rungs.filter((r) => isSettled(r.row) && settledSide(r.row) != null);
    if (!settled.length) {
      out.skipped.push({ event_ticker, close_time, reason: rungs.some((r) => isSettled(r.row)) ? "no-result" : "unsettled" });
      continue;
    }
    const official = settled.map((r) => officialValue(r.row)).find((v): v is number => v != null) ?? null;
    const ladder = settled.filter((r) => r.parsed.kind === "above" && r.strike != null).sort((a, b) => a.strike! - b.strike!);
    const pool = ladder.length ? ladder : settled.sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
    let choice = pool[Math.floor(pool.length / 2)]!;
    let pick: HourClose["pick"] = "middle-rung";
    if (official != null && ladder.length) {
      choice = ladder.reduce((best, r) => (Math.abs(r.strike! - official) < Math.abs(best.strike! - official) ? r : best));
      pick = "nearest-official";
    }
    out.rows.push({
      ticker: choice.ticker,
      event_ticker,
      close_time,
      strike: choice.strike,
      question: hourQuestion(choice.row, choice.parsed),
      chair_lean: postureAtClose(),
      entry_side: null,
      entry_cents: null,
      entry_fee_cents: null,
      settle_cents: null,
      ev_cents: null,
      result: settledSide(choice.row)!,
      official_value: official,
      source: HOUR_CLOSER_SOURCE,
      authority: HOUR_BOOK_AUTHORITY,
      pick,
      ladder: pool.length,
    });
  }
  return out;
}
