/**
 * The week on the record — a brief, not a dashboard.
 *
 * Pure: it takes the last-7-days totals the books already compute, the
 * process scorecard's week column, and the week's graded ledger rows, and
 * picks one WAIT that saved a loss, one fill that lost, and one seat line.
 * No clock of its own, no database, no authority. Nothing here changes the
 * Chair, the paper book, or any seat. Bitcoin only. Paper only.
 *
 * An empty week is still a valid brief: it leads with sits and the best WAIT
 * and never invents a fill.
 */
import type { BooksTotals, KeeperStats } from "./books.ts";
import { bookedSideOf } from "./booked-side.ts";

export const RECORD_TZ = "America/Chicago";
export const RECORD_DAYS = 7;
/** The brief is never stored by a browser or a proxy: every open of /record is this minute's week. */
export const RECORD_CACHE_CONTROL = "no-store";

export type RecordLedgerRow = {
  ticker: string;
  close_time: string;
  winner: "UP" | "DOWN";
  chair_lean: string | null;
  entry_lean: string | null;
  entry_cents: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  entry_fee_cents: number | null;
  shadow_entry_cents: number | null;
  shadow_ev_cents: number | null;
  seats: Record<string, { lean?: string; hit?: boolean | null; raw_lean?: string }> | null;
  replay: boolean;
};

export type RecordScore = {
  windows: number;
  sits: number;
  fills: number;
  wins: number;
  /** Win rate of the fills, 0–100; null with no fills. */
  win_rate: number | null;
  /** Win rate the fills needed to break even, 0–100; null with no fills. */
  needed: number | null;
  /** Net cents after fees. */
  net: number;
  /** Worst peak-to-trough of the week's cumulative net, ≤ 0; null when the scorecard is unavailable. */
  max_dd: number | null;
};

export type RecordWait = {
  ticker: string;
  close_time: string;
  winner: "UP" | "DOWN";
  /** How the sit is known to have been right: a shadow fill that lost, or a wrong lean that never filled. */
  kind: "shadow-loss-avoided" | "wrong-lean-unfilled";
  reason: string;
  replay: boolean;
};

export type RecordFill = {
  ticker: string;
  close_time: string;
  side: "UP" | "DOWN" | null;
  ask: number;
  fee: number;
  /** Cents after fee, negative. */
  ev: number;
  winner: "UP" | "DOWN";
  /** The recorded invalidation condition, already stripped of its leading "if"; null when none was recorded. */
  invalidate: string | null;
  replay: boolean;
};

export type RecordSeatNote = {
  seat: string;
  n: number;
  right: number;
  pct: number;
  /** Skill statuses the seat's rules hold, when the learner could be read. */
  statuses: Partial<Record<"LIVE" | "SHADOW" | "BENCH" | "CANDIDATE", number>> | null;
  line: string;
};

/** The books' last-7-days cells the score was read from, kept so the page can prove the two agree. */
export type BooksColumn = Pick<BooksTotals, "n" | "calls" | "wins" | "net" | "breakeven">;

export type WeekRecord = {
  at: string;
  tz: typeof RECORD_TZ;
  days: typeof RECORD_DAYS;
  window: { from: string; to: string; label: string };
  score: RecordScore;
  /** The same column /books prints as "last 7 days", at the same read. */
  books_week: BooksColumn;
  best_wait: RecordWait | null;
  wrong_fill: RecordFill | null;
  seat_note: RecordSeatNote | null;
  /** Interior ledger gaps over the last 90 days; outages in the record, never WAITs. */
  missing_windows: number;
  /** Plain text of the brief, in the site voice, for pasting. */
  copy: string;
};

export type RecordInput = {
  now: number;
  rows: RecordLedgerRow[];
  week: BooksTotals;
  keeper: KeeperStats | null;
  missing_windows: number;
  statuses: Record<string, RecordSeatNote["statuses"]> | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => (finite(v) ? v : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const directional = (v: unknown): v is "UP" | "DOWN" => v === "UP" || v === "DOWN";

/** The desk's rounded one-contract taker fee, in cents, for a price in cents. */
export function takerFee(entry: number): number {
  return Math.ceil((0.07 * entry * (100 - entry)) / 100);
}

/** Chicago calendar date, stable on server and client because it never reads the viewer's zone. */
export function chicagoDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: RECORD_TZ, month: "short", day: "numeric" }).format(new Date(ms));
}

export function fmtCents(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}¢`;
}

export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

/** The minute the brief was read, to the minute, in UTC; both pages roll a 7-day window every 15 minutes. */
export function readStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "an unknown minute";
}

/** The books' last-7-days column as the record read it: the same cells /books prints, normalised the same way. */
export function booksColumn(week: BooksTotals): BooksColumn {
  return {
    n: Math.max(0, Math.floor(num(week.n) ?? 0)),
    calls: Math.max(0, Math.floor(num(week.calls) ?? 0)),
    wins: Math.max(0, Math.floor(num(week.wins) ?? 0)),
    net: round1(num(week.net) ?? 0),
    breakeven: num(week.breakeven),
  };
}

/** True only when every cell the record prints equals the books' last-7-days column it was read from. */
export function booksParity(score: RecordScore, week: BooksColumn): boolean {
  return (
    score.windows === week.n &&
    score.fills === week.calls &&
    score.wins === week.wins &&
    score.net === week.net &&
    score.needed === (score.fills ? week.breakeven : null)
  );
}

export type ScoreNote = { same: boolean; text: string };

/**
 * The line under the score. It claims to match the books only when every cell
 * does, and it dates the read: the 7-day window rolls every 15 minutes, so two
 * pages read hours apart print two different weeks from the same book.
 */
export function scoreNote(r: Pick<WeekRecord, "score" | "books_week" | "at">): ScoreNote {
  const same = booksParity(r.score, r.books_week);
  const stamp = readStamp(r.at);
  if (same) {
    return {
      same,
      text: `Same numbers as the books' last-7-days column, both read at ${stamp}. The window rolls every 15 minutes, so a page left open since another hour prints another week; reload to compare. WAIT is a decision; a sit is not a missed trade.`,
    };
  }
  const w = r.books_week;
  return {
    same,
    text: `This brief and the books' last-7-days column disagree at ${stamp}: record ${fmtCents(r.score.net)}, ${r.score.fills} fills, ${r.score.wins} won; books ${fmtCents(w.net)}, ${w.calls} calls, ${w.wins} won. Trust the books until the next refresh.`,
  };
}

export function scoreOf(week: BooksTotals, keeper: KeeperStats | null): RecordScore {
  const windows = Math.max(0, Math.floor(num(week.n) ?? 0));
  const fills = Math.max(0, Math.min(windows, Math.floor(num(week.calls) ?? 0)));
  const wins = Math.max(0, Math.min(fills, Math.floor(num(week.wins) ?? 0)));
  return {
    windows,
    sits: windows - fills,
    fills,
    wins,
    win_rate: fills ? Math.round((100 * wins) / fills) : null,
    needed: fills ? num(week.breakeven) : null,
    net: round1(num(week.net) ?? 0),
    max_dd: keeper ? round1(num(keeper.max_dd) ?? 0) : null,
  };
}

/** One WAIT the record can show was right: a shadow fill that lost, else a wrong lean that never filled. */
export function bestWait(rows: RecordLedgerRow[]): RecordWait | null {
  const waits = rows.filter((r) => r.entry_cents == null);
  const saved = waits
    .filter((r) => finite(r.shadow_entry_cents) && finite(r.shadow_ev_cents) && r.shadow_ev_cents < 0)
    .sort((a, b) => a.shadow_ev_cents! - b.shadow_ev_cents! || Number(b.replay) - Number(a.replay));
  const s = saved[0];
  if (s) {
    return {
      ticker: s.ticker,
      close_time: s.close_time,
      winner: s.winner,
      kind: "shadow-loss-avoided",
      reason: `The older, lower floor would have filled at ${s.shadow_entry_cents!.toFixed(0)}¢ and lost ${Math.abs(s.shadow_ev_cents!).toFixed(1)}¢ after fee. The live book sat, and the window settled ${s.winner}.`,
      replay: s.replay,
    };
  }
  const leaned = waits
    .filter((r) => directional(r.chair_lean) && r.chair_lean !== r.winner)
    .sort((a, b) => Number(b.replay) - Number(a.replay) || b.close_time.localeCompare(a.close_time));
  const l = leaned[0];
  if (l) {
    return {
      ticker: l.ticker,
      close_time: l.close_time,
      winner: l.winner,
      kind: "wrong-lean-unfilled",
      reason: `The Chair leaned ${l.chair_lean}, nothing cleared the entry rules, and the window settled ${l.winner}. Sitting cost nothing.`,
      replay: l.replay,
    };
  }
  return null;
}

/** The week's worst fill after fee, or null when no fill lost. Never invents one. */
export function wrongFill(rows: RecordLedgerRow[]): RecordFill | null {
  const losers = rows
    .filter((r) => finite(r.entry_cents) && finite(r.ev_cents) && r.ev_cents < 0)
    .sort((a, b) => a.ev_cents! - b.ev_cents! || Number(b.replay) - Number(a.replay));
  const r = losers[0];
  if (!r) return null;
  const ask = r.entry_cents!;
  return {
    ticker: r.ticker,
    close_time: r.close_time,
    side: directional(r.entry_lean) ? r.entry_lean : bookedSideOf(r.settle_cents, r.winner),
    ask,
    fee: finite(r.entry_fee_cents) ? r.entry_fee_cents : takerFee(ask),
    ev: round1(r.ev_cents!),
    winner: r.winner,
    invalidate: null,
    replay: r.replay,
  };
}

/** The seat with the most graded directional reads this week, and how many were right. */
export function seatNote(rows: RecordLedgerRow[], statuses: RecordInput["statuses"]): RecordSeatNote | null {
  const tally = new Map<string, { n: number; right: number }>();
  for (const r of rows) {
    for (const [seat, v] of Object.entries(r.seats ?? {})) {
      if (!v || typeof v !== "object" || (v.hit !== true && v.hit !== false)) continue;
      const t = tally.get(seat) ?? { n: 0, right: 0 };
      t.n++;
      if (v.hit) t.right++;
      tally.set(seat, t);
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].right / b[1].n - a[1].right / a[1].n || a[0].localeCompare(b[0]))[0];
  if (!best) return null;
  const [seat, t] = best;
  const pct = Math.round((100 * t.right) / t.n);
  const st = statuses?.[seat] ?? null;
  const rules = st
    ? Object.entries(st)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(" · ")
    : "";
  const line = `${seat} spoke a direction on ${t.n} graded ${t.n === 1 ? "window" : "windows"} and was right on ${t.right} (${pct}%).${rules ? ` Its rules sit ${rules}.` : ""}`;
  return { seat, n: t.n, right: t.right, pct, statuses: st, line };
}

/** Plain text of the brief. No hashtags, no promises. */
export function copyWeek(r: Omit<WeekRecord, "copy">): string {
  const s = r.score;
  const lines = [
    "The week on the record · Satoshi's Council",
    `${r.window.label}. Paper grades. Public prices. No live orders.`,
    `Sits ${s.sits} of ${s.windows} windows. Fills ${s.fills}.${s.fills ? ` Win rate ${fmtPct(s.win_rate)} vs ${fmtPct(s.needed)} needed.` : ""} Net ${fmtCents(s.net)} after fees.${s.max_dd != null ? ` Max drawdown ${fmtCents(s.max_dd)}.` : ""}`,
    `Read ${readStamp(r.at)}. The 7-day window rolls every 15 minutes.`,
    r.best_wait ? `One WAIT that was right: ${r.best_wait.reason}` : "No WAIT this week can be shown as a saved loss. Sits are the default answer, not a score.",
    r.wrong_fill
      ? `One fill that was wrong: ${r.wrong_fill.side ?? "a side"} at ${r.wrong_fill.ask.toFixed(0)}¢, ${fmtCents(r.wrong_fill.ev)} after fee.`
      : s.fills
        ? "No fill lost this week."
        : "No fills this week. Nothing to grade there.",
    r.seat_note ? `Seat note: ${r.seat_note.line}` : "Seat note: no graded directional reads this week.",
    r.missing_windows > 0 ? `Missing windows are outages in the record, not WAITs (${r.missing_windows} in 90 days).` : "",
    "A directional read and a recorded paper fill are different.",
    "satoshiscouncil.com/record",
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildWeekRecord(input: RecordInput): WeekRecord {
  const to = input.now;
  const from = to - RECORD_DAYS * 86_400_000;
  const rows = [...input.rows].sort((a, b) => b.close_time.localeCompare(a.close_time));
  const base: Omit<WeekRecord, "copy"> = {
    at: new Date(to).toISOString(),
    tz: RECORD_TZ,
    days: RECORD_DAYS,
    window: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      label: `Last ${RECORD_DAYS} days, ${chicagoDate(from)} to ${chicagoDate(to)}, ${RECORD_TZ}`,
    },
    score: scoreOf(input.week, input.keeper),
    books_week: booksColumn(input.week),
    best_wait: bestWait(rows),
    wrong_fill: wrongFill(rows),
    seat_note: seatNote(rows, input.statuses),
    missing_windows: Math.max(0, Math.floor(num(input.missing_windows) ?? 0)),
  };
  return { ...base, copy: copyWeek(base) };
}
