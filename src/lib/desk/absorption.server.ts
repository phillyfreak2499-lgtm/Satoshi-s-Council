/**
 * The absorption study: writing the prints down, and reading them back.
 *
 * WRITING. When a window ends, every print the lab held for it is measured
 * against the midpoint path it actually produced and written once. Nothing is
 * classified at write time — no "large", no "absorbed" — because a threshold
 * baked into the recorder cannot be revisited without collecting the data
 * again, and a threshold chosen after seeing outcomes is not a threshold at all.
 * Continuous measurements go in; the bands are applied on read.
 *
 * The row carries its ERA. The quantity fix of 2026-09-11 03:47:17Z split this
 * data into two sets that must never be added together — before it, every size
 * and depth was floating-point residue. Storing the era on the row means a
 * query cannot pool them by forgetting a date filter.
 *
 * READING. The study reports only post-fix rows, states how many earlier ones it
 * discarded, and answers the falsification questions rather than a verdict.
 *
 * Read-only on everything except its own table. Nothing votes on any of it.
 */
import { getSql } from "@/lib/db";
import {
  absorptionReport,
  control,
  zOf,
  type AbsorptionReport,
  type AbsorptionRow,
} from "./absorption.ts";
import { eraAt, PRINT_CTX_FIX_AT, printCtxUsable, QTY_FIX_AT, splitByEra } from "./research-era.ts";

const TTL_MS = 300_000;

export type AbsorptionStudy = AbsorptionReport & {
  era_boundary: string;
  /** Prints before this carried context stamped at settle rather than at the print. */
  ctx_boundary: string;
  /** How many otherwise-clean prints that boundary excluded. */
  dropped_stale_context: number;
  at: string;
  authority: { votes: false; thresholds_in_production: false; note: string };
};

let cache: { at: number; study: AbsorptionStudy } | null = null;

/** One print, as the lab hands it over at the end of a window. */
export type PrintRecord = {
  ticker: string;
  close_time: number;
  t: number;
  side: "UP" | "DOWN";
  cluster_n: number;
  size: number;
  size_pctile: number | null;
  size_vs_touch: number | null;
  size_vs_depth: number | null;
  impact_2s: number | null;
  impact_per_100: number | null;
  move_5s: number | null;
  move_15s: number | null;
  move_30s: number | null;
  move_60s: number | null;
  btc_5s: number | null;
  btc_15s: number | null;
  btc_30s: number | null;
  btc_60s: number | null;
  ofi_norm: number | null;
  replenished: boolean | null;
  spread: number | null;
  depth: number | null;
  dist: number | null;
  sigma: number | null;
  secs_left: number | null;
  market_prob_up: number;
  regime: string;
  fair_yes: number | null;
  vel_resid: number | null;
  drift_ev: number | null;
  cascade_ev: number | null;
  seat_age_ms: number | null;
};

/**
 * Write a window's prints, already graded. Called once at settle; a window that
 * is recorded twice is ignored rather than double-counted, because a duplicated
 * observation is worse than a missing one — it inflates n without adding
 * evidence.
 */
export async function recordPrints(rows: readonly PrintRecord[], winner: "UP" | "DOWN"): Promise<number> {
  if (!rows.length) return 0;
  const db = await getSql();
  const ticker = rows[0]!.ticker;
  const [seen] = await db<{ n: number }>`
    select count(*)::int as n from desk_absorption where ticker = ${ticker}
  `;
  if ((seen?.n ?? 0) > 0) return 0;
  let wrote = 0;
  for (const r of rows) {
    await db`
      insert into desk_absorption (
        ticker, close_time, t, era, side, cluster_n, size, size_pctile, size_vs_touch, size_vs_depth,
        impact_2s, impact_per_100, move_5s, move_15s, move_30s, move_60s,
        btc_5s, btc_15s, btc_30s, btc_60s,
        ofi_norm, replenished, spread, depth, dist, sigma, secs_left, market_prob_up, regime,
        fair_yes, vel_resid, drift_ev, cascade_ev, seat_age_ms, winner, graded_at
      ) values (
        ${r.ticker}, ${new Date(r.close_time).toISOString()}, ${new Date(r.t).toISOString()}, ${eraAt(r.t)},
        ${r.side}, ${r.cluster_n}, ${r.size}, ${r.size_pctile}, ${r.size_vs_touch}, ${r.size_vs_depth},
        ${r.impact_2s}, ${r.impact_per_100}, ${r.move_5s}, ${r.move_15s}, ${r.move_30s}, ${r.move_60s},
        ${r.btc_5s}, ${r.btc_15s}, ${r.btc_30s}, ${r.btc_60s},
        ${r.ofi_norm}, ${r.replenished}, ${r.spread}, ${r.depth}, ${r.dist}, ${r.sigma}, ${r.secs_left},
        ${r.market_prob_up}, ${r.regime},
        ${r.fair_yes}, ${r.vel_resid}, ${r.drift_ev}, ${r.cascade_ev}, ${r.seat_age_ms}, ${winner}, now()
      )
    `;
    wrote += 1;
  }
  return wrote;
}

type DbRow = Record<string, unknown>;

const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function toRow(r: DbRow): AbsorptionRow {
  const t = Date.parse(String(r.t));
  return {
    t,
    // Read from the column, not recomputed: the row was classified when it was
    // written and that is the record.
    era: r.era === "post-qty-fix" ? "post-qty-fix" : "pre-qty-fix",
    side: r.side === "DOWN" ? "DOWN" : "UP",
    cluster_n: Number(r.cluster_n) || 1,
    size: Number(r.size) || 0,
    size_pctile: num(r.size_pctile),
    size_vs_touch: num(r.size_vs_touch),
    size_vs_depth: num(r.size_vs_depth),
    impact_2s: num(r.impact_2s),
    impact_per_100: num(r.impact_per_100),
    move_5s: num(r.move_5s),
    move_15s: num(r.move_15s),
    move_30s: num(r.move_30s),
    move_60s: num(r.move_60s),
    btc_5s: num(r.btc_5s),
    btc_15s: num(r.btc_15s),
    btc_30s: num(r.btc_30s),
    btc_60s: num(r.btc_60s),
    ofi_norm: num(r.ofi_norm),
    replenished: r.replenished == null ? null : Boolean(r.replenished),
    spread: num(r.spread),
    depth: num(r.depth),
    dist: num(r.dist),
    sigma: num(r.sigma),
    secs_left: num(r.secs_left),
    market_prob_up: Number(r.market_prob_up) || 0,
    fair_yes: num(r.fair_yes),
    vel_resid: num(r.vel_resid),
    drift_ev: num(r.drift_ev),
    cascade_ev: num(r.cascade_ev),
    regime: String(r.regime ?? ""),
    winner: r.winner === "UP" || r.winner === "DOWN" ? r.winner : null,
  };
}

/** A signed evidence value as a band. Silence is its own band, not a middle. */
const evBand = (v: number | null, name: string): string | null =>
  v == null ? null : v === 0 ? `${name} quiet` : v > 0 ? `${name} UP` : `${name} DOWN`;

export async function absorptionStudy(): Promise<AbsorptionStudy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.study;
  const db = await getSql();
  const raw = await db<DbRow>`select * from desk_absorption order by t`;
  const rows = raw.map(toRow);
  const split = splitByEra(rows, (r) => r.t);
  // Two boundaries, both of which a row has to clear. The quantity fix decides
  // whether its SIZES mean anything; the context fix decides whether the state
  // around it was stamped at the print or at settle. A row can pass the first
  // and fail the second, so both are applied and both counted.
  const post = split.post.filter((r) => printCtxUsable(r.t));
  const ctxDropped = split.post.length - post.length;

  // Every control the owner named. Each asks: is the effect still there inside
  // bands of this, or is the effect just this variable wearing a different hat?
  const controls = [
    control("market probability", post, (r) =>
      r.market_prob_up < 35 ? "under 35" : r.market_prob_up < 65 ? "35-65" : "over 65",
    ),
    control("regime", post, (r) => r.regime || null),
    control("distance to strike", post, (r) => {
      const z = zOf(r);
      return z == null ? null : Math.abs(z) < 0.5 ? "inside 0.5σ" : Math.abs(z) < 1.5 ? "0.5-1.5σ" : "beyond 1.5σ";
    }),
    control("seconds remaining", post, (r) =>
      r.secs_left == null ? null : r.secs_left < 120 ? "under 2m" : r.secs_left < 420 ? "2-7m" : "over 7m",
    ),
    control("STRIKE 2.0 fair", post, (r) =>
      r.fair_yes == null ? null : r.fair_yes < 35 ? "fair under 35" : r.fair_yes < 65 ? "fair 35-65" : "fair over 65",
    ),
    control("VEL 2.0 residual", post, (r) =>
      r.vel_resid == null ? null : Math.abs(r.vel_resid) < 1 ? "resid flat" : r.vel_resid > 0 ? "resid UP" : "resid DOWN",
    ),
    control("TAPE 2.0 OFI", post, (r) =>
      r.ofi_norm == null ? null : Math.abs(r.ofi_norm) < 0.05 ? "OFI flat" : r.ofi_norm > 0 ? "OFI UP" : "OFI DOWN",
    ),
    control("DRIFT", post, (r) => evBand(r.drift_ev, "DRIFT")),
    control("CASCADE", post, (r) => evBand(r.cascade_ev, "CASCADE")),
    // Size against what was visible is the mechanical explanation for a
    // non-response: an order small against the book should not move it.
    control("size against depth", post, (r) =>
      r.size_vs_depth == null ? null : r.size_vs_depth < 0.1 ? "under 10% of depth" : r.size_vs_depth < 0.5 ? "10-50%" : "over 50%",
    ),
  ];

  const study: AbsorptionStudy = {
    ...absorptionReport(post, split.pre.length + ctxDropped, controls),
    era_boundary: QTY_FIX_AT,
    ctx_boundary: PRINT_CTX_FIX_AT,
    dropped_stale_context: ctxDropped,
    at: new Date().toISOString(),
    authority: {
      votes: false,
      thresholds_in_production: false,
      note:
        "The question is whether the outcome happens more or less often than Kalshi's price implied, on the " +
        "windows where aggressive size crossed and the price did not respond. It is not a hit rate and it is " +
        "not a signal. Bands are frozen and reported as a grid so no single setting is privileged; BUY and " +
        "SELL and single and clustered are never pooled; and the falsification block asks every way this " +
        "could be nothing before it asks whether it is something. Two boundaries apply: a print's sizes are " +
        "only meaningful after the quantity fix, and its surrounding state only after the context fix. Rows " +
        "failing either are left in the table and left out of every number here.",
    },
  };
  cache = { at: Date.now(), study };
  return study;
}
