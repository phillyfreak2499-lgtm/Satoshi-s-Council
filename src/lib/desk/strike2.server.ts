/**
 * STRIKE 2.0's read-out (server only). Read-only on the desk's own history;
 * writes nothing, votes nothing, and no seat reads it.
 *
 * TWO ARMS, AND THE DIFFERENCE MATTERS.
 *
 * The WINDOWS arm reads desk_samples: one row per window, taken at the
 * mid-window decision point, carrying the fair value the desk computed at that
 * moment and the price the market was charging. Every row is a separate settled
 * window, so the observations are independent and `n` means what it looks like.
 * This is the arm to judge anything on.
 *
 * The TAPE arm reads desk_replay: every few seconds of every graded window, with
 * the lab's fair value and the book at that instant. Roughly two hundred times
 * more rows — and thirty of them inside one window share a single outcome, so
 * they are nothing like thirty observations. It is reported with its window count
 * beside its row count for exactly that reason, and its value is the SHAPE it
 * shows across the window, not the size of its sample. A Brier difference on this
 * arm is not evidence of skill.
 *
 * The same no-lookahead machinery runs both: a row becomes evidence only after
 * its own window closed, which is what stops the tape arm's samples from reading
 * their shared answer off each other.
 *
 * WHAT THIS IS NOT. It is not a signal, not a seat, and not an input to anything.
 * The production STRIKE skill is untouched and INDEX keeps its 24-in-regime gate
 * regardless of anything printed here. Nothing in this file can promote itself.
 */
import { getSql } from "@/lib/db";
import { sessionOf, phaseOf } from "./math";
import { INDEX_MIN_REGIME_N } from "./skill-gate.ts";
import {
  strike2Groups,
  strike2Predictions,
  strike2Report,
  type Strike2Group,
  type Strike2Report,
  type Strike2Row,
} from "./strike2.ts";

const TTL_MS = 300_000;
/** The tape arm is the expensive one; a ceiling keeps a page load honest. */
const TAPE_WINDOW_LIMIT = 400;

export type Strike2Arm = {
  report: Strike2Report;
  by_session: Strike2Group[];
  by_mins: Strike2Group[];
};

export type Strike2Study = {
  /** One row per settled window — independent observations. */
  windows: Strike2Arm | null;
  /** Every few seconds of every window — correlated, read for shape only. */
  tape: Strike2Arm | null;
  /** Why an arm is missing, when one is. */
  notes: string[];
  /** Standing constraints, restated here so a reader of this JSON cannot miss them. */
  authority: {
    votes: false;
    shadow: true;
    index_min_regime_n: number;
    /** What it would take for any of this to be heard, stated as a requirement not a plan. */
    to_earn_authority: string;
  };
  at: string;
};

let cache: { at: number; study: Strike2Study } | null = null;

/** Minutes-left bands, coarse enough that each holds real windows. */
function minsBand(m: number | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  if (m >= 12) return "12m+";
  if (m >= 8) return "8-12m";
  if (m >= 4) return "4-8m";
  if (m >= 2) return "2-4m";
  if (m >= 1) return "1-2m";
  return "<1m";
}

function armOf(rows: Strike2Row[]): Strike2Arm | null {
  if (!rows.length) return null;
  const walk = strike2Predictions(rows);
  if (!walk.preds.length) return null;
  return {
    report: strike2Report(walk),
    by_session: strike2Groups(walk.preds, (p) => p.regime ?? null),
    by_mins: strike2Groups(walk.preds, (p) => minsBand(p.mins_left)),
  };
}

type SampleRow = {
  ticker: string;
  close_time: string;
  taken_at: string;
  mins_left: number;
  market: { fair_yes?: number; yes_mid?: number; yes_ask?: number; no_ask?: number } | null;
  winner: string | null;
};

/** desk_samples → one independent row per window. */
async function windowRows(db: Awaited<ReturnType<typeof getSql>>): Promise<Strike2Row[]> {
  const rows = await db<SampleRow>`
    select ticker, close_time, taken_at, mins_left, market, winner
    from desk_samples
    where winner in ('UP','DOWN')
    order by close_time
  `;
  const out: Strike2Row[] = [];
  for (const r of rows) {
    const fair = Number(r.market?.fair_yes);
    const mid = Number(r.market?.yes_mid);
    const t = Date.parse(r.taken_at);
    const close = Date.parse(r.close_time);
    if (!Number.isFinite(fair) || !Number.isFinite(t) || !Number.isFinite(close)) continue;
    const mins = Number(r.mins_left);
    out.push({
      t,
      known_at: close,
      window: r.ticker,
      fair_yes: fair,
      market_yes: Number.isFinite(mid) ? mid : 0,
      up: r.winner === "UP",
      // The regime as the desk names it: session from the clock, phase from what
      // was left. Recomputed the same way the engine does, not guessed.
      regime: `${sessionOf(t)}_${phaseOf(Number.isFinite(mins) ? mins : 0)}`,
      ...(Number.isFinite(mins) ? { mins_left: mins } : {}),
    });
  }
  return out;
}

type ReplayRow = {
  ticker: string;
  close_time: string;
  winner: string | null;
  cols: { t0?: number; t?: number[]; fair?: (number | null)[]; yes_bid?: number[]; yes_ask?: number[] } | null;
};

/**
 * desk_replay → every stored instant of every graded window. `fair` is the lab's
 * settlement-model probability in cents; the market price is the book's midpoint
 * at the same instant. Rows carry their window so the correlation is visible.
 */
async function tapeRows(db: Awaited<ReturnType<typeof getSql>>): Promise<Strike2Row[]> {
  const rows = await db<ReplayRow>`
    select ticker, close_time, winner, cols
    from desk_replay
    where winner in ('UP','DOWN')
    order by close_time desc
    limit ${TAPE_WINDOW_LIMIT}
  `;
  const out: Strike2Row[] = [];
  for (const r of rows) {
    const c = r.cols;
    const close = Date.parse(r.close_time);
    const t0 = Number(c?.t0);
    const ts = c?.t;
    if (!Array.isArray(ts) || !Number.isFinite(close) || !Number.isFinite(t0)) continue;
    const up = r.winner === "UP";
    for (let i = 0; i < ts.length; i++) {
      const fair = Number(c?.fair?.[i]);
      if (!Number.isFinite(fair)) continue;
      const bid = Number(c?.yes_bid?.[i]);
      const ask = Number(c?.yes_ask?.[i]);
      const mid = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 ? (bid + ask) / 2 : NaN;
      const t = t0 + Number(ts[i]) * 1000;
      if (!Number.isFinite(t)) continue;
      const mins = (close - t) / 60_000;
      out.push({
        t,
        known_at: close,
        window: r.ticker,
        fair_yes: fair,
        market_yes: Number.isFinite(mid) ? mid : 0,
        up,
        regime: `${sessionOf(t)}_${phaseOf(mins)}`,
        mins_left: Math.round(mins * 100) / 100,
      });
    }
  }
  return out;
}

/**
 * Both arms, cached five minutes. An arm that cannot be built is null with a
 * stated reason; it is never a zero.
 */
export async function strike2Study(): Promise<Strike2Study> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.study;
  const db = await getSql();
  const notes: string[] = [];
  let windows: Strike2Arm | null = null;
  let tape: Strike2Arm | null = null;

  try {
    const rows = await windowRows(db);
    windows = armOf(rows);
    if (!windows) notes.push("windows arm: no graded desk_samples row carries a usable fair value yet");
  } catch (err) {
    notes.push(`windows arm failed: ${short(err)}`);
  }

  try {
    const rows = await tapeRows(db);
    tape = armOf(rows);
    if (!tape) notes.push("tape arm: no graded desk_replay row carries a usable lab fair value yet");
  } catch (err) {
    notes.push(`tape arm failed: ${short(err)}`);
  }

  if (windows) {
    // Say the sample size out loud, in the units that matter.
    notes.push(
      `windows arm: ${windows.report.n} independent windows. A Brier edge on this few is suggestive, not settled.`,
    );
  }
  if (tape) {
    notes.push(
      `tape arm: ${tape.report.n} samples from ${tape.report.windows} windows — about ${
        tape.report.windows ? Math.round(tape.report.n / tape.report.windows) : 0
      } per window, all sharing one outcome. Read the shape across the window, not the sample size.`,
    );
  }

  const study: Strike2Study = {
    windows,
    tape,
    notes,
    authority: {
      votes: false,
      shadow: true,
      index_min_regime_n: INDEX_MIN_REGIME_N,
      to_earn_authority:
        `Nothing here votes. A calibrated probability would have to beat the market's own price ` +
        `prospectively, on windows recorded after the method was fixed, and INDEX still needs ` +
        `${INDEX_MIN_REGIME_N} in-regime walk-forward observations before it may be heard at all. ` +
        `A good-looking number in this JSON changes no production behaviour.`,
    },
    at: new Date().toISOString(),
  };
  cache = { at: Date.now(), study };
  return study;
}

function short(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 140);
}
