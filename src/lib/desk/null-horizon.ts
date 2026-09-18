/**
 * NULL_HORIZON_V1 — fixed-horizon council vs a driftless null.
 *
 * Pure, read-only measurement over already-recorded replay rows.
 * Nothing here votes live, learns, promotes, or writes.
 */
import {
  HORIZON_DEFS,
  HORIZON_SAMPLE_TOLERANCE_S,
} from "./horizon-calibration.ts";

export const NULL_HORIZON_STUDY = "NULL_HORIZON_V1" as const;
export const NULL_HORIZON_AUTHORITY = "none" as const;
export const WINDOW_CAP = 700;
export const MIN_SEAT_N = 20;
export const EDGE_MIN_CENTS = 3;
export const ASK_FLOOR = 80;
export const ASK_CEIL = 98;
export const SPREAD_MAX = 2;
export const EXTRA_COST_CENTS = 1;

export type NullHorizonArm = "NULL" | "HEARD" | "RAW" | "HORIZON";

export type NullHorizonReplayRow = {
  ticker?: string;
  close_time: string | number | Date;
  winner: "UP" | "DOWN";
  strike: number | null;
  cols: {
    t0: number;
    t: readonly number[];
    spot?: readonly number[];
    yes_bid?: readonly (number | null)[];
    yes_ask?: readonly (number | null)[];
    fair?: readonly (number | null)[];
    seats: Record<string, readonly number[]>;
  };
};

export type ArmDecision = {
  arm: NullHorizonArm;
  side: "UP" | "DOWN" | null;
  p_up: number | null;
  reason: "take" | "sit" | "missing";
};

export type ArmCell = {
  arm: NullHorizonArm;
  seconds: number;
  eligible: number;
  taken: number;
  hits: number;
  hit_rate: number | null;
  brier: number | null;
  market_brier: number | null;
  hit_minus_market: number | null;
  net_cents: number;
  net_extra_cost_cents: number;
  max_dd_cents: number;
  missing: number;
};

export type NullHorizonReport = {
  study: typeof NULL_HORIZON_STUDY;
  authority: typeof NULL_HORIZON_AUTHORITY;
  windows: number;
  horizons: { seconds: number; label: string; sampled_windows: number }[];
  cells: ArmCell[];
  gate: {
    horizon_beats_null_brier_450: boolean | null;
    horizon_beats_null_net_450: boolean | null;
    horizon_beats_null_brier_180: boolean | null;
    horizon_beats_null_net_180: boolean | null;
    cleared: boolean;
    note: string;
  };
};

function closeMs(v: NullHorizonReplayRow["close_time"]): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(String(v));
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

/** Kalshi taker fee in cents: ceil(0.07 · P · (1−P) · 100) for 1 contract. */
export function takerFeeAt(priceCents: number): number {
  if (!Number.isFinite(priceCents)) return 0;
  const p = Math.min(99, Math.max(1, priceCents)) / 100;
  return Math.ceil(7 * p * (1 - p));
}

function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function logOdds(hits: number, n: number): number {
  const a = 1;
  const p = (hits + a) / (n + 2 * a);
  return Math.log(p / (1 - p));
}

function rate(hits: number, n: number): number | null {
  return n > 0 ? Math.round((hits / n) * 1000) / 1000 : null;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

type SeatBook = { n: number; hits: number };

function bookKey(seat: string, seconds: number | "all"): string {
  return `${seat}:${seconds}`;
}

export function frameIndex(
  row: NullHorizonReplayRow,
  seconds: number,
): number | null {
  const end = closeMs(row.close_time);
  const t0 = Number(row.cols?.t0);
  const t = row.cols?.t;
  if (!Number.isFinite(end) || !Number.isFinite(t0) || !Array.isArray(t)) return null;
  const target = (end - seconds * 1000 - t0) / 1000;
  const index = nearestIndex(t, target);
  if (index == null || Math.abs(Number(t[index]) - target) > HORIZON_SAMPLE_TOLERANCE_S) {
    return null;
  }
  return index;
}

function quoteAt(
  row: NullHorizonReplayRow,
  index: number,
  side: "UP" | "DOWN",
): { ask: number; mid: number; spread: number } | null {
  const bid = Number(row.cols.yes_bid?.[index]);
  const askYes = Number(row.cols.yes_ask?.[index]);
  if (!Number.isFinite(bid) || !Number.isFinite(askYes)) return null;
  const mid = (bid + askYes) / 2;
  const spread = Math.abs(askYes - bid);
  const ask = side === "UP" ? askYes : 100 - bid;
  if (!Number.isFinite(ask)) return null;
  return { ask, mid, spread };
}

function votePUp(
  row: NullHorizonReplayRow,
  index: number,
  seconds: number,
  mode: "HEARD" | "RAW" | "HORIZON",
  books: Map<string, SeatBook>,
): number | null {
  let score = 0;
  let voices = 0;
  const minAbs = mode === "HEARD" ? 2 : 1;
  for (const [seat, values] of Object.entries(row.cols.seats ?? {})) {
    const code = Number(values[index]);
    if (code !== 2 && code !== 1 && code !== -1 && code !== -2) continue;
    if (Math.abs(code) < minAbs) continue;
    const key = mode === "HORIZON" ? bookKey(seat, seconds) : bookKey(seat, "all");
    const book = books.get(key) ?? { n: 0, hits: 0 };
    if (book.n < MIN_SEAT_N) continue;
    score += Math.sign(code) * logOdds(book.hits, book.n);
    voices += 1;
  }
  if (!voices) return null;
  return sigmoid(score);
}

function decide(
  arm: NullHorizonArm,
  row: NullHorizonReplayRow,
  index: number,
  seconds: number,
  books: Map<string, SeatBook>,
): ArmDecision {
  let pUp: number | null = null;
  if (arm === "NULL") {
    const fair = row.cols.fair?.[index];
    pUp = fair == null || !Number.isFinite(Number(fair)) ? null : Number(fair) / 100;
    if (pUp == null) return { arm, side: null, p_up: null, reason: "missing" };
    pUp = Math.min(0.99, Math.max(0.01, pUp));
  } else {
    pUp = votePUp(row, index, seconds, arm, books);
    if (pUp == null) return { arm, side: null, p_up: null, reason: "sit" };
  }
  const side: "UP" | "DOWN" = pUp >= 0.5 ? "UP" : "DOWN";
  const q = quoteAt(row, index, side);
  if (!q) return { arm, side: null, p_up: pUp, reason: "missing" };
  if (q.ask < ASK_FLOOR || q.ask > ASK_CEIL || q.spread > SPREAD_MAX) {
    return { arm, side: null, p_up: pUp, reason: "sit" };
  }
  const pSide = side === "UP" ? pUp : 1 - pUp;
  const fee = takerFeeAt(q.ask);
  const edge = pSide * 100 - q.ask - fee;
  if (!(edge >= EDGE_MIN_CENTS)) return { arm, side: null, p_up: pUp, reason: "sit" };
  return { arm, side, p_up: pUp, reason: "take" };
}

function emptyCell(arm: NullHorizonArm, seconds: number): ArmCell {
  return {
    arm,
    seconds,
    eligible: 0,
    taken: 0,
    hits: 0,
    hit_rate: null,
    brier: null,
    market_brier: null,
    hit_minus_market: null,
    net_cents: 0,
    net_extra_cost_cents: 0,
    max_dd_cents: 0,
    missing: 0,
  };
}

type LiveCell = ArmCell & { _briers: number[]; _mbriers: number[]; _hmm: number[] };

function gradeTake(
  cell: LiveCell,
  side: "UP" | "DOWN",
  pUp: number,
  winner: "UP" | "DOWN",
  ask: number,
  mid: number,
  extraCost: number,
  path: { equity: number; peak: number },
): void {
  const fee = takerFeeAt(ask);
  const hit = side === winner ? 1 : 0;
  const pnl = hit ? 100 - ask - fee : -(ask + fee);
  const pnlX = hit ? 100 - ask - fee - extraCost : -(ask + fee + extraCost);
  const y = winner === "UP" ? 1 : 0;
  const mkt = Math.min(0.99, Math.max(0.01, mid / 100));
  cell.taken += 1;
  cell.hits += hit;
  cell.net_cents += pnl;
  cell.net_extra_cost_cents += pnlX;
  path.equity += pnl;
  if (path.equity > path.peak) path.peak = path.equity;
  const dd = path.equity - path.peak;
  if (dd < cell.max_dd_cents) cell.max_dd_cents = dd;
  cell._briers.push((pUp - y) ** 2);
  cell._mbriers.push((mkt - y) ** 2);
  cell._hmm.push(hit - (side === "UP" ? mkt : 1 - mkt));
}

/** Walk-forward four-arm report. Rows may arrive newest-first; they are sorted. */
export function buildNullHorizonReport(
  rowsIn: readonly NullHorizonReplayRow[],
): NullHorizonReport {
  const rows = [...rowsIn]
    .filter((r) => r.winner === "UP" || r.winner === "DOWN")
    .sort((a, b) => closeMs(a.close_time) - closeMs(b.close_time))
    .slice(-WINDOW_CAP);

  const arms: NullHorizonArm[] = ["NULL", "HEARD", "RAW", "HORIZON"];
  const cells = new Map<string, LiveCell>();
  const paths = new Map<string, { equity: number; peak: number }>();
  const sampled = new Map(HORIZON_DEFS.map((h) => [h.seconds, 0]));
  const books = new Map<string, SeatBook>();

  const cellOf = (arm: NullHorizonArm, seconds: number) => {
    const k = `${arm}:${seconds}`;
    let c = cells.get(k);
    if (!c) {
      c = { ...emptyCell(arm, seconds), _briers: [], _mbriers: [], _hmm: [] };
      cells.set(k, c);
      paths.set(k, { equity: 0, peak: 0 });
    }
    return c;
  };

  let windows = 0;
  for (const row of rows) {
    const t0 = Number(row.cols?.t0);
    const t = row.cols?.t;
    if (!Number.isFinite(t0) || !Array.isArray(t) || !row.cols?.seats) continue;
    windows += 1;
    const winnerSign = row.winner === "UP" ? 1 : -1;
    // Seat records learned from this window are applied only after every
    // horizon in it has been decided, so a later horizon never sees this
    // window's own outcome through an earlier horizon's read.
    const learned: { key: string; hit: number }[] = [];

    for (const h of HORIZON_DEFS) {
      const index = frameIndex(row, h.seconds);
      if (index == null) continue;
      sampled.set(h.seconds, (sampled.get(h.seconds) ?? 0) + 1);

      for (const arm of arms) {
        const cell = cellOf(arm, h.seconds);
        cell.eligible += 1;
        const d = decide(arm, row, index, h.seconds, books);
        if (d.reason === "missing") cell.missing += 1;
        if (d.reason === "take" && d.side && d.p_up != null) {
          const q = quoteAt(row, index, d.side);
          if (q) {
            gradeTake(
              cell,
              d.side,
              d.p_up,
              row.winner,
              q.ask,
              q.mid,
              EXTRA_COST_CENTS,
              paths.get(`${arm}:${h.seconds}`)!,
            );
          } else {
            cell.missing += 1;
          }
        }
      }

      for (const [seat, values] of Object.entries(row.cols.seats)) {
        const code = Number(values[index]);
        if (code !== 2 && code !== 1 && code !== -1 && code !== -2) continue;
        const hit = Math.sign(code) === winnerSign ? 1 : 0;
        learned.push({ key: bookKey(seat, "all"), hit }, { key: bookKey(seat, h.seconds), hit });
      }
    }

    for (const { key, hit } of learned) {
      const book = books.get(key) ?? { n: 0, hits: 0 };
      book.n += 1;
      book.hits += hit;
      books.set(key, book);
    }
  }

  const finished: ArmCell[] = [];
  for (const h of HORIZON_DEFS) {
    for (const arm of arms) {
      const raw = cellOf(arm, h.seconds);
      finished.push({
        arm,
        seconds: h.seconds,
        eligible: raw.eligible,
        taken: raw.taken,
        hits: raw.hits,
        hit_rate: rate(raw.hits, raw.taken),
        brier: mean(raw._briers),
        market_brier: mean(raw._mbriers),
        hit_minus_market: mean(raw._hmm),
        net_cents: Math.round(raw.net_cents * 10) / 10,
        net_extra_cost_cents: Math.round(raw.net_extra_cost_cents * 10) / 10,
        max_dd_cents: Math.round(raw.max_dd_cents * 10) / 10,
        missing: raw.missing,
      });
    }
  }

  const at = (arm: NullHorizonArm, seconds: number) =>
    finished.find((c) => c.arm === arm && c.seconds === seconds);

  const h450 = at("HORIZON", 450);
  const n450 = at("NULL", 450);
  const h180 = at("HORIZON", 180);
  const n180 = at("NULL", 180);
  const brier450 =
    h450?.brier != null && n450?.brier != null ? h450.brier < n450.brier : null;
  const net450 =
    h450 != null && n450 != null ? h450.net_cents > n450.net_cents : null;
  const brier180 =
    h180?.brier != null && n180?.brier != null ? h180.brier < n180.brier : null;
  const net180 =
    h180 != null && n180 != null ? h180.net_cents > n180.net_cents : null;
  const cleared = brier450 === true && net450 === true && brier180 === true && net180 === true;

  return {
    study: NULL_HORIZON_STUDY,
    authority: NULL_HORIZON_AUTHORITY,
    windows,
    horizons: HORIZON_DEFS.map((h) => ({
      ...h,
      sampled_windows: sampled.get(h.seconds) ?? 0,
    })),
    cells: finished,
    gate: {
      horizon_beats_null_brier_450: brier450,
      horizon_beats_null_net_450: net450,
      horizon_beats_null_brier_180: brier180,
      horizon_beats_null_net_180: net180,
      cleared,
      note: cleared
        ? "HORIZON beat NULL on Brier and net at 7:30 and 3:00. That is evidence, not promotion."
        : "Gate not cleared. SATOSHI stays frozen. Log entry-time pairs until it can.",
    },
  };
}

export function renderNullHorizonTable(report: NullHorizonReport): string {
  const lines = [
    `${report.study}  authority=${report.authority}  windows=${report.windows}`,
    report.gate.note,
    "",
    "arm      hz   elig  take  hit    brier   mktB   hit-mkt   net¢   extra¢    dd¢  miss",
  ];
  for (const c of report.cells) {
    const hz = String(c.seconds).padStart(3);
    const fmt = (n: number | null, d = 3) =>
      n == null ? "   —  " : n.toFixed(d).padStart(6);
    lines.push(
      `${c.arm.padEnd(8)} ${hz}  ${String(c.eligible).padStart(4)}  ${String(c.taken).padStart(4)}  ${fmt(c.hit_rate)} ${fmt(c.brier)} ${fmt(c.market_brier)} ${fmt(c.hit_minus_market)}  ${String(c.net_cents).padStart(6)}  ${String(c.net_extra_cost_cents).padStart(6)}  ${String(c.max_dd_cents).padStart(5)}  ${String(c.missing).padStart(4)}`,
    );
  }
  return lines.join("\n");
}
