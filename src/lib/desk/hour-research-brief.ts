/**
 * Hour Research v1 — the public read model. Pure. Authority: NONE.
 *
 * Shapes what the /hour page shows: the hour in progress, the strike ladder as
 * the model reads it, the evidence behind that read, the checkpoints already
 * frozen, and the graded shadow record with its calibration against the market.
 *
 * Every number here is derived from stored rows or from a frozen snapshot. An
 * unavailable feed is `null` and prints as "—"; it is never a zero dressed as
 * evidence. Nothing in this module can book, promote or change anything, and
 * the 15-minute Chair's verdict is not an input to any of it.
 */
import {
  HOUR_CHECKPOINTS,
  HOUR_MODEL,
  HOUR_RESEARCH_AUTHORITY,
  HOUR_RESEARCH_VERSION,
  brier,
  shadowScore,
  type HourCandidate,
  type HourDataQuality,
  type HourFeatures,
  type HourRead,
  type HourRungRead,
  type HourShadowRow,
  type HourShadowScore,
  type HourSide,
  type HourWaitReason,
} from "./hour-research.ts";
import { HOUR_POSTURE, clockET } from "./hour.ts";

/** Printed beside every model number on the page. The words never soften. */
export const HOUR_SHADOW_LABEL = "SHADOW READ — NOT A LIVE HOURLY RULE";
export const HOUR_RESEARCH_COPY = Object.freeze({
  shadow: HOUR_SHADOW_LABEL,
  purpose:
    "The model estimates the chance the official settlement value finishes at or above each strike, then compares that to the price actually quoted. It books nothing.",
  sides: "Sides on this ladder are YES, NO and WAIT. UP and DOWN belong to the 15-minute contract and are not used here.",
  separate:
    "This research is scored on its own. It never feeds the 15-minute Chair, the Council seats, the learner or the 15-minute paper book.",
  empty:
    "No hourly window has settled and been graded yet, so there is no shadow record to print. That is not a zero record.",
  gates:
    "Promotion needs hundreds of settled hourly windows, walk-forward evidence, calibration that beats the market, after-fee economics and a human decision. None of that has happened.",
});

// ---------------------------------------------------------------------------
// The ladder, as the page draws it
// ---------------------------------------------------------------------------

export type HourLadderRow = {
  ticker: string;
  strike: number;
  /** Model P(settlement >= strike). */
  p_model: number;
  /** Market-implied P(settlement >= strike), or null when the rung is one-sided. */
  p_market: number | null;
  uncertainty: number;
  dollars_to_strike: number;
  yes_ask: number | null;
  no_ask: number | null;
  edge_yes: number | null;
  edge_no: number | null;
  best_side: HourSide | null;
  best_edge: number | null;
  /** True on the rung the model would take at this instant. */
  selected: boolean;
  /** True on the rung nearest expected settlement — the visual anchor. */
  anchor: boolean;
};

/**
 * The band of rungs worth drawing, centred on expected settlement, with the
 * model's choice always kept even when it falls outside the band.
 */
export function ladderView(read: HourRead, limit = 15): HourLadderRow[] {
  const expected = read.expected_settlement;
  const selected = read.candidate?.ticker ?? null;
  const rows = read.rungs;
  if (!rows.length) return [];
  let band: HourRungRead[] = [...rows];
  if (expected != null && rows.length > limit) {
    const near = [...rows].sort((a, b) => Math.abs(a.strike - expected) - Math.abs(b.strike - expected)).slice(0, limit);
    const picked = selected ? rows.find((r) => r.ticker === selected) : undefined;
    if (picked && !near.some((r) => r.ticker === picked.ticker)) near[near.length - 1] = picked;
    band = near.sort((a, b) => a.strike - b.strike);
  }
  let anchorTicker: string | null = null;
  if (expected != null) {
    anchorTicker = band.reduce((best, r) => (Math.abs(r.strike - expected) < Math.abs(best.strike - expected) ? r : best)).ticker;
  }
  // Drawn high strike first, the way a ladder reads.
  return [...band]
    .sort((a, b) => b.strike - a.strike)
    .map((r) => ({
      ticker: r.ticker,
      strike: r.strike,
      p_model: r.p_yes,
      p_market: r.market_p_yes,
      uncertainty: r.uncertainty,
      dollars_to_strike: r.dollars_to_strike,
      yes_ask: r.yes_ask,
      no_ask: r.no_ask,
      edge_yes: r.edge_yes,
      edge_no: r.edge_no,
      best_side: r.best_side,
      best_edge: r.best_edge,
      selected: r.ticker === selected,
      anchor: r.ticker === anchorTicker,
    }));
}

// ---------------------------------------------------------------------------
// The evidence board — one card per family, each saying what it could not see
// ---------------------------------------------------------------------------

export type HourEvidenceCard = {
  family: string;
  value: string;
  detail: string;
  /** False when the family's feed was missing or stale, so the page can say so. */
  ok: boolean;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct1 = (n: number) => `${(n * 100).toFixed(2)}%`;
const dash = "—";

/** The six evidence families, read off the frozen snapshot only. */
export function evidenceBoard(
  f: HourFeatures,
  quality: HourDataQuality,
  expected: number | null,
  expectedSource: string,
  sigmaHorizon: number | null,
  secsLeft: number,
  anchorStrike: number | null,
): HourEvidenceCard[] {
  const trendParts = [
    f.ret5 == null ? null : `5m ${pct1(f.ret5)}`,
    f.ret15 == null ? null : `15m ${pct1(f.ret15)}`,
    f.ret60 == null ? null : `1h ${pct1(f.ret60)}`,
    f.ret24h == null ? null : `24h ${pct1(f.ret24h)}`,
  ].filter((s): s is string => s != null);
  const agree =
    f.ret15 != null && f.ret60 != null && f.ret15 !== 0 && f.ret60 !== 0 && Math.sign(f.ret15) === Math.sign(f.ret60);
  const move = sigmaHorizon != null && expected != null ? expected * sigmaHorizon : null;
  const gap = expected != null && anchorStrike != null ? expected - anchorStrike : null;

  return [
    {
      family: "Settlement index",
      value: expected == null ? dash : usd(expected),
      detail:
        expected == null
          ? "No CF Benchmarks settlement value could be read and dated, so there is no expected settlement value. An exchange print and a perpetual index are different quantities and are never substituted for it."
          : `Source: ${expectedSource}. This is the value the contract settles on, not an exchange print and not a perpetual index.${
              f.brti_spot_basis == null
                ? ""
                : ` It sits ${usd(Math.abs(f.brti_spot_basis))} ${f.brti_spot_basis >= 0 ? "over" : "under"} exchange spot.`
            }`,
      ok: quality.brti_fresh,
    },
    {
      family: "Distance to strike",
      value: gap == null ? dash : `${gap >= 0 ? "+" : "−"}${usd(Math.abs(gap))}`,
      detail:
        gap == null
          ? "No strike is anchored yet, so distance cannot be measured."
          : `Expected settlement sits ${usd(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} the nearest strike${
              anchorStrike == null ? "" : ` (${usd(anchorStrike)})`
            }. Distance alone is not an edge; it is scaled by volatility below.`,
      ok: gap != null,
    },
    {
      family: "Volatility / expected move",
      value: move == null ? dash : `±${usd(move)}`,
      detail:
        f.sigma_hour == null
          ? "Realized volatility could not be estimated from the candle feed, so no distribution is built and the model waits."
          : `One-sigma move over the ${Math.max(0, Math.round(secsLeft / 60))} minutes remaining, from ${
              f.vol_source
            } (${pct1(f.sigma_hour)} per hour). A wide distribution is a reason to sit, not a reason to guess.`,
      ok: f.sigma_hour != null && sigmaHorizon != null,
    },
    {
      family: "Multi-timeframe trend",
      value: trendParts.length ? trendParts.slice(0, 2).join(" · ") : dash,
      detail: trendParts.length
        ? `${trendParts.join(" · ")}.${agree ? " 15m and 1h point the same way." : " Timeframes disagree or are flat."}${
            f.range_pos == null ? "" : ` Range position ${Math.round(f.range_pos * 100)}%.`
          } Raw market returns only — no Council vote is read here.`
        : "No return series was available this pass.",
      ok: trendParts.length > 0,
    },
    {
      family: "Market-implied distribution",
      value: `${quality.rungs} rungs`,
      detail: quality.ladder_complete
        ? `The whole ladder arrived and every priced rung is scored and stored. ${quality.inversions} neighbouring ${
            quality.inversions === 1 ? "rung contradicts" : "rungs contradict"
          } the rest beyond tolerance; above ${HOUR_MODEL.max_inversions} the ladder is called inconsistent and the model waits.`
        : "The ladder did not fully arrive, so the market's own distribution is incomplete and nothing is scored against it.",
      ok: quality.ladder_complete && quality.monotonic,
    },
    {
      family: "Liquidity / microstructure",
      value: `${HOUR_MODEL.max_spread_cents}¢ max spread`,
      detail: `A side counts only when a real ask is quoted on it. A missing ask is unavailable, and a midpoint is never substituted for one. Spreads wider than ${HOUR_MODEL.max_spread_cents}¢ are refused as uneconomic.`,
      ok: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// The checkpoint timeline
// ---------------------------------------------------------------------------

export type HourTimelineRow = {
  checkpoint: number;
  /** "done" once a row is frozen for this hour, "now" at the live checkpoint, else "ahead"/"passed". */
  state: "done" | "now" | "ahead" | "missed";
  decision: "YES" | "NO" | "WAIT" | null;
  wait_reason: string | null;
  ticker: string | null;
  strike: number | null;
  side: HourSide | null;
  ask: number | null;
  p_model: number | null;
  edge_cents: number | null;
  as_of: string | null;
};

/** One frozen checkpoint, as stored. */
export type HourCheckpointRow = {
  checkpoint: number;
  decision: "YES" | "NO" | "WAIT";
  wait_reason: string | null;
  ticker: string | null;
  strike: number | null;
  side: HourSide | null;
  ask: number | null;
  p_model: number | null;
  edge_cents: number | null;
  as_of: string;
};

/**
 * The hour's six checkpoints in order, each marked done, live, still ahead, or
 * passed without a stored row. A checkpoint with no row is shown as missed
 * rather than quietly dropped.
 */
export function checkpointTimeline(stored: readonly HourCheckpointRow[], secsLeft: number | null): HourTimelineRow[] {
  const byCp = new Map(stored.map((r) => [r.checkpoint, r]));
  return HOUR_CHECKPOINTS.map((cp) => {
    const row = byCp.get(cp);
    const minsLeft = secsLeft == null ? null : secsLeft / 60;
    let state: HourTimelineRow["state"];
    if (row) state = "done";
    else if (minsLeft == null) state = "ahead";
    else if (minsLeft > cp) state = "ahead";
    else state = "missed";
    if (row && minsLeft != null && Math.abs(minsLeft - cp) <= 1.25) state = "now";
    return {
      checkpoint: cp,
      state,
      decision: row?.decision ?? null,
      wait_reason: row?.wait_reason ?? null,
      ticker: row?.ticker ?? null,
      strike: row?.strike ?? null,
      side: row?.side ?? null,
      ask: row?.ask ?? null,
      p_model: row?.p_model ?? null,
      edge_cents: row?.edge_cents ?? null,
      as_of: row?.as_of ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Calibration + per-checkpoint scoring, from graded rows only
// ---------------------------------------------------------------------------

/** A graded per-rung prediction, as stored. */
export type HourGradedPrediction = {
  checkpoint: number;
  p_model: number | null;
  p_market: number | null;
  p_baseline_dist: number | null;
  outcome_yes: 0 | 1 | null;
};

export type HourCalibrationBucket = {
  lo: number;
  hi: number;
  n: number;
  mean_p: number | null;
  hit_rate: number | null;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Ten-point calibration of the model's own probabilities against what actually
 * settled. A bucket with no graded rows stays empty — it never borrows a
 * neighbour's hit rate.
 */
export function calibrationBuckets(rows: readonly HourGradedPrediction[], buckets = 10): HourCalibrationBucket[] {
  const usable = rows.filter((r) => r.p_model != null && (r.outcome_yes === 0 || r.outcome_yes === 1));
  return Array.from({ length: buckets }, (_, i) => {
    const lo = i / buckets;
    const hi = (i + 1) / buckets;
    const inBucket = usable.filter((r) => (i === buckets - 1 ? r.p_model! >= lo && r.p_model! <= hi : r.p_model! >= lo && r.p_model! < hi));
    const mp = mean(inBucket.map((r) => r.p_model!));
    const hr = mean(inBucket.map((r) => r.outcome_yes!));
    return { lo, hi, n: inBucket.length, mean_p: mp == null ? null : r3(mp), hit_rate: hr == null ? null : r3(hr) };
  });
}

export type HourCheckpointScore = {
  checkpoint: number;
  n: number;
  brier_model: number | null;
  brier_market: number | null;
  brier_baseline: number | null;
};

/** Brier by checkpoint: does the read get better as the hour runs out, or worse? */
export function checkpointScores(rows: readonly HourGradedPrediction[]): HourCheckpointScore[] {
  return HOUR_CHECKPOINTS.map((cp) => {
    const at = rows.filter((r) => r.checkpoint === cp && (r.outcome_yes === 0 || r.outcome_yes === 1));
    const pick = (get: (r: HourGradedPrediction) => number | null) => {
      const xs = at.flatMap((r) => {
        const p = get(r);
        return p == null ? [] : [brier(p, r.outcome_yes!)];
      });
      const m = mean(xs);
      return m == null ? null : r3(m);
    };
    return {
      checkpoint: cp,
      n: at.length,
      brier_model: pick((r) => r.p_model),
      brier_market: pick((r) => r.p_market),
      brier_baseline: pick((r) => r.p_baseline_dist),
    };
  });
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export type HourRecentRow = {
  close_time: string;
  close_et: string;
  checkpoint: number;
  decision: "YES" | "NO" | "WAIT";
  wait_reason: string | null;
  strike: number | null;
  side: HourSide | null;
  ask: number | null;
  p_model: number | null;
  result: "YES" | "NO" | null;
  official_value: number | null;
  ev_cents: number | null;
  explanation: string;
};

export type HourLiveRead = {
  decision: "YES" | "NO" | "WAIT";
  wait_reason: HourWaitReason | null;
  candidate: HourCandidate | null;
  explanation: string;
  expected_settlement: number | null;
  expected_source: string;
  sigma_horizon: number | null;
  quality: HourDataQuality;
  /** True when this instant is one of the hour's research checkpoints. */
  at_checkpoint: boolean;
  checkpoint: number | null;
};

/**
 * The raw market snapshot the hero prints, with its own freshness.
 *
 * `brti` is the CF Benchmarks settlement value and is the only one of these the
 * model may act on. `venue_index` is a perpetual-futures index kept as context;
 * it is deliberately carried WITHOUT settlement authority so the page can show
 * it while never calling it the settlement index.
 */
export type HourSnapshotView = {
  brti: number | null;
  brti_age_s: number | null;
  brti_source: string;
  /** Venue/perp reference. Context only — never the settlement value. */
  venue_index: number | null;
  spot: number | null;
  spot_age_s: number | null;
  /** BRTI minus exchange spot, in dollars. */
  brti_spot_basis: number | null;
  sigma_hour: number | null;
};

export type HourResearchBrief = {
  at: string;
  version: string;
  authority: typeof HOUR_RESEARCH_AUTHORITY;
  live_rule: boolean;
  checkpoints: readonly number[];
  /** The hour in progress, or null when no open hourly ladder could be read. */
  hour: { event_ticker: string; close_time: string; close_et: string; secs_left: number } | null;
  read: HourLiveRead | null;
  snapshot: HourSnapshotView | null;
  ladder: HourLadderRow[];
  evidence: HourEvidenceCard[];
  timeline: HourTimelineRow[];
  /** True when the research tables could not be read at all — not a zero record. */
  storage_unavailable: boolean;
  record: HourShadowScore;
  calibration: HourCalibrationBucket[];
  by_checkpoint: HourCheckpointScore[];
  recent: HourRecentRow[];
  copy: typeof HOUR_RESEARCH_COPY;
};

export function buildHourResearchBrief(input: {
  now: number;
  hour: { event_ticker: string; close_ms: number; secs_left: number } | null;
  read: HourRead | null;
  features: HourFeatures | null;
  stored: readonly HourCheckpointRow[] | null;
  shadow: readonly HourShadowRow[] | null;
  graded: readonly HourGradedPrediction[] | null;
}): HourResearchBrief {
  const { read } = input;
  const ladder = read ? ladderView(read) : [];
  const anchor = ladder.find((r) => r.anchor)?.strike ?? null;
  const secsLeft = input.hour?.secs_left ?? null;
  const shadow = input.shadow ?? [];
  return {
    at: new Date(input.now).toISOString(),
    version: HOUR_RESEARCH_VERSION,
    authority: HOUR_RESEARCH_AUTHORITY,
    live_rule: HOUR_POSTURE.live_rule,
    checkpoints: HOUR_CHECKPOINTS,
    hour: input.hour
      ? {
          event_ticker: input.hour.event_ticker,
          close_time: new Date(input.hour.close_ms).toISOString(),
          close_et: clockET(input.hour.close_ms),
          secs_left: Math.max(0, Math.round(input.hour.secs_left)),
        }
      : null,
    read: read
      ? {
          decision: read.decision,
          wait_reason: read.wait_reason,
          candidate: read.candidate,
          explanation: read.explanation,
          expected_settlement: read.expected_settlement,
          expected_source: read.expected_source,
          sigma_horizon: read.sigma_horizon,
          quality: read.quality,
          at_checkpoint: read.checkpoint != null,
          checkpoint: read.checkpoint,
        }
      : null,
    snapshot: input.features
      ? {
          brti: input.features.brti,
          brti_age_s: input.features.brti_age_s,
          brti_source: input.features.brti_source,
          venue_index: input.features.venue_index,
          spot: input.features.spot,
          spot_age_s: input.features.spot_age_s,
          brti_spot_basis: input.features.brti_spot_basis,
          sigma_hour: input.features.sigma_hour,
        }
      : null,
    ladder,
    evidence:
      input.features && read
        ? evidenceBoard(
            input.features,
            read.quality,
            read.expected_settlement,
            read.expected_source,
            read.sigma_horizon,
            secsLeft ?? 0,
            anchor,
          )
        : [],
    timeline: checkpointTimeline(input.stored ?? [], secsLeft),
    storage_unavailable: input.stored == null || input.shadow == null,
    record: shadowScore(shadow),
    calibration: calibrationBuckets(input.graded ?? []),
    by_checkpoint: checkpointScores(input.graded ?? []),
    recent: shadow
      // Completed hours, calls and sits alike. A graded WAIT belongs on the
      // tape; filtering on `result` would erase every sit from the record.
      .filter((r) => r.graded_at != null)
      .slice(0, 12)
      .map((r) => ({
        close_time: r.close_time,
        close_et: clockET(Date.parse(r.close_time)),
        checkpoint: r.checkpoint,
        decision: r.decision,
        wait_reason: r.wait_reason,
        strike: r.strike,
        side: r.side,
        ask: r.ask,
        p_model: r.p_model,
        result: r.result,
        official_value: r.official_value,
        ev_cents: r.ev_cents,
        explanation: r.explanation,
      })),
    copy: HOUR_RESEARCH_COPY,
  };
}
