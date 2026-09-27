/**
 * DISAGREEMENT_EDGE_V1
 *
 * Read-only retrospective analysis over already-recorded, officially graded
 * replay windows. The question is not "which seat is accurate?" but whether a
 * seat adds information when it DISAGREES with the same-time Kalshi favorite.
 *
 * No writer, learner, Chair, promotion or booking path imports this module.
 */
import { holdNetCents, neededWinRatePct, realAskCents } from "./fee-engine.ts";

export const DISAGREEMENT_EDGE_HORIZONS = Object.freeze([
  { seconds: 450, label: "T−7:30" },
  { seconds: 300, label: "T−5:00" },
  { seconds: 180, label: "T−3:00" },
] as const);

export const DISAGREEMENT_EDGE_TOLERANCE_S = 8;

export type DisagreementReplayRow = {
  close_time: string | number | Date;
  winner: "UP" | "DOWN";
  cols: {
    t0: number;
    t: readonly number[];
    yes_bid: readonly number[];
    yes_ask: readonly number[];
    /** ±2 heard by Chair, ±1 raw/gagged, 0 quiet. */
    seats: Record<string, readonly number[]>;
  };
};

export type DisagreementEdgeCell = {
  seconds: number;
  label: string;
  disagreement_n: number;
  seat_hits: number;
  seat_wr_pct: number | null;
  heard_n: number;
  heard_hits: number;
  heard_wr_pct: number | null;
  market_hits: number;
  market_wr_pct: number | null;
  seat_avg_ask: number | null;
  market_avg_ask: number | null;
  seat_needed_wr_pct: number | null;
  market_needed_wr_pct: number | null;
  seat_net_cents: number;
  market_net_cents: number;
  net_delta_cents: number;
};

export type DisagreementEdgeSeat = {
  seat: string;
  disagreements: number;
  cells: DisagreementEdgeCell[];
};

export type DisagreementEdgeReport = {
  windows: number;
  horizons: Array<{ seconds: number; label: string; sampled_windows: number }>;
  seats: DisagreementEdgeSeat[];
};

type MutableCell = {
  seconds: number;
  label: string;
  disagreement_n: number;
  seat_hits: number;
  heard_n: number;
  heard_hits: number;
  market_hits: number;
  seat_asks: number[];
  market_asks: number[];
  seat_net_cents: number;
  market_net_cents: number;
};

function closeMs(v: DisagreementReplayRow["close_time"]): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(v);
}

function nearestIndex(t: readonly number[], target: number): number | null {
  if (!t.length || !Number.isFinite(target)) return null;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (Number(t[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  let best = Math.min(lo, t.length - 1);
  if (best > 0 && Math.abs(Number(t[best - 1]) - target) <= Math.abs(Number(t[best]) - target)) best -= 1;
  return Number.isFinite(Number(t[best])) ? best : null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (hits: number, n: number): number | null => n ? r1((100 * hits) / n) : null;
const avg = (xs: readonly number[]): number | null => xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : null;

function sideAsk(side: "UP" | "DOWN", yesBid: number, yesAsk: number): number | null {
  const ask = side === "UP" ? yesAsk : 100 - yesBid;
  return realAskCents(ask) ? ask : null;
}

/** Build a paired, same-window disagreement report from retained replays. */
export function buildDisagreementEdgeReport(rows: readonly DisagreementReplayRow[]): DisagreementEdgeReport {
  const bySeat = new Map<string, Map<number, MutableCell>>();
  const sampled = new Map(DISAGREEMENT_EDGE_HORIZONS.map((h) => [h.seconds, 0]));
  let windows = 0;

  for (const row of rows) {
    const end = closeMs(row.close_time);
    const t0 = Number(row.cols?.t0);
    const t = row.cols?.t;
    const yesBid = row.cols?.yes_bid;
    const yesAsk = row.cols?.yes_ask;
    const seats = row.cols?.seats;
    if (!Number.isFinite(end) || !Number.isFinite(t0) || !Array.isArray(t) || !Array.isArray(yesBid) || !Array.isArray(yesAsk) || !seats) continue;
    if (row.winner !== "UP" && row.winner !== "DOWN") continue;
    windows += 1;

    for (const h of DISAGREEMENT_EDGE_HORIZONS) {
      const target = (end - h.seconds * 1000 - t0) / 1000;
      const i = nearestIndex(t, target);
      if (i == null || Math.abs(Number(t[i]) - target) > DISAGREEMENT_EDGE_TOLERANCE_S) continue;
      const bid = Number(yesBid[i]);
      const ask = Number(yesAsk[i]);
      if (!realAskCents(bid) || !realAskCents(ask) || ask < bid) continue;
      const mid = (bid + ask) / 2;
      if (mid === 50) continue;
      const marketSide: "UP" | "DOWN" = mid > 50 ? "UP" : "DOWN";
      sampled.set(h.seconds, (sampled.get(h.seconds) ?? 0) + 1);

      for (const [seat, values] of Object.entries(seats)) {
        const code = Number(values[i]);
        if (![2, 1, -1, -2].includes(code)) continue;
        const seatSide: "UP" | "DOWN" = code > 0 ? "UP" : "DOWN";
        if (seatSide === marketSide) continue;

        const seatAsk = sideAsk(seatSide, bid, ask);
        const marketAsk = sideAsk(marketSide, bid, ask);
        if (seatAsk == null || marketAsk == null) continue;

        let seatCells = bySeat.get(seat);
        if (!seatCells) {
          seatCells = new Map();
          bySeat.set(seat, seatCells);
        }
        let cell = seatCells.get(h.seconds);
        if (!cell) {
          cell = {
            seconds: h.seconds, label: h.label, disagreement_n: 0, seat_hits: 0,
            heard_n: 0, heard_hits: 0, market_hits: 0, seat_asks: [], market_asks: [],
            seat_net_cents: 0, market_net_cents: 0,
          };
          seatCells.set(h.seconds, cell);
        }

        const seatWon = seatSide === row.winner;
        const marketWon = marketSide === row.winner;
        cell.disagreement_n += 1;
        cell.seat_hits += seatWon ? 1 : 0;
        cell.market_hits += marketWon ? 1 : 0;
        if (Math.abs(code) === 2) {
          cell.heard_n += 1;
          cell.heard_hits += seatWon ? 1 : 0;
        }
        cell.seat_asks.push(seatAsk);
        cell.market_asks.push(marketAsk);
        cell.seat_net_cents += holdNetCents(seatAsk, seatWon);
        cell.market_net_cents += holdNetCents(marketAsk, marketWon);
      }
    }
  }

  const seats: DisagreementEdgeSeat[] = [...bySeat.entries()].map(([seat, cells]) => {
    const out = DISAGREEMENT_EDGE_HORIZONS.map((h): DisagreementEdgeCell => {
      const c = cells.get(h.seconds) ?? {
        seconds: h.seconds, label: h.label, disagreement_n: 0, seat_hits: 0,
        heard_n: 0, heard_hits: 0, market_hits: 0, seat_asks: [], market_asks: [],
        seat_net_cents: 0, market_net_cents: 0,
      };
      return {
        seconds: h.seconds,
        label: h.label,
        disagreement_n: c.disagreement_n,
        seat_hits: c.seat_hits,
        seat_wr_pct: pct(c.seat_hits, c.disagreement_n),
        heard_n: c.heard_n,
        heard_hits: c.heard_hits,
        heard_wr_pct: pct(c.heard_hits, c.heard_n),
        market_hits: c.market_hits,
        market_wr_pct: pct(c.market_hits, c.disagreement_n),
        seat_avg_ask: avg(c.seat_asks),
        market_avg_ask: avg(c.market_asks),
        seat_needed_wr_pct: neededWinRatePct(c.seat_asks),
        market_needed_wr_pct: neededWinRatePct(c.market_asks),
        seat_net_cents: r1(c.seat_net_cents),
        market_net_cents: r1(c.market_net_cents),
        net_delta_cents: r1(c.seat_net_cents - c.market_net_cents),
      };
    });
    return { seat, disagreements: out.reduce((s, c) => s + c.disagreement_n, 0), cells: out };
  }).sort((a, b) => b.disagreements - a.disagreements || a.seat.localeCompare(b.seat));

  return {
    windows,
    horizons: DISAGREEMENT_EDGE_HORIZONS.map((h) => ({ ...h, sampled_windows: sampled.get(h.seconds) ?? 0 })),
    seats,
  };
}
