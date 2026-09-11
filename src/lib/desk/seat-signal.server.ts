/**
 * The seat-signal study's data (server only). Read-only on desk_samples.
 *
 * WHY desk_samples AND NOT desk_ledger. The ledger stores each seat's vote at
 * the GRADE frame, at the close. The price this study compares against has to be
 * the price at the same instant the seat spoke, or the comparison is between two
 * different moments and means nothing. desk_samples holds exactly that pair:
 * every seat's evidence and the market's midpoint, both recorded at the
 * mid-window decision point, on one row per window.
 *
 * The cost of that choice is stated rather than hidden: every window is sampled
 * at roughly the same point in its life, so this says nothing about a seat that
 * is early or late rather than wrong.
 *
 * Nothing here reweights, gags or promotes a seat.
 */
import { getSql } from "@/lib/db";
import { signalReport, type SignalReport, type SignalRow } from "./seat-signal.ts";
import { isCountable } from "./research-quality.ts";

const TTL_MS = 300_000;

export type SignalStudy = SignalReport & {
  windows: number;
  since: string | null;
  until: string | null;
  /** The one instant each window is measured at, in minutes before the close. */
  measured_at_mins: number | null;
  at: string;
  authority: { votes: false; reweights_nothing: true; note: string };
};

let cache: { at: number; study: SignalStudy } | null = null;

type Row = {
  close_time: string;
  mins_left: number | null;
  winner: string | null;
  features: Record<string, unknown> | null;
  market: { yes_mid?: number } | null;
};

/** Not seats: the stacker's own two inputs, stored in the same object. */
const NOT_SEATS = new Set(["fair", "market"]);

export async function signalStudy(): Promise<SignalStudy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.study;
  const db = await getSql();
  const raw = await db<Row>`
    select close_time, mins_left, winner, features, market
    from desk_samples
    where winner in ('UP','DOWN') and features is not null
    order by close_time
  `;
  const bySeat = new Map<string, SignalRow[]>();
  let windows = 0;
  let minsSum = 0;
  let minsN = 0;
  for (const r of raw) {
    const winner = r.winner === "UP" || r.winner === "DOWN" ? r.winner : null;
    const mid = Number(r.market?.yes_mid);
    if (!winner || !Number.isFinite(mid)) continue;
    // desk_samples carries no quality column, so the registry is applied here on
    // the window's close time. Without this the known-invalid block reaches every
    // seat's objection record through the sample table instead of the ledger.
    if (!isCountable(r.close_time)) continue;
    windows += 1;
    const m = Number(r.mins_left);
    if (Number.isFinite(m)) {
      minsSum += m;
      minsN += 1;
    }
    for (const [id, v] of Object.entries(r.features ?? {})) {
      if (NOT_SEATS.has(id)) continue;
      const ev = Number(v);
      if (!Number.isFinite(ev)) continue;
      // Evidence is signed: positive leans UP, negative DOWN, zero is silence.
      // Zero is silence and NOT a vote for the price — folding it in as agreement
      // would credit every quiet seat with the market's accuracy.
      const lean = ev > 0 ? "UP" : ev < 0 ? "DOWN" : null;
      const arr = bySeat.get(id) ?? [];
      arr.push({ lean, mid, winner });
      bySeat.set(id, arr);
    }
  }

  const study: SignalStudy = {
    ...signalReport(bySeat),
    windows,
    since: raw.length ? new Date(raw[0]!.close_time).toISOString() : null,
    until: raw.length ? new Date(raw[raw.length - 1]!.close_time).toISOString() : null,
    measured_at_mins: minsN ? Math.round((minsSum / minsN) * 100) / 100 : null,
    at: new Date().toISOString(),
    authority: {
      votes: false,
      reweights_nothing: true,
      note:
        "A seat's hit rate is not its skill — the price is right about four times in five and a seat that " +
        "agrees with it inherits that. The test is whether the price is worth less than it claims on the " +
        "windows the seat objects. Every figure is in-sample and measured at one instant per window; a seat " +
        "earns a weight by being run in SHADOW and confirmed on windows recorded afterwards, never from this.",
    },
  };
  cache = { at: Date.now(), study };
  return study;
}
