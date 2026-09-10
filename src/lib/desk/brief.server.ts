/**
 * The first-screen brief (server only): the Chair's recent decisions and an
 * overnight summary, straight from the ledger, plus BTC open→now from the
 * engine's current snapshot. Read-only. Cached 30s.
 *
 * GAVEL is Chair decisions only — every graded window is one row, WAIT
 * included. It is never seat fills. Settlement is shown only for a booked
 * UP/DOWN position; a WAIT window has no Chair position to settle, so its
 * settlement is null and the UI prints "—". Times group in Chicago, the
 * floor's clock.
 */
import { currentSnap } from "./server-engine";
import { bookedSideOf } from "./booked-side";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/** One Chair decision. lean is the Chair's call; settle is its position outcome in cents (100/0) or null for WAIT/no-fill. */
export type GavelRow = {
  t: string;
  lean: "UP" | "DOWN" | "WAIT";
  conf: number;
  score: number;
  bar: number;
  settle: number | null;
  ev: number | null;
  /** The market result for the window (real), shown as faint context, never as a Chair settlement. */
  winner: "UP" | "DOWN" | null;
};

export type Overnight = {
  /** Chair decision counts over the last 12h (Chicago). */
  up: number;
  down: number;
  wait: number;
  /** Consecutive most-recent WAIT decisions, for the copy line. */
  wait_streak: number;
  /** BTC spot 12h ago and now, or null when the history is not there. */
  btc_open: number | null;
  btc_now: number | null;
  /** 12h low/high of hourly closes, extra detail; null when unavailable. */
  btc_lo: number | null;
  btc_hi: number | null;
  /** The most recent completed Chair decision/window (the "last huddle"). */
  last: { t: string; lean: "UP" | "DOWN" | "WAIT"; settle: number | null } | null;
};

export type Brief = { gavel: GavelRow[]; overnight: Overnight; at: number };

type LedgerRow = {
  close_time: Date | string;
  chair_lean: string;
  chair_conf: number | null;
  score: number | null;
  bar: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  winner: string | null;
};

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function lean(v: string): "UP" | "DOWN" | "WAIT" {
  return v === "UP" ? "UP" : v === "DOWN" ? "DOWN" : "WAIT";
}

function toGavel(r: LedgerRow): GavelRow {
  const winner = r.winner === "UP" ? "UP" : r.winner === "DOWN" ? "DOWN" : null;
  return {
    t: iso(r.close_time),
    // The side the chair actually booked and held to settlement — not the
    // grade-frame lean, which can decay to WAIT while a position was live.
    // A genuine WAIT window (nothing booked) still shows WAIT.
    lean: bookedSideOf(r.settle_cents, winner) ?? lean(r.chair_lean),
    conf: Math.round(Number(r.chair_conf ?? 0)),
    score: Number(r.score ?? 0),
    bar: Number(r.bar ?? 0),
    settle: r.settle_cents != null ? Number(r.settle_cents) : null,
    ev: r.ev_cents == null ? null : Math.round(Number(r.ev_cents) * 10) / 10,
    winner,
  };
}

/** BTC 12h open→now and the 12h low/high, from the current snapshot's hourly candles. Null when the history is not there. */
function btcOvernight(): Pick<Overnight, "btc_open" | "btc_now" | "btc_lo" | "btc_hi"> {
  const snap = currentSnap();
  const now = snap && snap.spot > 0 ? snap.spot : null;
  const bars = (snap?.candles_1h ?? []).filter((c) => c.closed && c.close > 0);
  if (!snap || bars.length < 12) return { btc_open: null, btc_now: now, btc_lo: null, btc_hi: null };
  const cutoff = snap.as_of - 12 * 60 * 60_000;
  const window = bars.filter((c) => c.t >= cutoff);
  const use = window.length >= 2 ? window : bars.slice(-12);
  const open = use[0]!.open > 0 ? use[0]!.open : use[0]!.close;
  const closes = use.map((c) => c.close);
  return {
    btc_open: Math.round(open),
    btc_now: now == null ? null : Math.round(now),
    btc_lo: Math.round(Math.min(...closes)),
    btc_hi: Math.round(Math.max(...closes)),
  };
}

let cache: { at: number; body: Brief } | null = null;
let inflight: Promise<Brief> | null = null;

/** The brief. Cached 30s; the floor polls it about once a minute. */
export async function deskBrief(): Promise<Brief> {
  if (cache && Date.now() - cache.at < 30_000) return cache.body;
  if (!inflight) {
    inflight = build()
      .then((body) => {
        cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function build(): Promise<Brief> {
  const db = await sql();
  const rows = await db<LedgerRow>`
    select close_time, chair_lean, chair_conf, score, bar, settle_cents, ev_cents, winner
    from desk_ledger
    order by close_time desc
    limit 40
  `;
  const gavel = rows.map(toGavel);

  const overnightRows = await db<{ lean: string; n: number }>`
    select chair_lean as lean, count(*)::int as n
    from desk_ledger
    where close_time > now() - interval '12 hours'
    group by chair_lean
  `;
  let up = 0;
  let down = 0;
  let wait = 0;
  for (const r of overnightRows) {
    if (r.lean === "UP") up = r.n;
    else if (r.lean === "DOWN") down = r.n;
    else wait += r.n;
  }
  // Most-recent consecutive WAIT streak, read off the newest-first rows.
  let waitStreak = 0;
  for (const g of gavel) {
    if (g.lean === "WAIT") waitStreak += 1;
    else break;
  }
  const last = gavel[0] ? { t: gavel[0].t, lean: gavel[0].lean, settle: gavel[0].settle } : null;

  return {
    gavel,
    overnight: { up, down, wait, wait_streak: waitStreak, ...btcOvernight(), last },
    at: Date.now(),
  };
}
