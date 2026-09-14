/**
 * Fixed-horizon replay calibration.
 *
 * Pure, read-only measurement. It consumes already-recorded replay rows and
 * compares each seat's directional read with the official settlement at fixed
 * moments before the close. Nothing here votes, learns, promotes, or writes.
 */

export const HORIZON_DEFS = [
  { seconds: 450, label: "7:30" },
  { seconds: 180, label: "3:00" },
  { seconds: 60, label: "1:00" },
  { seconds: 15, label: "0:15" },
] as const;

export const HORIZON_SAMPLE_TOLERANCE_S = 8;

export type HorizonReplayRow = {
  close_time: string | number | Date;
  winner: "UP" | "DOWN";
  cols: {
    t0: number;
    t: readonly number[];
    /** Replay encoding: ±2 heard by Chair, ±1 gagged raw read, 0 quiet. */
    seats: Record<string, readonly number[]>;
  };
};

export type SeatHorizonCell = {
  seconds: number;
  raw_n: number;
  raw_hits: number;
  raw_rate: number | null;
  heard_n: number;
  heard_hits: number;
  heard_rate: number | null;
};

export type SeatHorizonRow = {
  seat: string;
  horizons: SeatHorizonCell[];
};

export type SeatHorizonReport = {
  windows: number;
  horizons: { seconds: number; label: string; sampled_windows: number }[];
  seats: SeatHorizonRow[];
};

type MutableCell = Omit<SeatHorizonCell, "raw_rate" | "heard_rate">;

function closeMs(v: HorizonReplayRow["close_time"]): number {
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
  if (
    best > 0 &&
    Math.abs(Number(t[best - 1]) - target) <= Math.abs(Number(t[best]) - target)
  ) {
    best -= 1;
  }
  return Number.isFinite(Number(t[best])) ? best : null;
}

const rate = (hits: number, n: number): number | null =>
  n > 0 ? Math.round((hits / n) * 1000) / 1000 : null;

/** Build descriptive fixed-horizon calibration from pre-screened replay rows. */
export function buildSeatHorizonReport(rows: readonly HorizonReplayRow[]): SeatHorizonReport {
  const bySeat = new Map<string, Map<number, MutableCell>>();
  const sampled = new Map(HORIZON_DEFS.map((h) => [h.seconds, 0]));
  let windows = 0;

  for (const row of rows) {
    const end = closeMs(row.close_time);
    const t0 = Number(row.cols?.t0);
    const t = row.cols?.t;
    const seats = row.cols?.seats;
    if (
      !Number.isFinite(end) ||
      !Number.isFinite(t0) ||
      !Array.isArray(t) ||
      !seats ||
      typeof seats !== "object" ||
      (row.winner !== "UP" && row.winner !== "DOWN")
    ) {
      continue;
    }
    windows += 1;
    const winner = row.winner === "UP" ? 1 : -1;

    for (const h of HORIZON_DEFS) {
      const target = (end - h.seconds * 1000 - t0) / 1000;
      const index = nearestIndex(t, target);
      if (
        index == null ||
        Math.abs(Number(t[index]) - target) > HORIZON_SAMPLE_TOLERANCE_S
      ) {
        continue;
      }
      sampled.set(h.seconds, (sampled.get(h.seconds) ?? 0) + 1);

      for (const [seat, values] of Object.entries(seats)) {
        const code = Number(values[index]);
        if (code !== 2 && code !== 1 && code !== -1 && code !== -2) continue;
        let seatCells = bySeat.get(seat);
        if (!seatCells) {
          seatCells = new Map();
          bySeat.set(seat, seatCells);
        }
        let cell = seatCells.get(h.seconds);
        if (!cell) {
          cell = { seconds: h.seconds, raw_n: 0, raw_hits: 0, heard_n: 0, heard_hits: 0 };
          seatCells.set(h.seconds, cell);
        }
        const hit = Math.sign(code) === winner ? 1 : 0;
        cell.raw_n += 1;
        cell.raw_hits += hit;
        if (Math.abs(code) === 2) {
          cell.heard_n += 1;
          cell.heard_hits += hit;
        }
      }
    }
  }

  const resultSeats = [...bySeat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([seat, cells]): SeatHorizonRow => ({
      seat,
      horizons: HORIZON_DEFS.map((h) => {
        const cell = cells.get(h.seconds) ?? {
          seconds: h.seconds,
          raw_n: 0,
          raw_hits: 0,
          heard_n: 0,
          heard_hits: 0,
        };
        return {
          ...cell,
          raw_rate: rate(cell.raw_hits, cell.raw_n),
          heard_rate: rate(cell.heard_hits, cell.heard_n),
        };
      }),
    }));

  return {
    windows,
    horizons: HORIZON_DEFS.map((h) => ({
      ...h,
      sampled_windows: sampled.get(h.seconds) ?? 0,
    })),
    seats: resultSeats,
  };
}
