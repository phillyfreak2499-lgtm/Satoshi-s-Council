/**
 * DISAGREEMENT_EDGE_V1
 *
 * Read-only retrospective analysis over frozen, officially graded call-quality
 * checkpoints. The question is not "which seat is accurate?" but whether a seat
 * adds information when it DISAGREES with the same-time Kalshi favorite.
 *
 * No writer, learner, Chair, promotion or booking path imports this module.
 */
import { holdNetCents, neededWinRatePct, realAskCents } from "./fee-engine.ts";

export const DISAGREEMENT_EDGE_HORIZONS = Object.freeze([
  { seconds: 450, label: "T−7:30" },
  { seconds: 300, label: "T−5:00" },
  { seconds: 180, label: "T−3:00" },
] as const);

type Side = "UP" | "DOWN";

export type DisagreementCheckpointRow = {
  ticker: string;
  close_time: string | number | Date;
  horizon: number;
  winner: Side;
  market_p: number | null;
  quotes: {
    yes_ask: number;
    yes_bid: number;
    no_ask: number;
    no_bid: number;
  };
  seats: Array<{
    seat: string;
    lean: string;
    health: string;
    heard: boolean;
  }>;
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

const r1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (hits: number, n: number): number | null => n ? r1((100 * hits) / n) : null;
const avg = (xs: readonly number[]): number | null => xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
const directional = (v: unknown): v is Side => v === "UP" || v === "DOWN";
const horizonSpec = (seconds: number) => DISAGREEMENT_EDGE_HORIZONS.find((h) => h.seconds === seconds) ?? null;

function sideAsk(side: Side, quotes: DisagreementCheckpointRow["quotes"]): number | null {
  const ask = side === "UP" ? Number(quotes?.yes_ask) : Number(quotes?.no_ask);
  return realAskCents(ask) ? ask : null;
}

function windowKey(row: DisagreementCheckpointRow): string | null {
  const close = row.close_time instanceof Date
    ? row.close_time.getTime()
    : typeof row.close_time === "number"
      ? row.close_time
      : Date.parse(row.close_time);
  if (!row.ticker || !Number.isFinite(close)) return null;
  return `${row.ticker}|${close}`;
}

/** Build a paired, same-window disagreement report from frozen checkpoints. */
export function buildDisagreementEdgeReport(rows: readonly DisagreementCheckpointRow[]): DisagreementEdgeReport {
  const bySeat = new Map<string, Map<number, MutableCell>>();
  const sampled = new Map(DISAGREEMENT_EDGE_HORIZONS.map((h) => [h.seconds, 0]));
  const windows = new Set<string>();

  for (const row of rows) {
    const spec = horizonSpec(Number(row.horizon));
    const key = windowKey(row);
    const p = Number(row.market_p);
    if (!spec || !key || !directional(row.winner) || !Number.isFinite(p) || !(p > 0 && p < 1) || p === 0.5) continue;
    if (!row.quotes || !Array.isArray(row.seats)) continue;

    const marketSide: Side = p > 0.5 ? "UP" : "DOWN";
    const marketAsk = sideAsk(marketSide, row.quotes);
    if (marketAsk == null) continue;

    windows.add(key);
    sampled.set(spec.seconds, (sampled.get(spec.seconds) ?? 0) + 1);

    for (const read of row.seats) {
      if (!read?.seat || read.health !== "LIVE" || !directional(read.lean) || read.lean === marketSide) continue;
      const seatAsk = sideAsk(read.lean, row.quotes);
      if (seatAsk == null) continue;

      let seatCells = bySeat.get(read.seat);
      if (!seatCells) {
        seatCells = new Map();
        bySeat.set(read.seat, seatCells);
      }
      let cell = seatCells.get(spec.seconds);
      if (!cell) {
        cell = {
          seconds: spec.seconds, label: spec.label, disagreement_n: 0, seat_hits: 0,
          heard_n: 0, heard_hits: 0, market_hits: 0, seat_asks: [], market_asks: [],
          seat_net_cents: 0, market_net_cents: 0,
        };
        seatCells.set(spec.seconds, cell);
      }

      const seatWon = read.lean === row.winner;
      const marketWon = marketSide === row.winner;
      cell.disagreement_n += 1;
      cell.seat_hits += seatWon ? 1 : 0;
      cell.market_hits += marketWon ? 1 : 0;
      if (read.heard === true) {
        cell.heard_n += 1;
        cell.heard_hits += seatWon ? 1 : 0;
      }
      cell.seat_asks.push(seatAsk);
      cell.market_asks.push(marketAsk);
      cell.seat_net_cents += holdNetCents(seatAsk, seatWon);
      cell.market_net_cents += holdNetCents(marketAsk, marketWon);
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
    return { seat, disagreements: out.reduce((sum, cell) => sum + cell.disagreement_n, 0), cells: out };
  }).sort((a, b) => b.disagreements - a.disagreements || a.seat.localeCompare(b.seat));

  return {
    windows: windows.size,
    horizons: DISAGREEMENT_EDGE_HORIZONS.map((h) => ({
      ...h,
      sampled_windows: sampled.get(h.seconds) ?? 0,
    })),
    seats,
  };
}
