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
 * One KXBTCD hour is a ladder of well over a hundred strikes, so the closer
 * works one hour at a time: it names the hour's event, reads that event's
 * whole ladder, and only then chooses the rung nearest the official close.
 * An incomplete ladder, a missing official value, or an official value off
 * the ladder's range is a skip, never a far strike.
 *
 * The contract is a strike ladder ("$X or above" at the top of the hour,
 * Eastern, on the CF Benchmarks value), never the 15-minute UP/DOWN. Nothing
 * here reads or writes the 15-minute ledger, the Chair, the learner, or any
 * promotion gate. Authority: none. Paper only. No live orders.
 */
import { HOUR_BOOK_AUTHORITY, HOUR_CLOCK_TZ, HOUR_POSTURE, HOUR_SERIES, hourQuestion, parseHourTicker, type HourMarketRow, type HourTicker } from "./hour.ts";

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
const HOUR_MS = 60 * 60 * 1000;

const SETTLED_STATUSES = new Set(["settled", "finalized", "determined", "closed_settled"]);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

/** One closed hour, named the way Kalshi names its event: the series plus the Eastern date and hour of the close. */
export type HourEvent = { event_ticker: string; close_ms: number; close_time: string };

/** `KXBTCD-26SEP1812` for the instant that reads 12:00 on the Eastern wall clock. */
export function hourEventTicker(closeMs: number): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: HOUR_CLOCK_TZ, year: "2-digit", month: "numeric", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(closeMs))) p[part.type] = part.value;
  return `${HOUR_SERIES}-${p.year}${MONTHS[Number(p.month) - 1]}${p.day}${p.hour}`;
}

/** Every top-of-hour close inside the lookback, newest first. Eastern hours sit on UTC hours, so the clock is exact. */
export function hourEventsInLookback(now: number, lookbackMs = HOUR_CLOSER_LOOKBACK_MS): HourEvent[] {
  const out: HourEvent[] = [];
  for (let t = Math.floor(now / HOUR_MS) * HOUR_MS; t >= now - lookbackMs; t -= HOUR_MS) {
    out.push({ event_ticker: hourEventTicker(t), close_ms: t, close_time: new Date(t).toISOString() });
  }
  return out;
}

/** One hourly ledger row, exactly as the closer writes it. A sit carries no fill fields. */
export type HourClose = {
  ticker: string;
  event_ticker: string;
  /** ISO instant of the top-of-hour Eastern close. */
  close_time: string;
  strike: number;
  question: string;
  chair_lean: "WAIT" | "YES" | "NO";
  entry_side: null;
  entry_cents: null;
  entry_fee_cents: null;
  settle_cents: null;
  ev_cents: null;
  result: "YES" | "NO";
  official_value: number;
  source: typeof HOUR_CLOSER_SOURCE;
  authority: typeof HOUR_BOOK_AUTHORITY;
  /** The rung is always the one nearest the official close, chosen over the hour's whole ladder. */
  pick: "nearest-official";
  /** How many rungs the hour's ladder had. */
  ladder: number;
};

export type HourSkipReason = "incomplete" | "empty" | "unsettled" | "no-result" | "no-official" | "off-ladder";
export type HourSkip = { event_ticker: string; close_time: string; reason: HourSkipReason };
export type HourLadderOutcome = { row: HourClose; skip?: undefined } | { row?: undefined; skip: HourSkip };

/** The hour's ladder as the provider handed it over, and whether every page of it arrived. */
export type HourLadder = { markets: readonly HourMarketRow[]; complete: boolean };

type Rung = { row: HourMarketRow; parsed: HourTicker; ticker: string; strike: number };

/**
 * Grade one closed hour from its whole ladder. The rung is the "at or above"
 * strike nearest the official close, and only when the ladder is complete,
 * every rung on it is settled with a result, the official value is known,
 * and that value lies inside the ladder's range. Anything else is a skip.
 */
export function closeHourLadder(hour: HourEvent, ladder: HourLadder): HourLadderOutcome {
  const skip = (reason: HourSkipReason): HourLadderOutcome => ({ skip: { event_ticker: hour.event_ticker, close_time: hour.close_time, reason } });
  if (!ladder.complete) return skip("incomplete");
  const rungs: Rung[] = [];
  for (const row of ladder.markets) {
    const ticker = String(row.ticker ?? "");
    const parsed = parseHourTicker(ticker);
    if (!parsed || parsed.series !== HOUR_SERIES || parsed.close_ms !== hour.close_ms) continue;
    const providerClose = Date.parse(String(row.close_time ?? ""));
    if (Number.isFinite(providerClose) && Math.abs(providerClose - parsed.close_ms) > CLOSE_TOLERANCE_MS) continue;
    if (parsed.kind !== "above") continue;
    const strike = num(row.floor_strike) ?? parsed.strike;
    if (strike == null) continue;
    rungs.push({ row, parsed, ticker, strike });
  }
  if (!rungs.length) return skip("empty");
  if (rungs.some((r) => !isSettled(r.row))) return skip("unsettled");
  if (rungs.some((r) => settledSide(r.row) == null)) return skip("no-result");
  const official = rungs.map((r) => officialValue(r.row)).find((v): v is number => v != null) ?? null;
  if (official == null) return skip("no-official");
  rungs.sort((a, b) => a.strike - b.strike);
  if (official < rungs[0]!.strike || official > rungs[rungs.length - 1]!.strike) return skip("off-ladder");
  const choice = rungs.reduce((best, r) => (Math.abs(r.strike - official) < Math.abs(best.strike - official) ? r : best));
  return {
    row: {
      ticker: choice.ticker,
      event_ticker: hour.event_ticker,
      close_time: hour.close_time,
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
      pick: "nearest-official",
      ladder: rungs.length,
    },
  };
}
