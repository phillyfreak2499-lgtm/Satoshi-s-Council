/**
 * Window replay (server only). Every brain tick takes a compact sample of
 * what the desk could see and what it said: spot, the yes book, the lab's
 * settlement fair, the chair's lean and confidence, the seat tally and
 * every seat's lean (spoken, or whispered under the gag). Samples live in
 * memory per window and are written once, at grade, so a visitor can scrub
 * back through any past window. Nothing here feeds a decision.
 *
 * SINCE 2026-09-11 it also records the shadow microstructure: how lopsided the
 * book was, where the size-weighted price sat against the mid, order-flow
 * imbalance, how much of the book churn was cancels rather than trades, net
 * executed flow, the part of the last 30 seconds of price move the underlying
 * does not explain, and which market moved first.
 *
 * Why in the replay rather than only in a live pane: a measurement nobody can
 * look at after the fact cannot be argued with. Storing the series is what makes
 * it possible to ask, on a window that went wrong, whether the book was already
 * saying so — and to be told no. The reads are recorded, not acted on: no seat
 * consumes them and the chair on these very windows never saw them.
 *
 * They are a SUBSET. TAPE 2.0 measures about thirty things a second and storing
 * all of them every four seconds for every window would be a large table for a
 * question nobody has asked yet. These seven are the ones that tell the story
 * while scrubbing; the rest stay live-only until something needs them.
 */
import { tape2Now, vel2Now } from "./lab.server";
import { openSlot, REPLAY_STEP_MS, WindowStore, type WindowSeries } from "./replay-window";
import { lookupOneWindow, payloadKey } from "./replay-lookup";
import { measureWindowPath, type WindowPathStats } from "./window-path";
import type { ChairResult, Snapshot, Vote } from "./types";
import { SEAT_IDS } from "./types";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

// REPLAY_STEP_MS and MAX_SAMPLES live in replay-window.ts with the identity they
// belong to; re-exported so existing importers are unaffected.
export { REPLAY_STEP_MS };
const KEEP_DAYS = 30;
const WINDOW_MS = 15 * 60_000;
export const LEAN_SEATS = SEAT_IDS.filter((s) => s !== "WARDEN");

export type ReplayCols = {
  /** Wall-clock ms of the first sample; t[] are seconds after it. */
  t0: number;
  t: number[];
  spot: number[];
  yes_bid: number[];
  yes_ask: number[];
  /** The lab's settlement fair in yes-cents, null when the lab had none. */
  fair: (number | null)[];
  /** Chair: 1 UP, -1 DOWN, 0 WAIT. */
  lean: number[];
  conf: number[];
  ups: number[];
  downs: number[];
  /** 1 once the chair holds a booked call for the window. */
  booked: number[];
  /** Per seat: ±2 spoken, ±1 whispered under the gag, 0 quiet. */
  seats: Record<string, number[]>;
  /** Depth imbalance five levels in, −1 all asks to +1 all bids. */
  imb: (number | null)[];
  /** Size-weighted price minus the midpoint, in cents: where the pressure sits. */
  micro: (number | null)[];
  /** Order-flow imbalance over 15s, normalised by the events behind it. */
  ofi: (number | null)[];
  /** Share of book churn that was cancels rather than adds, 0–1. */
  cancel: (number | null)[];
  /** Net executed size over 15s, buys minus sells. A cancel is not a trade. */
  tflow: (number | null)[];
  /** The 30s YES move the BTC move does not explain, in cents. */
  resid: (number | null)[];
  /** Who moved first over 30s: 1 spot, −1 Kalshi, 0 together, null neither. */
  lead: (number | null)[];
};

/** A buffered series. The shape replay-window.ts stores, with this file's columns. */
type Series = WindowSeries<ReplayCols>;

/**
 * The buffered series, one per WINDOW — see replay-window.ts for why identity is
 * (ticker, close_time) and not the ticker alone, and for the 2026-09-10 ticker-reuse
 * shape the old keying could not survive. (What that keying PERMITTED is proven from
 * the code; whether it actually blended those windows is undetermined.) Every access
 * below goes through the store, which has no method that takes a ticker by itself.
 */
const series = new WindowStore<ReplayCols>();

function leanCode(v: Vote): number {
  if (v.lean === "UP") return 2;
  if (v.lean === "DOWN") return -2;
  if (v.raw_lean === "UP") return 1;
  if (v.raw_lean === "DOWN") return -1;
  return 0;
}

/** Called every brain tick with the live frame. Cheap; never throws. */
export function noteReplay(snap: Snapshot, votes: Vote[], chair: ChairResult, booked: boolean, fair: number | null): void {
  try {
    if (!snap.ticker || !(snap.close_time > 0) || snap.demo || !(snap.spot > 0)) return;
    const slot = openSlot(
      series,
      snap.ticker,
      snap.close_time,
      snap.as_of,
      snap.strike,
      (t0): ReplayCols => ({
          t0,
          t: [],
          spot: [],
          yes_bid: [],
          yes_ask: [],
          fair: [],
          lean: [],
          conf: [],
          ups: [],
          downs: [],
          booked: [],
          seats: Object.fromEntries(LEAN_SEATS.map((x) => [x, [] as number[]])),
          imb: [],
          micro: [],
          ofi: [],
          cancel: [],
          tflow: [],
          resid: [],
          lead: [],
      }),
    );
    // Too soon after the last sample, or this window is already at its cap.
    if (!slot) return;
    const c = slot.series.cols;
    const off = slot.offset;
    let ups = 0;
    let downs = 0;
    const byId = new Map<string, Vote>();
    for (const v of votes) {
      if (v.seat === "WARDEN") continue;
      byId.set(v.seat, v);
      if (v.lean === "UP") ups++;
      else if (v.lean === "DOWN") downs++;
    }
    c.t.push(off);
    c.spot.push(Math.round(snap.spot * 100) / 100);
    c.yes_bid.push(Math.round(snap.yes_bid * 10) / 10);
    c.yes_ask.push(Math.round(snap.yes_ask * 10) / 10);
    c.fair.push(fair == null || !Number.isFinite(fair) ? null : Math.round(fair * 10) / 10);
    c.lean.push(chair.lean === "UP" ? 1 : chair.lean === "DOWN" ? -1 : 0);
    c.conf.push(Math.round(chair.confidence));
    c.ups.push(ups);
    c.downs.push(downs);
    c.booked.push(booked ? 1 : 0);
    for (const id of LEAN_SEATS) {
      const v = byId.get(id);
      c.seats[id].push(v ? leanCode(v) : 0);
    }
    noteShadow(c, snap.ticker);
  } catch {
    /* a replay must never cost a tick */
  }
}

/**
 * Push one shadow reading per sample, or a null for every series when the lab is
 * dark. Every column is pushed exactly once per row so the arrays stay the same
 * length as `t` — a shorter array would silently shift every later reading onto
 * the wrong instant, which is the one way a replay can lie.
 */
function noteShadow(c: ReplayCols, ticker: string): void {
  const t2 = tape2Now(ticker);
  const v2 = vel2Now(ticker);
  c.imb.push(r3(t2?.imb_l5));
  c.micro.push(r2(t2?.micro_minus_mid));
  c.ofi.push(r3(t2?.ofi_norm_15s));
  c.cancel.push(r3(t2?.cancel_share));
  c.tflow.push(r2(t2?.trade_imb_15s));
  // The 30s horizon: long enough to have moved, short enough to still be about
  // this instant. `ok` is false when the horizon had too few samples to measure,
  // and a thin read is stored as nothing rather than as a zero.
  c.resid.push(v2?.h30.ok ? r2(v2.h30.residual) : null);
  c.lead.push(leaderCode(v2?.lead.leader));
}

function leaderCode(v: string | undefined): number | null {
  if (v === "SPOT") return 1;
  if (v === "KALSHI") return -1;
  if (v === "SIMULTANEOUS") return 0;
  return null;
}

const r2 = (n: number | null | undefined): number | null =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
const r3 = (n: number | null | undefined): number | null =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 1000) / 1000;

/**
 * The samples held for ONE window right now (tests and the live pane).
 *
 * Exact identity: a wrong `closeMs` returns null rather than another window that
 * happens to share the ticker.
 */
export function replayLive(ticker: string, closeMs: number): Series | null {
  return series.get(ticker, closeMs);
}

/**
 * Write ONE graded window's samples, then forget that window.
 *
 * `closeMs` is the close the caller has already identity-validated — the same
 * `snap.close_time` `applyGrade` graded on. It consumes and deletes only that
 * window's buffer: another close sharing the ticker is left exactly where it is,
 * and an unknown window writes nothing and deletes nothing rather than falling
 * back to whatever the ticker happens to point at.
 */
export async function recordReplay(ticker: string, closeMs: number, winner: "UP" | "DOWN"): Promise<void> {
  // One operation: it cannot read one window and delete another.
  const s = series.take(ticker, closeMs);
  if (!s) return;
  if (s.cols.t.length < 3) return;
  const partial = s.cols.t0 - (s.close_time - WINDOW_MS) > 60_000;
  const pathStats = measureWindowPath({
    t0: s.cols.t0,
    t: s.cols.t,
    spot: s.cols.spot,
    strike: s.strike,
    close_time: s.close_time,
  });
  const db = await sql();
  await db`
    insert into desk_replay (ticker, close_time, strike, winner, n, step_ms, partial, cols, path_stats)
    values (${ticker}, ${new Date(s.close_time).toISOString()}, ${s.strike > 0 ? s.strike : null}, ${winner},
            ${s.cols.t.length}, ${REPLAY_STEP_MS}, ${partial}, ${JSON.stringify(s.cols)}::jsonb,
            ${pathStats == null ? null : JSON.stringify(pathStats)}::jsonb)
    on conflict (ticker, close_time) do nothing
  `;
}

export async function pruneReplays(): Promise<void> {
  const db = await sql();
  await db`delete from desk_replay where close_time < now() - (${KEEP_DAYS} || ' days')::interval`;
}

export type Replay = {
  ticker: string;
  close_time: string;
  strike: number | null;
  winner: "UP" | "DOWN" | null;
  n: number;
  step_ms: number;
  partial: boolean;
  cols: ReplayCols;
  /** Measurement-only spot-path summary computed after grade. */
  path: WindowPathStats | null;
  official: number | null;
  call: { entry: number; settle: number | null; ev: number | null } | null;
};

const TICKER_RE = /^[A-Z0-9-]{6,40}$/;

/**
 * Finished replays, keyed by the WINDOW they belong to — never by ticker.
 *
 * A ticker-keyed cache would defeat the ambiguity check below: the first visitor to a
 * ticker with one replay would cache that row, and once a second close sharing the
 * ticker was written the ticker-only lookup would keep serving the cached first row
 * instead of refusing. The ambiguity decision is therefore always made against live
 * data (see `replayFor`), and only the payload of a window already resolved EXACTLY is
 * cached. A row is immutable once written, so caching the payload is safe; caching the
 * ticker-to-window mapping is not.
 */
const recent = new Map<string, Replay>();

// The cache key is the shared one from replay-lookup, so the store and the lookup
// cannot disagree about what a cache entry is keyed on.
export { payloadKey as recentKey };

/**
 * One graded window's replay for a ticker-only URL, or null.
 *
 * THE ROUTE SHAPE IS UNCHANGED: a visitor arrives with a ticker and nothing else. But
 * a ticker is not a window — `desk_replay` can now hold two closes that share one, as
 * 2026-09-10 showed a feed can produce. So:
 *
 *   0 rows for the ticker  -> null, exactly as before
 *   1 row                  -> that window
 *   2 or more              -> null. FAIL CLOSED.
 *
 * No heuristic picks one. Not the newest, not the oldest, not whichever the planner
 * returned first. The URL does not say which window the visitor meant, so choosing
 * would rebuild the identity defect at the API layer — and showing the wrong window's
 * series under a shared ticker is worse than showing none.
 *
 * `limit 2` is an ambiguity PROBE, not a guess: with two rows in hand the answer is
 * "refuse" regardless of which two they are, so the absence of an `order by` cannot
 * influence the outcome. The payload query that follows is addressed by BOTH halves of
 * the identity, where `limit 1` names a single row by construction rather than picking
 * one of several.
 */
export async function replayFor(tickerRaw: unknown): Promise<Replay | null> {
  const ticker = typeof tickerRaw === "string" ? tickerRaw.trim().toUpperCase() : "";
  if (!TICKER_RE.test(ticker)) return null;
  const db = await sql();
  return lookupOneWindow(
    ticker,
    recent,
    // THE IDENTITY PROBE. Identity columns only, never cached, so a second close
    // written for this ticker becomes visible at once. `limit 2` is an ambiguity
    // PROBE, not a pick: with two rows in hand the answer is "refuse" whichever two
    // they are, so the absence of an `order by` cannot influence the outcome.
    async (t) => {
      const found = await db<{ close_time: Date | string }>`
        select close_time from desk_replay where ticker = ${t} limit 2
      `;
      return found.map((f) => ({ close_time: isoOf(f.close_time) }));
    },
    // THE PAYLOAD, addressed by BOTH halves — so its `limit 1` names a single row by
    // construction rather than choosing among several.
    async (t, closeIso) => {
      const rows = await db<{
        ticker: string;
        close_time: Date | string;
        strike: number | null;
        winner: string | null;
        n: number;
        step_ms: number;
        partial: boolean;
        cols: ReplayCols;
        path_stats: WindowPathStats | null;
        official_value: number | null;
        entry_cents: number | null;
        settle_cents: number | null;
        ev_cents: number | null;
      }>`
        select r.ticker, r.close_time, r.strike, r.winner, r.n, r.step_ms, r.partial, r.cols, r.path_stats,
               l.official_value, l.entry_cents, l.settle_cents, l.ev_cents
        from desk_replay r
        left join desk_ledger l on l.ticker = r.ticker and l.close_time = r.close_time
        where r.ticker = ${t} and r.close_time = ${closeIso}
        limit 1
      `;
      const r = rows[0];
      if (!r) return null;
      return {
        ticker: r.ticker,
        close_time: isoOf(r.close_time),
        strike: r.strike,
        winner: r.winner === "UP" ? "UP" : r.winner === "DOWN" ? "DOWN" : null,
        n: r.n,
        step_ms: r.step_ms,
        partial: r.partial,
        cols: r.cols,
        path: r.path_stats,
        official: r.official_value,
        call: r.entry_cents != null ? { entry: r.entry_cents, settle: r.settle_cents, ev: r.ev_cents } : null,
      } satisfies Replay;
    },
  );
}

const isoOf = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

