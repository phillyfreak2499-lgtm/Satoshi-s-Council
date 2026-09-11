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
import type { ChairResult, Snapshot, Vote } from "./types";
import { SEAT_IDS } from "./types";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/** Samples are at least this far apart; the brain ticks every 2.5–4 s. */
export const REPLAY_STEP_MS = 4_000;
const MAX_SAMPLES = 320;
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

type Series = { ticker: string; close_time: number; strike: number; cols: ReplayCols };

const series = new Map<string, Series>();

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
    let s = series.get(snap.ticker);
    if (!s) {
      for (const [k, v] of series) if (snap.as_of - v.close_time > 3_600_000) series.delete(k);
      s = {
        ticker: snap.ticker,
        close_time: snap.close_time,
        strike: snap.strike > 0 ? snap.strike : 0,
        cols: {
          t0: snap.as_of,
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
        },
      };
      series.set(snap.ticker, s);
    }
    const c = s.cols;
    const lastT = c.t.length ? c.t[c.t.length - 1] : null;
    const off = (snap.as_of - c.t0) / 1000;
    if (lastT != null && off - lastT < REPLAY_STEP_MS / 1000 - 0.25) return;
    if (c.t.length >= MAX_SAMPLES) return;
    if (!(s.strike > 0) && snap.strike > 0) s.strike = snap.strike;
    let ups = 0;
    let downs = 0;
    const byId = new Map<string, Vote>();
    for (const v of votes) {
      if (v.seat === "WARDEN") continue;
      byId.set(v.seat, v);
      if (v.lean === "UP") ups++;
      else if (v.lean === "DOWN") downs++;
    }
    c.t.push(Math.round(off * 10) / 10);
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

/** The samples held for a window right now (tests and the live pane). */
export function replayLive(ticker: string): Series | null {
  return series.get(ticker) ?? null;
}

/** Write the window's samples once it has graded, then forget them. */
export async function recordReplay(ticker: string, winner: "UP" | "DOWN"): Promise<void> {
  const s = series.get(ticker);
  if (!s) return;
  series.delete(ticker);
  if (s.cols.t.length < 3) return;
  const partial = s.cols.t0 - (s.close_time - WINDOW_MS) > 60_000;
  const db = await sql();
  await db`
    insert into desk_replay (ticker, close_time, strike, winner, n, step_ms, partial, cols)
    values (${ticker}, ${new Date(s.close_time).toISOString()}, ${s.strike > 0 ? s.strike : null}, ${winner},
            ${s.cols.t.length}, ${REPLAY_STEP_MS}, ${partial}, ${JSON.stringify(s.cols)}::jsonb)
    on conflict (ticker) do nothing
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
  official: number | null;
  call: { entry: number; settle: number | null; ev: number | null } | null;
};

const TICKER_RE = /^[A-Z0-9-]{6,40}$/;
const recent = new Map<string, Replay>();

/** One graded window's replay, or null. Immutable once written, so cached. */
export async function replayFor(tickerRaw: unknown): Promise<Replay | null> {
  const ticker = typeof tickerRaw === "string" ? tickerRaw.trim().toUpperCase() : "";
  if (!TICKER_RE.test(ticker)) return null;
  const hit = recent.get(ticker);
  if (hit) return hit;
  const db = await sql();
  const rows = await db<{
    ticker: string;
    close_time: Date | string;
    strike: number | null;
    winner: string | null;
    n: number;
    step_ms: number;
    partial: boolean;
    cols: ReplayCols;
    official_value: number | null;
    entry_cents: number | null;
    settle_cents: number | null;
    ev_cents: number | null;
  }>`
    select r.ticker, r.close_time, r.strike, r.winner, r.n, r.step_ms, r.partial, r.cols,
           l.official_value, l.entry_cents, l.settle_cents, l.ev_cents
    from desk_replay r
    left join desk_ledger l on l.ticker = r.ticker
    where r.ticker = ${ticker}
    limit 1
  `;
  const r = rows[0];
  if (!r) return null;
  const out: Replay = {
    ticker: r.ticker,
    close_time: r.close_time instanceof Date ? r.close_time.toISOString() : new Date(r.close_time).toISOString(),
    strike: r.strike,
    winner: r.winner === "UP" ? "UP" : r.winner === "DOWN" ? "DOWN" : null,
    n: r.n,
    step_ms: r.step_ms,
    partial: r.partial,
    cols: r.cols,
    official: r.official_value,
    call: r.entry_cents != null ? { entry: r.entry_cents, settle: r.settle_cents, ev: r.ev_cents } : null,
  };
  recent.set(ticker, out);
  if (recent.size > 24) recent.delete(recent.keys().next().value as string);
  return out;
}
