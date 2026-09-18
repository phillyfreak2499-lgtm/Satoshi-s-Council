/**
 * The hour on the record — a longer Bitcoin clock, graded separately.
 *
 * Kalshi's hourly Bitcoin series (KXBTCD) settles on the CF Benchmarks value
 * at the top of the hour, Eastern time. Its contracts are a strike ladder:
 * each market asks whether Bitcoin will be at or above one price at the
 * close. That is not the 15-minute UP/DOWN contract, and nothing here
 * pretends it is.
 *
 * Pure: no clock of its own, no network, no database. The hourly book's
 * authority is none. Nothing here reads or writes the 15-minute ledger, the
 * Chair, the learner, or any promotion gate. Paper only. No live orders.
 */
import { breakevenPct } from "./books-math.ts";

export const HOUR_SERIES = "KXBTCD";
export const HOUR_CLOCK_TZ = "America/New_York";
export const HOUR_DAYS = 7;
/** Printed in code and in copy: this book has no authority anywhere. */
export const HOUR_BOOK_AUTHORITY = "none" as const;
/** No hourly rule exists in this repo, so the posture for this clock is WAIT. */
export const HOUR_POSTURE = Object.freeze({
  lean: "WAIT" as const,
  live_rule: false,
  reason: "No hourly rule exists in this repo. The posture for this clock is WAIT until one is written, frozen and marked live.",
});
export const HOUR_EMPTY_COPY = "No hourly fills yet. The 15-minute floor is a different book.";
export const HOUR_SEPARATE_COPY = "The 15-minute floor and the hourly book are graded separately.";

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** What an instant reads as on the wall in a named zone. */
function localParts(ms: number, timeZone: string): [number, number, number, number, number, number, number] {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  return [Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second), 0];
}

/** The UTC instant of a wall-clock time in a named zone, resolved by probing (as window-identity does). */
function zonedToMs(year: number, month: number, day: number, hour: number, timeZone: string): number | null {
  const want = Date.UTC(year, month, day, hour, 0, 0, 0);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const local = Date.UTC(...localParts(guess, timeZone));
    const drift = want - local;
    if (drift === 0) return guess;
    guess += drift;
  }
  return Date.UTC(...localParts(guess, timeZone)) === want ? guess : null;
}

export type HourTicker = {
  series: string;
  event_ticker: string;
  /** Close at the top of the hour, Eastern time, in ms. */
  close_ms: number;
  /** T = at or above the strike; B = a between bucket; null when the suffix is not one this desk has verified. */
  kind: "above" | "between" | null;
  strike: number | null;
};

/**
 * `KXBTCD-26SEP1815-T78249.99` → the 15:00 America/New_York close on 2026-09-18,
 * an "at or above $78,249.99" contract. Only the shape this desk understands
 * parses; anything else is null rather than a guess.
 */
export function parseHourTicker(ticker: string): HourTicker | null {
  const m = /^([A-Z0-9]+)-(\d{2})([A-Z]{3})(\d{2})(\d{2})(?:-([A-Z])(\d+(?:\.\d+)?))?$/.exec(ticker.trim().toUpperCase());
  if (!m) return null;
  const [, series, yy, mon, dd, hh, suffix, strikeRaw] = m;
  if (series !== HOUR_SERIES) return null;
  const month = MONTHS[mon!];
  if (month === undefined) return null;
  const day = Number(dd);
  const hour = Number(hh);
  if (!(day >= 1 && day <= 31) || hour > 23) return null;
  const close_ms = zonedToMs(2000 + Number(yy), month, day, hour, HOUR_CLOCK_TZ);
  if (close_ms == null) return null;
  const strike = strikeRaw ? Number(strikeRaw) : null;
  return {
    series: series!,
    event_ticker: `${series}-${yy}${mon}${dd}${hh}`,
    close_ms,
    kind: suffix === "T" ? "above" : suffix === "B" ? "between" : null,
    strike: finite(strike) ? strike : null,
  };
}

/** A Kalshi open-market row, as the public REST list returns it. Only the fields read here are typed. */
export type HourMarketRow = {
  ticker?: unknown;
  event_ticker?: unknown;
  close_time?: unknown;
  title?: unknown;
  subtitle?: unknown;
  yes_sub_title?: unknown;
  strike_type?: unknown;
  floor_strike?: unknown;
  cap_strike?: unknown;
  yes_ask?: unknown;
  yes_ask_dollars?: unknown;
  yes_bid?: unknown;
  yes_bid_dollars?: unknown;
  no_ask?: unknown;
  no_ask_dollars?: unknown;
  [key: string]: unknown;
};

/** Kalshi quotes arrive as dollar strings ("0.86") on newer fields and as cents on older ones. */
export function quoteCents(dollars: unknown, cents: unknown): number | null {
  const d = num(dollars);
  if (d != null) return Math.round(d * 100);
  const c = num(cents);
  if (c == null) return null;
  // The legacy field is cents, but a value at or under 1.5 can only be dollars (as server-feeds reads it).
  return c <= 1.5 ? Math.round(c * 100) : Math.round(c);
}

export type HourWindow = {
  ticker: string;
  event_ticker: string;
  close_time: string;
  /** Plain English, taken from the contract itself when the feed carries it. */
  question: string;
  kind: HourTicker["kind"];
  strike: number | null;
  /** Best ask for the "at or above" side, in cents; null when the feed has none. */
  yes_ask: number | null;
  yes_bid: number | null;
  no_ask: number | null;
  /** How the strike was chosen: nearest to spot, or the middle rung when spot is unknown. */
  pick: "nearest-spot" | "middle-rung";
  /** Every strike on the same hour, so a reader can see the ladder this rung came from. */
  ladder: number;
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The contract's own question, or one derived from the ticker. Never an UP/DOWN. */
export function hourQuestion(row: HourMarketRow, parsed: HourTicker | null): string {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const yesSub = typeof row.yes_sub_title === "string" ? row.yes_sub_title.trim() : "";
  if (title && yesSub) return `${title.replace(/\?$/, "")}: yes pays if ${yesSub}.`;
  if (title) return title;
  const strike = num(row.floor_strike) ?? parsed?.strike ?? null;
  const when = parsed ? clockET(parsed.close_ms) : "the top of the hour";
  if (parsed?.kind === "above" && strike != null) return `Will Bitcoin be at or above ${usd(strike)} at ${when} Eastern?`;
  if (parsed?.kind === "between" && strike != null) {
    const cap = num(row.cap_strike);
    return cap != null ? `Will Bitcoin close between ${usd(strike)} and ${usd(cap)} at ${when} Eastern?` : `Will Bitcoin close in the ${usd(strike)} bucket at ${when} Eastern?`;
  }
  return `An hourly Bitcoin contract closing at ${when} Eastern. The feed did not carry its question.`;
}

/** "3:00 PM" in Eastern time, from an instant. */
export function clockET(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOUR_CLOCK_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/**
 * The live hourly window: the next hour to close, and on it the rung nearest
 * spot (or the middle rung when spot is unknown). Rows whose ticker and
 * provider close disagree are dropped, as the 15-minute selector does.
 */
export function pickHourWindow(rows: readonly HourMarketRow[] | undefined, now: number, spot: number | null): HourWindow | null {
  const valid = (rows ?? []).flatMap((row) => {
    const ticker = String(row.ticker ?? "");
    const parsed = parseHourTicker(ticker);
    const providerClose = Date.parse(String(row.close_time ?? ""));
    if (!parsed) return [];
    if (Number.isFinite(providerClose) && Math.abs(providerClose - parsed.close_ms) > 60_000) return [];
    if (parsed.close_ms <= now) return [];
    const strike = num(row.floor_strike) ?? parsed.strike;
    return [{ row, parsed, ticker, strike }];
  });
  if (!valid.length) return null;
  const nextClose = Math.min(...valid.map((v) => v.parsed.close_ms));
  const rungs = valid.filter((v) => v.parsed.close_ms === nextClose).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
  let choice = rungs[Math.floor(rungs.length / 2)]!;
  let pick: HourWindow["pick"] = "middle-rung";
  if (spot != null && rungs.some((r) => r.strike != null)) {
    choice = rungs
      .filter((r) => r.strike != null)
      .reduce((best, r) => (Math.abs(r.strike! - spot) < Math.abs(best.strike! - spot) ? r : best));
    pick = "nearest-spot";
  }
  return {
    ticker: choice.ticker,
    event_ticker: String(choice.row.event_ticker ?? choice.parsed.event_ticker),
    close_time: new Date(choice.parsed.close_ms).toISOString(),
    question: hourQuestion(choice.row, choice.parsed),
    kind: choice.parsed.kind,
    strike: choice.strike,
    yes_ask: quoteCents(choice.row.yes_ask_dollars, choice.row.yes_ask),
    yes_bid: quoteCents(choice.row.yes_bid_dollars, choice.row.yes_bid),
    no_ask: quoteCents(choice.row.no_ask_dollars, choice.row.no_ask),
    pick,
    ladder: rungs.length,
  };
}

// ---------------------------------------------------------------------------
// The hourly book, from its own ledger only.
// ---------------------------------------------------------------------------

export type HourLedgerRow = {
  ticker: string;
  close_time: string;
  question: string;
  chair_lean: "WAIT" | "YES" | "NO";
  entry_side: "YES" | "NO" | null;
  entry_cents: number | null;
  entry_fee_cents: number | null;
  ev_cents: number | null;
  result: "YES" | "NO" | null;
};

export type HourScore = {
  windows: number;
  sits: number;
  fills: number;
  wins: number;
  win_rate: number | null;
  needed: number | null;
  net: number;
  /** Worst peak-to-trough of the cumulative net over the fills, ≤ 0; 0 with no fills. */
  max_dd: number;
};

export function takerFee(entry: number): number {
  return Math.ceil((0.07 * entry * (100 - entry)) / 100);
}

/** Score over graded hourly rows only. An empty ledger scores zero windows, not a zero record. */
export function hourScore(rows: readonly HourLedgerRow[]): HourScore {
  const graded = rows.filter((r) => r.result === "YES" || r.result === "NO");
  const fills = graded.filter((r) => finite(r.entry_cents) && finite(r.ev_cents));
  const wins = fills.filter((r) => r.ev_cents! > 0);
  const losses = fills.filter((r) => r.ev_cents! < 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const needed = fills.length
    ? breakevenPct(
        avg(wins.map((r) => r.ev_cents!)),
        avg(losses.map((r) => -r.ev_cents!)),
        avg(fills.map((r) => r.entry_cents! + (finite(r.entry_fee_cents) ? r.entry_fee_cents : takerFee(r.entry_cents!)))),
      )
    : null;
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const r of [...fills].sort((a, b) => a.close_time.localeCompare(b.close_time))) {
    cum += r.ev_cents!;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
  }
  return {
    windows: graded.length,
    sits: graded.length - fills.length,
    fills: fills.length,
    wins: wins.length,
    win_rate: fills.length ? Math.round((100 * wins.length) / fills.length) : null,
    needed: needed == null ? null : round1(needed),
    net: round1(fills.reduce((s, r) => s + r.ev_cents!, 0)),
    max_dd: round1(dd),
  };
}

export type HourWait = { ticker: string; close_time: string; reason: string };
export type HourFill = { ticker: string; close_time: string; side: "YES" | "NO"; ask: number; fee: number; ev: number; result: "YES" | "NO"; question: string };

/** A WAIT shown as right only when a recorded lean never filled and the other side paid. */
export function hourRightWait(rows: readonly HourLedgerRow[]): HourWait | null {
  const r = rows
    .filter((x) => x.entry_cents == null && (x.chair_lean === "YES" || x.chair_lean === "NO") && x.result != null && x.result !== x.chair_lean)
    .sort((a, b) => b.close_time.localeCompare(a.close_time))[0];
  if (!r) return null;
  return { ticker: r.ticker, close_time: r.close_time, reason: `The posture leaned ${r.chair_lean}, nothing filled, and ${r.result} paid. Sitting cost nothing.` };
}

/** The worst real hourly fill after fee, or null. Never invented. */
export function hourWrongFill(rows: readonly HourLedgerRow[]): HourFill | null {
  const r = rows
    .filter((x) => finite(x.entry_cents) && finite(x.ev_cents) && x.ev_cents < 0 && (x.entry_side === "YES" || x.entry_side === "NO") && (x.result === "YES" || x.result === "NO"))
    .sort((a, b) => a.ev_cents! - b.ev_cents!)[0];
  if (!r) return null;
  return {
    ticker: r.ticker,
    close_time: r.close_time,
    side: r.entry_side!,
    ask: r.entry_cents!,
    fee: finite(r.entry_fee_cents) ? r.entry_fee_cents : takerFee(r.entry_cents!),
    ev: round1(r.ev_cents!),
    result: r.result!,
    question: r.question,
  };
}

export type HourBrief = {
  at: string;
  series: typeof HOUR_SERIES;
  authority: typeof HOUR_BOOK_AUTHORITY;
  posture: typeof HOUR_POSTURE;
  /** Null when the feed had no open hourly contract this request. */
  live: HourWindow | null;
  /** True when the hourly ledger could not be read at all, so nothing below is a record. */
  ledger_unavailable: boolean;
  window: { days: number; label: string };
  score: HourScore;
  right_wait: HourWait | null;
  wrong_fill: HourFill | null;
  copy: { empty: string; separate: string };
};

export function buildHourBrief(input: { now: number; live: HourWindow | null; rows: HourLedgerRow[] | null }): HourBrief {
  const rows = input.rows ?? [];
  return {
    at: new Date(input.now).toISOString(),
    series: HOUR_SERIES,
    authority: HOUR_BOOK_AUTHORITY,
    posture: HOUR_POSTURE,
    live: input.live,
    ledger_unavailable: input.rows == null,
    window: { days: HOUR_DAYS, label: `Last ${HOUR_DAYS} days of hourly windows, graded at the top of the hour, ${HOUR_CLOCK_TZ}` },
    score: hourScore(rows),
    right_wait: hourRightWait(rows),
    wrong_fill: hourWrongFill(rows),
    copy: { empty: HOUR_EMPTY_COPY, separate: HOUR_SEPARATE_COPY },
  };
}

export function fmtCents(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}¢`;
}
export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}
