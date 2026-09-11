/**
 * Reading the candle's OWN period timestamp off a Kalshi candlestick row.
 *
 * WHY THIS IS ITS OWN MODULE. `server-feeds.ts` keeps only `price.close_dollars`
 * from each candlestick and throws the timestamp away, which is how the desk ended
 * up treating array position as time. Recovering the timestamp is the whole
 * foundation of the true-time reading, so it gets tests of its own and is not
 * allowed to guess.
 *
 * UNITS. Kalshi candlestick timestamps are epoch SECONDS. Epoch seconds are
 * absolute and UTC by definition, so there is no timezone to convert - unlike the
 * market TICKER, which encodes Eastern wall-clock time and does need conversion
 * (see window-identity.ts). Everything here is normalised to epoch MILLISECONDS
 * before it leaves, because that is what `PathPoint.t` and `Date.now()` speak.
 *
 * START VERSUS END. A candle's close price happens at the END of its period. If a
 * row carries only a period START, using it directly would date every close one
 * full interval too early - a 60-second systematic shift on 1-minute candles, which
 * is precisely the class of error this work exists to detect. So a start-only row is
 * adjusted forward by one interval and the fact is recorded as `kind`, never
 * silently merged with an end timestamp.
 *
 * THE FIELD NAME IS MEASURED, NOT ASSUMED. `end_period_ts` is Kalshi's documented
 * field, and this deployment is already reading the newer `*_dollars` price
 * variants, so the response shape in use cannot be confirmed from the wire here.
 * Rather than assume, the field that actually matched is returned and stored, and
 * rows where nothing matched are counted. If the documented name is wrong in
 * production, the shadow rows will say so instead of silently yielding an empty
 * timestamped path.
 *
 * Pure module: no clock beyond the `nowMs` passed in, no state, no database.
 */

/** One period at `period_interval=1`. The desk requests minute candles. */
export const CANDLE_PERIOD_MS = 60_000;

/**
 * Fields that date the END of the period, in preference order. The first present
 * and plausible one wins, and its name is reported.
 */
export const CANDLE_END_FIELDS = Object.freeze([
  "end_period_ts",
  "period_end_ts",
  "end_ts",
]);

/** Fields that date the START of the period. Used only with a forward adjustment. */
export const CANDLE_START_FIELDS = Object.freeze([
  "start_period_ts",
  "period_start_ts",
  "start_ts",
]);

export type CandleTs =
  | {
      ok: true;
      /** Epoch ms, UTC, dating the candle's close. */
      t: number;
      /** Which field it came from, so a wrong guess is visible in the data. */
      field: string;
      /** "end" used as-is; "start-adjusted" moved forward one period. */
      kind: "end" | "start-adjusted";
    }
  | {
      ok: false;
      why:
        /** No known field was present on the row. The field list is wrong. */
        | "absent"
        /** Present but not a finite number. */
        | "unparseable"
        /** Parsed, but nowhere near now - a unit or field mix-up. */
        | "implausible";
      /** The field that was tried, when one was found. */
      field?: string;
      /** The raw value, for the forensic record. */
      raw?: number;
    };

/**
 * How far from `nowMs` a candle timestamp may sit before it is rejected.
 *
 * Generous backwards (a replay or a slow feed is legitimate), tight forwards (a
 * candle cannot close meaningfully in the future). The point of the band is not to
 * police freshness - it is to catch a UNIT error: seconds misread as ms lands in
 * 1970, ms misread as seconds lands in the year 58000, and both fall outside.
 */
export const CANDLE_TS_PAST_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * One period plus five seconds. The candle in progress legitimately ends in the near
 * future, but nothing beyond one period can. Keeping this tight matters because a
 * future-dated candle produces a NEGATIVE age downstream, and an age that is really
 * feed clock skew must not be tallied as staleness.
 */
export const CANDLE_TS_FUTURE_MS = CANDLE_PERIOD_MS + 5_000;

/** Seconds or milliseconds to milliseconds, or null if it is neither. */
function toMs(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // 1e12 ms is 2001; 1e12 s is the year 33658. Anything at or above 1e12 is
  // already milliseconds, anything from 1e9 up is seconds (1e9 s is 2001).
  if (raw >= 1e12) return Math.round(raw);
  if (raw >= 1e9) return Math.round(raw * 1000);
  return null;
}

/**
 * The candle's close timestamp in epoch ms, or the reason there isn't one.
 *
 * `periodMs` is the request's `period_interval` in ms, used only to move a
 * start-dated row forward to where its close actually happened.
 */
export function candleTs(
  row: unknown,
  nowMs: number,
  periodMs: number = CANDLE_PERIOD_MS,
): CandleTs {
  if (!row || typeof row !== "object") return { ok: false, why: "absent" };
  const rec = row as Record<string, unknown>;

  const tryField = (field: string, kind: "end" | "start-adjusted"): CandleTs | null => {
    if (!(field in rec)) return null;
    const v = rec[field];
    if (v === null || v === undefined || v === "") return null;
    const raw = Number(v);
    if (!Number.isFinite(raw)) return { ok: false, why: "unparseable", field };
    const ms = toMs(raw);
    if (ms === null) return { ok: false, why: "implausible", field, raw };
    const t = kind === "start-adjusted" ? ms + periodMs : ms;
    if (t < nowMs - CANDLE_TS_PAST_MS || t > nowMs + CANDLE_TS_FUTURE_MS) {
      return { ok: false, why: "implausible", field, raw };
    }
    return { ok: true, t, field, kind };
  };

  // End fields first: a close belongs to the end of its period.
  let firstFailure: CandleTs | null = null;
  for (const f of CANDLE_END_FIELDS) {
    const got = tryField(f, "end");
    if (got?.ok) return got;
    if (got && !firstFailure) firstFailure = got;
  }
  for (const f of CANDLE_START_FIELDS) {
    const got = tryField(f, "start-adjusted");
    if (got?.ok) return got;
    if (got && !firstFailure) firstFailure = got;
  }
  // A present-but-bad field is a more useful report than "absent".
  return firstFailure ?? { ok: false, why: "absent" };
}

/** What reading a batch of candles cost, so a thin path can be explained. */
export type CandleTsTally = {
  /** Rows that yielded a usable close price. */
  rows_priced: number;
  /** Of those, rows that also yielded a timestamp. */
  rows_timed: number;
  /** Field names that actually matched, e.g. ["end_period_ts"]. */
  fields: string[];
  /**
   * Rows dated from a period START and moved forward one interval. Persisted, not just
   * counted: the adjustment shifts a timestamp by a whole period, so a non-zero count
   * means those rows' times are DERIVED rather than read, and a reader must know.
   */
  start_adjusted: number;
  /** Rows with a price but no readable timestamp, by reason. */
  absent: number;
  unparseable: number;
  implausible: number;
};

export function emptyTally(): CandleTsTally {
  return {
    rows_priced: 0,
    rows_timed: 0,
    fields: [],
    start_adjusted: 0,
    absent: 0,
    unparseable: 0,
    implausible: 0,
  };
}

/** Fold one row's outcome into the tally. */
export function tally(t: CandleTsTally, got: CandleTs): void {
  if (got.ok) {
    t.rows_timed++;
    if (!t.fields.includes(got.field)) t.fields.push(got.field);
    if (got.kind === "start-adjusted") t.start_adjusted++;
    return;
  }
  t[got.why]++;
}
