/**
 * The first-screen brief (server only): the Chair's recent decisions and an
 * overnight summary, plus BTC open→now from the engine's current snapshot.
 * Read-only. Cached 30s.
 *
 * GAVEL is Chair decisions only — every graded window is one row, WAIT
 * included. A booked window uses the actual entry-side Chair receipt. An
 * unbooked directional window uses the persisted FIRST_DIRECTIONAL snapshot.
 * Paper settlement/P&L exists only when a position was actually booked.
 */
import { currentSnap } from "./server-engine";
import { gavelLeanOf, toGavelRow, type GavelRow, type GavelSourceRow } from "./gavel";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

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
  const rows = await db<GavelSourceRow>`
    select l.close_time, l.chair_lean, l.chair_conf, l.score, l.bar,
           l.entry_lean, l.entry_cents, l.entry_conf, l.entry_score, l.entry_bar,
           l.settle_cents, l.ev_cents, l.winner,
           fd.chair_lean as first_directional_lean,
           fd.chair_confidence as first_directional_conf,
           fd.chair_score as first_directional_score,
           fd.chair_bar as first_directional_bar
    from desk_ledger_research l
    left join desk_decision_snapshots fd
      on fd.ticker = l.ticker
     and fd.close_time = l.close_time
     and fd.snapshot_kind = 'FIRST_DIRECTIONAL'
    order by l.close_time desc
    limit 40
  `;
  const gavel = rows.map(toGavelRow);

  // Chair activity is direction, not fill count. A booked row uses its entry side;
  // otherwise a persisted first directional read counts as the Chair's opinion.
  // No historical backfill: windows without either remain the recorded WAIT state.
  const overnightRows = await db<{
    chair_lean: string | null;
    entry_lean: string | null;
    entry_cents: number | null;
    settle_cents: number | null;
    winner: string | null;
    first_directional_lean: string | null;
  }>`
    select l.chair_lean, l.entry_lean, l.entry_cents, l.settle_cents, l.winner,
           fd.chair_lean as first_directional_lean
    from desk_ledger_research l
    left join desk_decision_snapshots fd
      on fd.ticker = l.ticker
     and fd.close_time = l.close_time
     and fd.snapshot_kind = 'FIRST_DIRECTIONAL'
    where l.close_time > now() - interval '12 hours'
  `;
  let up = 0;
  let down = 0;
  let wait = 0;
  for (const r of overnightRows) {
    const did = gavelLeanOf(r);
    if (did === "UP") up += 1;
    else if (did === "DOWN") down += 1;
    else wait += 1;
  }

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
