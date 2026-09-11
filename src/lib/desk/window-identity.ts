/**
 * Window identity: the invariant that a grade is applied to the market it was
 * actually decided on.
 *
 * WHY THIS EXISTS. On 2026-09-10 the ledger recorded nine consecutive windows —
 * 07:00 through 09:00 UTC — carrying ONE ticker (KXBTC15M-26SEP100300-00) and
 * ONE settlement value (78399.31). The 07:00 row was the legitimate one. The
 * eight after it are invalid graded rows created from that one stale market's
 * settlement.
 *
 * WHAT THEY DID AND DID NOT REACH. They corrupted historical research data, and
 * they could interact with settlement-side and scalp state. A later forensic
 * reconstruction found no evidence of lasting learner contamination: the rows
 * were absent from the retained learner tapes, and they did not increment seat or
 * skill training or threshold tuning — consistent with the grading skip-credit
 * path in gradeWindow, which a frozen feed reaches via `dualDown` and which
 * returns before any card is touched. The rolling state it does advance
 * (prior_settles, capped at 24 windows, and the streak) has since expired.
 *
 * The mechanism was a matcher that checked half of the identity at a time. It
 * looked for a settle whose TICKER matched, ignoring when that market closed,
 * and failing that for one whose CLOSE TIME was within ninety seconds, ignoring
 * which market it was. So when the feed stopped advancing the ticker, every
 * pending window inherited the stale one and the first branch kept handing back
 * the same settlement. Neither branch could notice, because neither looked at
 * the field that disagreed.
 *
 * A settlement now has to agree on both, and on a third witness the old matcher
 * never consulted: the ticker encodes its own close time. KXBTC15M-26SEP110800
 * is the market closing 08:00 Eastern, which is 12:00 UTC — verified against
 * every clean row in the ledger, including the minute suffix and the fact that
 * every close_time sits exactly on the fifteen-minute grid. On the corrupted
 * block the ticker says 03:00 Eastern while the window says 08:45 UTC, so this
 * check alone rejects all eight.
 *
 * WHAT A FAILURE MUST NOT DO. Not guess a winner, not invent a replacement
 * ticker, not settle paper research against a market the desk did not trade,
 * and not teach the learner. A mismatch produces a named verdict the caller
 * records and alerts on, and the pending window stays pending so the state
 * survives for investigation rather than being consumed by a wrong answer.
 *
 * DELIBERATELY NOT FATAL: a ticker this module cannot parse. The format is the
 * exchange's, not ours, and a renamed series must degrade to the two checks that
 * do not depend on it rather than stop the desk from grading anything at all.
 *
 * Pure module: no clock, no state, no database, no imports from the engine.
 */

/** Quarter-hour in ms. Kalshi's 15-minute closes sit exactly on this grid. */
export const WINDOW_GRID_MS = 900_000;

/**
 * How far a settle's reported close may sit from the window's own close and
 * still be the same event. Unchanged from the matcher this replaces: the
 * tolerance was never the bug, looking at only one field at a time was.
 */
export const CLOSE_TOLERANCE_MS = 90_000;

/** The exchange clock the ticker's embedded time is written in. */
export const TICKER_TZ = "America/New_York";

/** The shape this module needs from a settle. A superset is fine. */
export type SettleLike = {
  ticker: string;
  close_time: number;
  lean: "UP" | "DOWN";
};

/** Why a settlement was refused. Recorded verbatim, so each is a distinct fault. */
export type IdentityFault =
  | "no-settle-for-window"
  | "close-time-mismatch"
  | "ticker-close-time-mismatch"
  | "window-off-grid"
  | "unusable-window-key";

/**
 * Which faults mean the DATA disagrees with itself, as opposed to the result
 * simply not having arrived yet.
 *
 * The distinction matters operationally: a window waiting on Kalshi is the
 * ordinary case dozens of times a day and must stay quiet, while an internal
 * contradiction is the 2026-09-10 signature and has to be loud.
 */
export function isInconsistent(fault: IdentityFault): boolean {
  return fault !== "no-settle-for-window";
}

export type IdentityVerdict<S extends SettleLike> =
  | { ok: true; settle: S; checks: IdentityChecks }
  | { ok: false; fault: IdentityFault; detail: string; checks: IdentityChecks };

/** Which witnesses were consulted and what each said. Recorded for forensics. */
export type IdentityChecks = {
  /** The window's close_time sits exactly on the fifteen-minute grid. */
  on_grid: boolean;
  /** The ticker parsed, and its embedded close agreed with the window. Null when unparseable. */
  ticker_time_ok: boolean | null;
  /** A settle carried this exact ticker. */
  ticker_seen: boolean;
  /** That settle's close_time agreed within tolerance. */
  close_ok: boolean;
};

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * The close time a ticker claims for itself, in ms, or null when the ticker
 * does not carry one in the shape this desk has verified.
 *
 * `KXBTC15M-26SEP110800-00` → 2026-09-11 08:00 America/New_York. The trailing
 * segment is the strike bucket and is not a time.
 */
export function tickerCloseMs(ticker: string): number | null {
  const m = /^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})(?:-|$)/.exec(ticker.trim().toUpperCase());
  if (!m) return null;
  const [, yy, mon, dd, hh, mi] = m;
  const month = MONTHS[mon!];
  if (month === undefined) return null;
  const year = 2000 + Number(yy);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(mi);
  if (!(day >= 1 && day <= 31) || hour > 23 || minute > 59) return null;
  return zonedToMs(year, month, day, hour, minute, TICKER_TZ);
}

/**
 * The UTC instant of a wall-clock time in a named zone.
 *
 * Resolved by probing rather than by an offset table: guess from UTC, ask the
 * zone what that instant reads as locally, and correct by the difference. Two
 * passes settle it either side of a DST change, and a result that still does not
 * read back as the requested wall time is reported as unresolvable rather than
 * as a time that is an hour wrong.
 */
function zonedToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number | null {
  const want = Date.UTC(year, month, day, hour, minute, 0, 0);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const local = Date.UTC(...localParts(guess, timeZone));
    const drift = want - local;
    if (drift === 0) return guess;
    guess += drift;
  }
  return Date.UTC(...localParts(guess, timeZone)) === want ? guess : null;
}

/** What an instant reads as on the wall in a named zone. */
function localParts(
  ms: number,
  timeZone: string,
): [number, number, number, number, number, number, number] {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  return [
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second), 0,
  ];
}

/**
 * Does this ticker's own embedded close time agree with the window's?
 *
 * Null means the ticker did not parse, which is not a disagreement — see the
 * note at the top of the file about why an unreadable ticker must not be fatal.
 */
export function tickerAgrees(ticker: string, closeMs: number): boolean | null {
  const own = tickerCloseMs(ticker);
  if (own == null) return null;
  return Math.abs(own - closeMs) <= CLOSE_TOLERANCE_MS;
}

/** Is this close_time a real quarter-hour boundary? */
export function onGrid(closeMs: number): boolean {
  return Number.isFinite(closeMs) && closeMs > 0 && closeMs % WINDOW_GRID_MS === 0;
}

/**
 * The invariant. Returns the settle that may grade this window, or a named fault
 * that must not.
 *
 * Checked in the order that produces the most specific fault: the window's own
 * key first (a window whose identity is internally inconsistent cannot be
 * rescued by any settle), then the settle that claims to be its result.
 */
export function matchSettle<S extends SettleLike>(
  settles: readonly S[],
  ticker: string,
  closeMs: number,
): IdentityVerdict<S> {
  const tickerTimeOk = ticker ? tickerAgrees(ticker, closeMs) : null;
  const grid = onGrid(closeMs);
  const checks: IdentityChecks = {
    on_grid: grid,
    ticker_time_ok: tickerTimeOk,
    ticker_seen: false,
    close_ok: false,
  };

  if (!ticker || !(closeMs > 0)) {
    return { ok: false, fault: "unusable-window-key", detail: `ticker=${ticker || "∅"} close=${closeMs}`, checks };
  }
  if (!grid) {
    return {
      ok: false,
      fault: "window-off-grid",
      detail: `close ${new Date(closeMs).toISOString()} is ${closeMs % WINDOW_GRID_MS}ms off the 15m grid`,
      checks,
    };
  }
  // The ticker disagreeing with its own window is the 2026-09-10 signature: a
  // stale market carried forward onto later quarter-hours. No settle can make
  // that window gradeable, so this is refused before any settle is considered.
  if (tickerTimeOk === false) {
    const own = tickerCloseMs(ticker);
    return {
      ok: false,
      fault: "ticker-close-time-mismatch",
      detail:
        `${ticker} encodes ${own == null ? "?" : new Date(own).toISOString()} ` +
        `but the window closes ${new Date(closeMs).toISOString()}`,
      checks,
    };
  }

  const sameTicker = settles.filter((s) => s.ticker === ticker && (s.lean === "UP" || s.lean === "DOWN"));
  checks.ticker_seen = sameTicker.length > 0;
  if (!sameTicker.length) {
    return { ok: false, fault: "no-settle-for-window", detail: `no official settle carries ${ticker}`, checks };
  }

  const agreed = sameTicker.find((s) => s.close_time > 0 && Math.abs(s.close_time - closeMs) <= CLOSE_TOLERANCE_MS);
  if (agreed) {
    checks.close_ok = true;
    return { ok: true, settle: agreed, checks };
  }

  // The ticker matched and the close did not. Previously this fell through to a
  // match on close_time alone; now it is the fault it always was.
  const near = sameTicker[0]!;
  return {
    ok: false,
    fault: "close-time-mismatch",
    detail:
      `${ticker} settle closes ${near.close_time > 0 ? new Date(near.close_time).toISOString() : "∅"} ` +
      `but the window closes ${new Date(closeMs).toISOString()}`,
    checks,
  };
}

/** One line for the settle tape and the diagnostic log. */
export function faultLine(ticker: string, closeMs: number, fault: IdentityFault, detail: string): string {
  const hhmm = closeMs > 0 ? new Date(closeMs).toISOString().slice(11, 16) : "??:??";
  return `IDENTITY ${hhmm} ${ticker || "∅"} · ${fault} — not graded, not taught · ${detail}`;
}
