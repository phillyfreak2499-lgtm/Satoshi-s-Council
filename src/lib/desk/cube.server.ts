/**
 * The performance cube's data (server only). Read-only on desk_ledger.
 *
 * Two vintages of column live in that table and the difference matters. The
 * older ones — side, entry, ev, confidence, score, bar — exist on every graded
 * window back to the first. The decision-state columns added on 2026-09-11
 * (regime, seconds left, spread, leftover, touch size, fee, fair value at entry)
 * exist only on windows graded since. Cutting by those today means cutting a
 * handful of rows.
 *
 * The cube does not paper over that. A dimension whose column is barely
 * populated is not shown as a near-empty cut that invites reading three windows
 * as a pattern; it is listed by name under `not_yet` with its actual count and
 * the date it started filling. It appears as a real dimension the moment there
 * is something to cut, and not before.
 *
 * ERAS ARE NOT POOLED. The rows are split before anything is cut: the current
 * book (one contract, held to settlement) is what every dimension below is
 * measured on, and the retired book (multi-leg, exited at a mid price, the rule
 * until 2026-09-06) is reported once on its own. Those 24 retired calls carry
 * nearly all of the all-time loss, so pooling them does not merely add noise —
 * it drags every cut of the current desk downward by a fixed amount and makes
 * the pooled answer wrong in a consistent direction.
 *
 * Read-only, non-voting. Nothing here decides, grades, promotes or tunes.
 */
import { getSql } from "@/lib/db";
import { CHAIR_FLOOR_SINCE_ISO, FLOOR_LIVE_CENTS, FLOOR_LIVE_SINCE, FLOOR_SHADOW_CENTS } from "./book-floor";
import { chairDecisionOf } from "./booked-side";
import {
  buildCube,
  confBand,
  cubeDim,
  marginBand,
  minsBand,
  priceBand,
  spreadBand,
  touchBand,
  type Cube,
  type CubeDim,
  type CubeRow,
} from "./cube.ts";
import { sessionOf } from "./math";

const TTL_MS = 120_000;
/** A decision-state cut needs at least this many graded windows before it is drawn. */
const MIN_DIM_ROWS = 25;

let cache: { at: number; cube: CubeStudy } | null = null;

export type CubeStudy = Cube & {
  since: string | null;
  until: string | null;
  /** What every number above `retired_era` is measured on. */
  era: string;
  at: string;
  /** Restated in the payload so a reader of the raw JSON cannot miss it. */
  authority: { votes: false; tunes_nothing: true; note: string };
};

type LedgerRow = {
  close_time: string;
  winner: string | null;
  chair_lean: string | null;
  chair_conf: number | null;
  score: number | null;
  bar: number | null;
  entry_cents: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  calls: number | null;
  entry_regime: string | null;
  entry_secs_left: number | null;
  entry_conf: number | null;
  entry_score: number | null;
  entry_bar: number | null;
  entry_fair_yes: number | null;
  entry_spread_cents: number | null;
  entry_leftover_cents: number | null;
  entry_touch_size: number | null;
  entry_fee_cents: number | null;
  seats: Record<string, { lean?: string; conf?: number; hit?: boolean | null }> | null;
};

const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Which floor era a window closed in. Eras are facts about the rules, not cuts of the data. */
function eraOf(closeMs: number): string {
  if (closeMs >= Date.parse(FLOOR_LIVE_SINCE)) return `${FLOOR_LIVE_CENTS}¢ trial`;
  if (closeMs >= Date.parse(CHAIR_FLOOR_SINCE_ISO)) return `${FLOOR_SHADOW_CENTS}¢ era`;
  return "no floor";
}

/** How many voting seats agreed with the side the book took. */
function agreement(r: CubeRow): string | null {
  if (!r.side) return null;
  const spoke = Object.values(r.seats).filter((s) => s.lean === "UP" || s.lean === "DOWN");
  if (!spoke.length) return null;
  const withIt = spoke.filter((s) => s.lean === r.side).length;
  if (withIt <= 1) return "1 seat";
  if (withIt <= 2) return "2 seats";
  if (withIt <= 4) return "3-4 seats";
  return "5+ seats";
}

export async function cubeStudy(): Promise<CubeStudy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cube;
  const db = await getSql();
  const raw = await db<LedgerRow>`
    select close_time, winner, chair_lean, chair_conf, score, bar,
           entry_cents, settle_cents, ev_cents, calls,
           entry_regime, entry_secs_left, entry_conf, entry_score, entry_bar,
           entry_fair_yes, entry_spread_cents, entry_leftover_cents, entry_touch_size, entry_fee_cents,
           seats
    from desk_ledger
    where winner in ('UP','DOWN')
    order by close_time
  `;

  const all: CubeRow[] = raw.map((r) => {
    const t = Date.parse(r.close_time);
    const winner = r.winner === "UP" || r.winner === "DOWN" ? r.winner : null;
    // The side the book BOOKED, not a lean that may have decayed to WAIT by the
    // time the window graded. Reading chair_lean here is the bug that once made
    // the scorecard disagree with the totals beside it.
    const settle = num(r.settle_cents);
    const legs = Math.max(1, Number(r.calls) || 1);
    // bookedSideOf recovers the side from a BINARY settlement: 100 means the side
    // it held won, 0 means it lost. The early scalp rows (multi-leg, exited at a
    // mid price) do not satisfy that premise, and running the >= 50 rule on them
    // would label a side out of a number that carries no such information. Those
    // rows keep their cents and lose their side.
    const settled = (settle === 0 || settle === 100) && legs === 1;
    const decided = settled ? chairDecisionOf(r.chair_lean, settle, winner) : "WAIT";
    const entry = num(r.entry_cents);
    return {
      close_time: t,
      legs,
      settled,
      side: entry != null && (decided === "UP" || decided === "DOWN") ? decided : null,
      winner,
      entry,
      ev: num(r.ev_cents),
      // Decision-time values where they exist, the graded ones otherwise; both
      // are the chair's own numbers, and the newer pair is the more faithful.
      conf: num(r.entry_conf) ?? num(r.chair_conf),
      score: num(r.entry_score) ?? num(r.score),
      bar: num(r.entry_bar) ?? num(r.bar),
      regime: r.entry_regime || null,
      secs_left: num(r.entry_secs_left),
      fair_yes: num(r.entry_fair_yes),
      spread: num(r.entry_spread_cents),
      leftover: num(r.entry_leftover_cents),
      touch: num(r.entry_touch_size),
      fee: num(r.entry_fee_cents),
      seats: Object.fromEntries(
        Object.entries(r.seats ?? {}).map(([k, v]) => [
          k,
          { lean: String(v?.lean ?? "WAIT"), conf: Number(v?.conf ?? 0), hit: v?.hit ?? null },
        ]),
      ),
    };
  });

  // The split, before any cut. A fill that ended anywhere other than 0 or 100
  // did not settle, whatever its leg count, so that — not the leg count — is the
  // line. Unfilled windows belong to the current book: the chair was reading
  // them under today's rules and declining to pay.
  const retired = all.filter((r) => r.entry != null && !r.settled);
  const rows = all.filter((r) => r.entry == null || r.settled);

  const dims: CubeDim[] = [
    cubeDim("side", rows, (r) => r.side),
    cubeDim("price paid", rows, (r) => priceBand(r.entry)),
    // Floor eras live INSIDE the current book: 70¢ then 80¢, same mechanics.
    cubeDim("floor era", rows, (r) => eraOf(r.close_time)),
    cubeDim("confidence", rows, (r) => confBand(r.conf)),
    cubeDim("margin over bar", rows, (r) => marginBand(r.score, r.bar)),
    cubeDim("session", rows, (r) => sessionOf(r.close_time)),
    cubeDim("weekday", rows, (r) => WEEKDAY[new Date(r.close_time).getUTCDay()]!),
    cubeDim("seats agreeing", rows, agreement),
  ];

  // Decision-state cuts join the cube only once they have rows behind them.
  const notYet: { name: string; why: string }[] = [];
  const maybe: { name: string; key: (r: CubeRow) => string | null; has: (r: CubeRow) => boolean }[] = [
    { name: "regime at entry", key: (r) => r.regime, has: (r) => r.regime != null },
    { name: "time left at entry", key: (r) => minsBand(r.secs_left), has: (r) => r.secs_left != null },
    { name: "spread at entry", key: (r) => spreadBand(r.spread), has: (r) => r.spread != null },
    { name: "touch size at entry", key: (r) => touchBand(r.touch), has: (r) => r.touch != null },
  ];
  for (const m of maybe) {
    const have = rows.filter(m.has).length;
    if (have >= MIN_DIM_ROWS) dims.push(cubeDim(m.name, rows, m.key));
    else {
      notYet.push({
        name: m.name,
        why:
          `stored from ${FLOOR_LIVE_SINCE.slice(0, 10)}; ${have} graded window${have === 1 ? "" : "s"} carry it, ` +
          `and this cut is drawn at ${MIN_DIM_ROWS}. Cutting ${have} rows would invite reading noise as a pattern.`,
      });
    }
  }

  // Per-seat: how each seat did on the windows where it actually spoke a side.
  const seatIds = [...new Set(rows.flatMap((r) => Object.keys(r.seats)))].sort();
  for (const id of seatIds) {
    const spoke = rows.filter((r) => {
      const v = r.seats[id];
      return v && (v.lean === "UP" || v.lean === "DOWN");
    });
    if (spoke.length < MIN_DIM_ROWS) continue;
    dims.push(
      cubeDim(`seat ${id}`, spoke, (r) => (r.seats[id]!.lean === r.side ? "agreed with the book" : "disagreed")),
    );
  }

  const base = buildCube(rows, dims, notYet, retired);
  const study: CubeStudy = {
    ...base,
    since: rows.length ? new Date(rows[0]!.close_time).toISOString() : null,
    until: rows.length ? new Date(rows[rows.length - 1]!.close_time).toISOString() : null,
    era: "one contract, held to settlement",
    at: new Date().toISOString(),
    authority: {
      votes: false,
      tunes_nothing: true,
      note:
        "A way of looking at the ledger, not evidence. Read look_elsewhere before any cell: it says how many " +
        "chances the data was given to look good. A cell worth acting on has to survive on windows recorded " +
        "AFTER it was noticed, which is the one test this table cannot run on itself. Every cut above covers " +
        "the CURRENT book only; the retired early-exit era is in retired_era and is never pooled with it.",
    },
  };
  cache = { at: Date.now(), cube: study };
  return study;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
