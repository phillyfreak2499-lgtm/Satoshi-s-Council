/**
 * Hour Research v1 — the hourly fair-value model. Pure. Authority: NONE.
 *
 * The KXBTCD hourly contract is a STRIKE LADDER: each rung asks whether the
 * official settlement value will be at or above one price at the top of the
 * hour, Eastern. The sides are YES / NO / WAIT — never UP/DOWN, which is the
 * 15-minute contract and a different product.
 *
 * This module estimates P(settlement >= strike) for every usable rung from a
 * FROZEN decision-time snapshot, compares that fair probability to the real
 * observed asks after the hourly fee, and selects at most one research
 * candidate — or returns a structured WAIT reason. It is deterministic and
 * versioned: the same snapshot always produces the same read.
 *
 * Boundaries, enforced by hour-research rails:
 *  - No import of the 15-minute Chair, seats, learner, bots or paper book. The
 *    15-minute VERDICT is never an hourly feature; raw market data is fine.
 *  - No clock of its own, no network, no database, no randomness.
 *  - Nothing here can promote itself. HOUR_POSTURE.live_rule stays false and
 *    this model's authority is "none" until a human freezes and promotes it.
 *  - Missing data becomes WAIT or `null`, never a fabricated number.
 */
import { takerFee, type HourMarketRow, type HourTicker } from "./hour.ts";

/** Bumped whenever the model's numbers could change. Stored on every row. */
export const HOUR_RESEARCH_VERSION = "hour-research-v1.0.0";
/** Printed in code, in storage and in copy: this model decides nothing. */
export const HOUR_RESEARCH_AUTHORITY = "none" as const;

// ---------------------------------------------------------------------------
// Checkpoints — deterministic research instants inside the hour
// ---------------------------------------------------------------------------

/** Minutes remaining at which the model records what it would have done. */
export const HOUR_CHECKPOINTS = [45, 30, 20, 15, 10, 5] as const;
export type HourCheckpoint = (typeof HOUR_CHECKPOINTS)[number];

/**
 * How near a checkpoint a tick must land to claim it. Feed cadence is seconds,
 * so a band is required; it is narrower than half the smallest gap between
 * checkpoints (5 minutes), so a tick can never be ambiguous between two.
 */
export const HOUR_CHECKPOINT_BAND_S = 75;

/**
 * The checkpoint this instant belongs to, or null between checkpoints. Pure and
 * deterministic: identity depends only on seconds remaining, never on arrival
 * order, so a replay of the same hour claims the same checkpoints.
 */
export function checkpointFor(secsLeft: number): HourCheckpoint | null {
  if (!Number.isFinite(secsLeft) || secsLeft < 0) return null;
  let best: HourCheckpoint | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of HOUR_CHECKPOINTS) {
    const gap = Math.abs(secsLeft - c * 60);
    if (gap <= HOUR_CHECKPOINT_BAND_S && gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Structured WAIT reasons — never one generic "WAIT"
// ---------------------------------------------------------------------------

export const HOUR_WAIT_REASONS = [
  "insufficient_edge", // a candidate existed but its after-fee edge did not clear the floor
  "uncertainty_high", // the model's own spread on p is too wide to act on
  "stale_index", // the settlement index is missing or too old to trust
  "stale_spot", // exchange spot is missing or too old
  "incomplete_ladder", // the hour's ladder did not fully arrive
  "no_usable_ask", // no real ask on the side the model favours (never substitute a mid)
  "spread_too_wide", // the quoted spread makes the entry uneconomic
  "thin_liquidity", // no resting size where the venue reports it
  "ladder_inconsistent", // neighbouring rungs contradict each other beyond tolerance
  "conflicting_evidence", // families disagree enough that the read is not trustworthy
  "outside_checkpoint", // not at a research checkpoint
  "model_unavailable", // volatility or expected settlement could not be estimated
] as const;
export type HourWaitReason = (typeof HOUR_WAIT_REASONS)[number];

// ---------------------------------------------------------------------------
// Frozen decision-time inputs
// ---------------------------------------------------------------------------

/** One rung of the hour's ladder, as observed. Nulls mean "the feed had none". */
export type HourRung = {
  ticker: string;
  strike: number;
  yes_bid: number | null;
  yes_ask: number | null;
  no_bid: number | null;
  no_ask: number | null;
  /** Resting size where the venue reports it; null when unknown (not zero). */
  yes_size: number | null;
  no_size: number | null;
};

/**
 * Everything the model is allowed to see at a checkpoint. Assembled by the
 * server observer from feeds that already exist, frozen before scoring, and
 * stored verbatim so the decision can be reproduced without any future state.
 * Every field is nullable: an absent feed is `null`, never invented.
 */
export type HourFeatures = {
  // SETTLEMENT / INDEX — the contract settles on the official index, not spot.
  index: number | null;
  index_age_s: number | null;
  spot: number | null;
  spot_age_s: number | null;
  /** index - spot, in dollars. Null when either side is unknown. */
  basis: number | null;
  /** Spread of recent basis observations, in dollars; small = stable. */
  basis_spread: number | null;

  // VOLATILITY — a distribution, not a trend label.
  /** Realized volatility of log returns, expressed per hour (decimal, e.g. 0.004). */
  sigma_hour: number | null;
  /** Where the vol estimate came from, for audit. */
  vol_source: string;

  // TREND — raw multi-timeframe context, as hourly features (never Council votes).
  ret5: number | null;
  ret15: number | null;
  ret30: number | null;
  ret60: number | null;
  ret4h: number | null;
  ret24h: number | null;
  /** 0 = at the recent low, 1 = at the recent high. */
  range_pos: number | null;
};

/** The hour being studied and where the clock stands. */
export type HourClockState = {
  event_ticker: string;
  close_ms: number;
  as_of_ms: number;
  secs_left: number;
};

/** Data-quality verdict, computed before any number is trusted. */
export type HourDataQuality = {
  ok: boolean;
  ladder_complete: boolean;
  rungs: number;
  index_fresh: boolean;
  spot_fresh: boolean;
  monotonic: boolean;
  /** Count of neighbouring rungs whose YES prices rise with strike beyond tolerance. */
  inversions: number;
};

// ---------------------------------------------------------------------------
// Tunables — frozen with the version, never fitted to recent results
// ---------------------------------------------------------------------------

export const HOUR_MODEL = Object.freeze({
  /** After-fee cents of edge a rung must show before it can be a candidate. */
  min_edge_cents: 4,
  /** Widest quoted spread (cents) the model will call a usable market. */
  max_spread_cents: 6,
  /** The model refuses to act when its own p-band is wider than this. */
  max_uncertainty: 0.18,
  /** A settlement index older than this is stale. */
  max_index_age_s: 120,
  /** Exchange spot older than this is stale. */
  max_spot_age_s: 60,
  /** Neighbouring-rung YES price inversion tolerated before the ladder is called inconsistent, in cents. */
  inversion_tolerance_cents: 2,
  /** Above this many inversions the ladder is inconsistent. */
  max_inversions: 2,
  /** Floor/ceiling on p so a single rung never reads as a certainty. */
  p_floor: 0.005,
  p_ceil: 0.995,
  /** Fallback per-hour sigma used ONLY by the simple-distance baseline, never by the model. */
  baseline_sigma_hour: 0.004,
});

// ---------------------------------------------------------------------------
// Math — normal CDF, no dependencies
// ---------------------------------------------------------------------------

/** Abramowitz & Stegun 7.1.26 error function; max abs error ~1.5e-7. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}

/** Standard normal CDF. */
export function normCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Ladder parsing + market-implied distribution
// ---------------------------------------------------------------------------

/**
 * The "at or above" rungs of one hour, sorted by strike. Only rungs this desk
 * can parse and price are kept; anything else is dropped rather than guessed.
 * `parse` is injected so this module never imports the ticker parser's module
 * graph — the server passes `parseHourTicker` and `quoteCents`.
 */
export function ladderRungs(
  markets: readonly HourMarketRow[],
  closeMs: number,
  parse: (t: string) => HourTicker | null,
  cents: (dollars: unknown, c: unknown) => number | null,
): HourRung[] {
  const out: HourRung[] = [];
  for (const row of markets) {
    const ticker = String(row.ticker ?? "");
    const parsed = parse(ticker);
    if (!parsed || parsed.close_ms !== closeMs || parsed.kind !== "above") continue;
    const rawStrike = row.floor_strike ?? parsed.strike;
    const strike = finite(Number(rawStrike)) ? Number(rawStrike) : null;
    if (strike == null || strike <= 0) continue;
    const size = (v: unknown): number | null => (finite(Number(v)) ? Number(v) : null);
    out.push({
      ticker,
      strike,
      yes_bid: cents(row.yes_bid_dollars, row.yes_bid),
      yes_ask: cents(row.yes_ask_dollars, row.yes_ask),
      no_bid: cents(row.no_bid_dollars, row.no_bid),
      no_ask: cents(row.no_ask_dollars, row.no_ask),
      yes_size: size(row.yes_bid_size ?? row.yes_size),
      no_size: size(row.no_bid_size ?? row.no_size),
    });
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

/**
 * The market's own YES probability for a rung, from the quoted two-sided market.
 * A mid is a FAIR-VALUE read only; it is never used as a purchase price. When
 * only one side is quoted there is no honest mid, so this is null.
 */
export function marketImpliedYes(rung: HourRung): number | null {
  if (rung.yes_bid != null && rung.yes_ask != null) return clamp((rung.yes_bid + rung.yes_ask) / 200, 0, 1);
  // A NO market prices the complement; use it only when both NO sides are quoted.
  if (rung.no_bid != null && rung.no_ask != null) return clamp(1 - (rung.no_bid + rung.no_ask) / 200, 0, 1);
  return null;
}

/**
 * Count neighbouring rungs whose implied YES probability RISES as the strike
 * rises. P(S >= K) must be non-increasing in K, so any such pair is a stale or
 * crossed quote. Rungs without a two-sided market are skipped, not filled in.
 */
export function ladderInversions(rungs: readonly HourRung[], toleranceCents = HOUR_MODEL.inversion_tolerance_cents): number {
  // Sorted here rather than trusted from the caller: the count must describe the
  // ladder, not the order the feed happened to return it in.
  const priced = rungs.filter((r) => marketImpliedYes(r) != null).sort((a, b) => a.strike - b.strike);
  let bad = 0;
  for (let i = 1; i < priced.length; i++) {
    const prev = marketImpliedYes(priced[i - 1]!)!;
    const cur = marketImpliedYes(priced[i]!)!;
    if (cur - prev > toleranceCents / 100) bad += 1;
  }
  return bad;
}

/**
 * A monotone (non-increasing) smoothing of the market's implied YES curve, by
 * pool-adjacent-violators. It SMOOTHS observed rungs only: a rung the feed did
 * not price stays null and is never interpolated into existence.
 */
export function monotoneImplied(rungs: readonly HourRung[]): (number | null)[] {
  const idx: number[] = [];
  const vals: number[] = [];
  rungs.forEach((r, i) => {
    const p = marketImpliedYes(r);
    if (p != null) {
      idx.push(i);
      vals.push(p);
    }
  });
  // Pool adjacent violators for a non-increasing fit over the priced rungs.
  const v = [...vals];
  const w = v.map(() => 1);
  for (let i = 1; i < v.length; i++) {
    while (i > 0 && v[i - 1]! < v[i]!) {
      const merged = (v[i - 1]! * w[i - 1]! + v[i]! * w[i]!) / (w[i - 1]! + w[i]!);
      v.splice(i - 1, 2, merged);
      w.splice(i - 1, 2, w[i - 1]! + w[i]!);
      i -= 1;
    }
  }
  // Re-expand pooled blocks back over their original positions.
  const expanded: number[] = [];
  for (let b = 0; b < v.length; b++) for (let k = 0; k < w[b]!; k++) expanded.push(v[b]!);
  const out: (number | null)[] = rungs.map(() => null);
  idx.forEach((position, k) => {
    out[position] = expanded[k]!;
  });
  return out;
}

// ---------------------------------------------------------------------------
// The fair-value model
// ---------------------------------------------------------------------------

/** Expected settlement value: the official index when fresh, else spot carried by a known basis. */
export function expectedSettlement(f: HourFeatures): { value: number | null; source: "index" | "spot+basis" | "spot" | "none" } {
  if (f.index != null && f.index > 0 && (f.index_age_s == null || f.index_age_s <= HOUR_MODEL.max_index_age_s)) {
    return { value: f.index, source: "index" };
  }
  if (f.spot != null && f.spot > 0) {
    if (f.basis != null) return { value: f.spot + f.basis, source: "spot+basis" };
    return { value: f.spot, source: "spot" };
  }
  return { value: null, source: "none" };
}

/** Sigma of log settlement over the remaining time, from per-hour realized vol. */
export function horizonSigma(sigmaHour: number | null, secsLeft: number): number | null {
  if (sigmaHour == null || !(sigmaHour > 0) || !(secsLeft > 0)) return null;
  return sigmaHour * Math.sqrt(secsLeft / 3600);
}

/** P(settlement >= strike) under a lognormal centred on the expected settlement. */
export function pYes(expected: number, strike: number, sigma: number): number {
  if (!(expected > 0) || !(strike > 0) || !(sigma > 0)) return Number.NaN;
  const z = Math.log(expected / strike) / sigma;
  return clamp(normCdf(z), HOUR_MODEL.p_floor, HOUR_MODEL.p_ceil);
}

/**
 * The model's own uncertainty on p for this rung: how far p moves when the
 * volatility estimate is wrong by a quarter in either direction. A wide band
 * means the rung is a coin flip the model cannot resolve, and it will WAIT.
 */
export function pUncertainty(expected: number, strike: number, sigma: number): number {
  const lo = pYes(expected, strike, sigma * 0.75);
  const hi = pYes(expected, strike, sigma * 1.25);
  return Math.abs(hi - lo);
}

export type HourSide = "YES" | "NO";

/** One rung, priced by the model and by the market, with the after-fee edge on each side. */
export type HourRungRead = {
  ticker: string;
  strike: number;
  /** Volatility-normalised distance: ln(expected/strike) / sigma. */
  z: number;
  dollars_to_strike: number;
  p_yes: number;
  p_no: number;
  uncertainty: number;
  market_p_yes: number | null;
  yes_ask: number | null;
  no_ask: number | null;
  spread_yes: number | null;
  spread_no: number | null;
  /** After-fee expected cents for buying that side at its real observed ask; null when no ask. */
  edge_yes: number | null;
  edge_no: number | null;
  /** The better side by edge, when one is usable. */
  best_side: HourSide | null;
  best_edge: number | null;
};

const spreadOf = (bid: number | null, ask: number | null): number | null =>
  bid != null && ask != null ? Math.max(0, ask - bid) : null;

/**
 * After-fee expected cents of buying one contract at its real ask. `null` when
 * that side has no observed ask — a missing ask is unavailable, and a midpoint
 * is never substituted for it.
 */
export function edgeCents(p: number, ask: number | null): number | null {
  if (ask == null || !(ask > 0) || !(ask < 100)) return null;
  return p * 100 - ask - takerFee(ask);
}

/** Price every rung from the frozen snapshot. Pure; no selection, no gating. */
export function readLadder(rungs: readonly HourRung[], f: HourFeatures, secsLeft: number): HourRungRead[] {
  const exp = expectedSettlement(f);
  const sigma = horizonSigma(f.sigma_hour, secsLeft);
  if (exp.value == null || sigma == null) return [];
  const expected = exp.value;
  return rungs.map((r) => {
    const p = pYes(expected, r.strike, sigma);
    const pn = 1 - p;
    const ey = edgeCents(p, r.yes_ask);
    const en = edgeCents(pn, r.no_ask);
    let best: HourSide | null = null;
    let bestEdge: number | null = null;
    if (ey != null && (en == null || ey >= en)) {
      best = "YES";
      bestEdge = ey;
    } else if (en != null) {
      best = "NO";
      bestEdge = en;
    }
    return {
      ticker: r.ticker,
      strike: r.strike,
      z: Math.log(expected / r.strike) / sigma,
      dollars_to_strike: expected - r.strike,
      p_yes: p,
      p_no: pn,
      uncertainty: pUncertainty(expected, r.strike, sigma),
      market_p_yes: marketImpliedYes(r),
      yes_ask: r.yes_ask,
      no_ask: r.no_ask,
      spread_yes: spreadOf(r.yes_bid, r.yes_ask),
      spread_no: spreadOf(r.no_bid, r.no_ask),
      edge_yes: ey,
      edge_no: en,
      best_side: best,
      best_edge: bestEdge,
    };
  });
}

// ---------------------------------------------------------------------------
// Data quality + selection
// ---------------------------------------------------------------------------

export function dataQuality(rungs: readonly HourRung[], f: HourFeatures, ladderComplete: boolean): HourDataQuality {
  const inversions = ladderInversions(rungs);
  const indexFresh = f.index != null && (f.index_age_s == null || f.index_age_s <= HOUR_MODEL.max_index_age_s);
  const spotFresh = f.spot != null && (f.spot_age_s == null || f.spot_age_s <= HOUR_MODEL.max_spot_age_s);
  const monotonic = inversions <= HOUR_MODEL.max_inversions;
  return {
    ok: ladderComplete && rungs.length > 0 && (indexFresh || spotFresh) && monotonic,
    ladder_complete: ladderComplete,
    rungs: rungs.length,
    index_fresh: indexFresh,
    spot_fresh: spotFresh,
    monotonic,
    inversions,
  };
}

export type HourCandidate = {
  ticker: string;
  strike: number;
  side: HourSide;
  ask: number;
  fee: number;
  p_model: number;
  market_p_yes: number | null;
  edge_cents: number;
  uncertainty: number;
  z: number;
};

export type HourRead = {
  version: typeof HOUR_RESEARCH_VERSION;
  authority: typeof HOUR_RESEARCH_AUTHORITY;
  checkpoint: HourCheckpoint | null;
  decision: "YES" | "NO" | "WAIT";
  candidate: HourCandidate | null;
  wait_reason: HourWaitReason | null;
  quality: HourDataQuality;
  expected_settlement: number | null;
  expected_source: ReturnType<typeof expectedSettlement>["source"];
  sigma_horizon: number | null;
  /** Every rung priced — for calibration research, not for booking. */
  rungs: HourRungRead[];
  /** Plain, deterministic sentence built only from the numbers above. */
  explanation: string;
};

/**
 * The hourly read at one checkpoint. Scores the WHOLE ladder, then selects at
 * most one candidate — the largest after-fee edge that clears every gate. Any
 * failure returns a specific WAIT reason; WAIT is a valid, expected outcome and
 * is never a fallback for a number the model could not compute.
 */
export function hourRead(input: {
  clock: HourClockState;
  rungs: readonly HourRung[];
  features: HourFeatures;
  ladderComplete: boolean;
  /** Pass false to score off-checkpoint (research preview); storage only keeps checkpoints. */
  requireCheckpoint?: boolean;
}): HourRead {
  const { clock, features: f, ladderComplete } = input;
  // Strike order is the model's own, never the feed's: the same snapshot must
  // read the same way whatever order its rungs arrived in.
  const rungs = [...input.rungs].sort((a, b) => a.strike - b.strike);
  const checkpoint = checkpointFor(clock.secs_left);
  const quality = dataQuality(rungs, f, ladderComplete);
  const exp = expectedSettlement(f);
  const sigma = horizonSigma(f.sigma_hour, clock.secs_left);
  const reads = readLadder(rungs, f, clock.secs_left);

  const base = {
    version: HOUR_RESEARCH_VERSION,
    authority: HOUR_RESEARCH_AUTHORITY,
    checkpoint,
    quality,
    expected_settlement: exp.value,
    expected_source: exp.source,
    sigma_horizon: sigma,
    rungs: reads,
  } as const;

  const wait = (reason: HourWaitReason): HourRead => ({
    ...base,
    decision: "WAIT",
    candidate: null,
    wait_reason: reason,
    explanation: waitSentence(reason, base.expected_settlement, clock.secs_left),
  });

  if ((input.requireCheckpoint ?? true) && checkpoint == null) return wait("outside_checkpoint");
  if (!ladderComplete) return wait("incomplete_ladder");
  if (!quality.monotonic) return wait("ladder_inconsistent");
  if (!quality.index_fresh && !quality.spot_fresh) return wait(f.index == null ? "stale_index" : "stale_spot");
  if (exp.value == null || sigma == null) return wait("model_unavailable");
  if (!reads.length) return wait("model_unavailable");

  // Only rungs with a real ask on the model's favoured side can be candidates.
  const usable = reads.filter((r) => r.best_side != null && r.best_edge != null);
  if (!usable.length) return wait("no_usable_ask");

  const priced = usable.filter((r) => {
    const spread = r.best_side === "YES" ? r.spread_yes : r.spread_no;
    return spread == null || spread <= HOUR_MODEL.max_spread_cents;
  });
  if (!priced.length) return wait("spread_too_wide");

  const confident = priced.filter((r) => r.uncertainty <= HOUR_MODEL.max_uncertainty);
  if (!confident.length) return wait("uncertainty_high");

  const best = confident.reduce((a, b) => (b.best_edge! > a.best_edge! ? b : a));
  if (best.best_edge! < HOUR_MODEL.min_edge_cents) return wait("insufficient_edge");

  const ask = (best.best_side === "YES" ? best.yes_ask : best.no_ask)!;
  const candidate: HourCandidate = {
    ticker: best.ticker,
    strike: best.strike,
    side: best.best_side!,
    ask,
    fee: takerFee(ask),
    p_model: best.best_side === "YES" ? best.p_yes : best.p_no,
    market_p_yes: best.market_p_yes,
    edge_cents: best.best_edge!,
    uncertainty: best.uncertainty,
    z: best.z,
  };
  return {
    ...base,
    decision: candidate.side,
    candidate,
    wait_reason: null,
    explanation: readSentence(candidate, base.expected_settlement!, clock.secs_left, f),
  };
}

// ---------------------------------------------------------------------------
// Deterministic explanation — built only from stored facts
// ---------------------------------------------------------------------------

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const mins = (s: number) => `${Math.max(0, Math.round(s / 60))}m`;

export function readSentence(c: HourCandidate, expected: number, secsLeft: number, f: HourFeatures): string {
  const gap = expected - c.strike;
  const side = gap >= 0 ? "above" : "below";
  const trend =
    f.ret15 != null && f.ret30 != null && Math.sign(f.ret15) === Math.sign(f.ret30) && f.ret15 !== 0
      ? ` 15m/30m momentum agrees (${(f.ret15 * 100).toFixed(2)}% / ${(f.ret30 * 100).toFixed(2)}%).`
      : "";
  const basis = f.basis != null ? ` Settlement basis ${usd(Math.abs(f.basis))} ${f.basis >= 0 ? "over" : "under"} spot.` : "";
  return `${c.side} ${pct(c.p_model)} vs ${c.ask}¢ ask. Expected settlement is ${usd(Math.abs(gap))} ${side} the ${usd(c.strike)} strike with ${mins(secsLeft)} remaining; after the ${c.fee}¢ fee the model shows ${c.edge_cents.toFixed(1)}¢ of edge.${trend}${basis}`;
}

export function waitSentence(reason: HourWaitReason, expected: number | null, secsLeft: number): string {
  const head = `WAIT with ${mins(secsLeft)} remaining`;
  const why: Record<HourWaitReason, string> = {
    insufficient_edge: "a rung was cheap enough to consider but its after-fee edge did not clear the floor",
    uncertainty_high: "the volatility estimate leaves the probability too wide to act on",
    stale_index: "the settlement index is missing or too old to trust",
    stale_spot: "exchange spot is missing or too old to trust",
    incomplete_ladder: "the hour's strike ladder did not fully arrive",
    no_usable_ask: "no real ask was quoted on the side the model favours",
    spread_too_wide: "the quoted spread makes the entry uneconomic",
    thin_liquidity: "no resting size was reported where the venue publishes it",
    ladder_inconsistent: "neighbouring rungs contradict each other, so the ladder is not trustworthy",
    conflicting_evidence: "the evidence families disagree enough that the read is not trustworthy",
    outside_checkpoint: "this instant is not one of the hour's research checkpoints",
    model_unavailable: "expected settlement or volatility could not be estimated from available feeds",
  };
  const where = expected != null ? ` Expected settlement ${usd(expected)}.` : "";
  return `${head}: ${why[reason]}.${where}`;
}

// ---------------------------------------------------------------------------
// Baselines — a complicated model must beat these prospectively
// ---------------------------------------------------------------------------

/** MARKET baseline: the market's own implied probability for a rung. */
export function marketBaselineP(rung: HourRung): number | null {
  return marketImpliedYes(rung);
}

/**
 * SIMPLE DISTANCE baseline: spot distance to strike scaled by a FIXED per-hour
 * volatility. No regime, no basis, no trend — deliberately naive.
 */
export function distanceBaselineP(spot: number | null, strike: number, secsLeft: number): number | null {
  if (spot == null || !(spot > 0) || !(strike > 0) || !(secsLeft > 0)) return null;
  const sigma = HOUR_MODEL.baseline_sigma_hour * Math.sqrt(secsLeft / 3600);
  return pYes(spot, strike, sigma);
}

/** Brier score contribution for one forecast. Lower is better. */
export function brier(p: number, outcome: 0 | 1): number {
  return (p - outcome) ** 2;
}

// ---------------------------------------------------------------------------
// The shadow record — scored from graded shadow rows only
// ---------------------------------------------------------------------------

export type HourShadowRow = {
  close_time: string;
  checkpoint: number;
  decision: "YES" | "NO" | "WAIT";
  wait_reason: string | null;
  ticker: string | null;
  strike: number | null;
  side: HourSide | null;
  ask: number | null;
  fee: number | null;
  p_model: number | null;
  p_market: number | null;
  edge_cents: number | null;
  explanation: string;
  result: "YES" | "NO" | null;
  official_value: number | null;
  ev_cents: number | null;
};

export type HourShadowScore = {
  /** Hours that have settled and been graded. */
  windows: number;
  waits: number;
  calls: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  /** Break-even win rate implied by the prices actually paid. */
  needed: number | null;
  net_cents: number;
  avg_entry: number | null;
  max_dd: number;
  /** Mean Brier of the model on graded calls, and of the market on the same rows. */
  brier_model: number | null;
  brier_market: number | null;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Score the shadow book. Only GRADED hours count; an ungraded or empty book
 * scores zero windows, never a zero record. WAIT hours are counted as windows
 * and as sits, never as losses.
 */
export function shadowScore(rows: readonly HourShadowRow[]): HourShadowScore {
  const graded = rows.filter((r) => r.result === "YES" || r.result === "NO");
  const calls = graded.filter((r) => r.decision !== "WAIT" && r.ask != null && r.ev_cents != null);
  const wins = calls.filter((r) => r.ev_cents! > 0);
  const losses = calls.filter((r) => r.ev_cents! < 0);
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const r of [...calls].sort((a, b) => a.close_time.localeCompare(b.close_time))) {
    cum += r.ev_cents!;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
  }
  const bm = calls.flatMap((r) => {
    if (r.p_model == null || r.side == null || r.result == null) return [];
    const yes = r.result === "YES" ? 1 : 0;
    const outcome: 0 | 1 = r.side === "YES" ? (yes as 0 | 1) : ((1 - yes) as 0 | 1);
    return [brier(r.p_model, outcome)];
  });
  const bk = calls.flatMap((r) => {
    if (r.p_market == null || r.side == null || r.result == null) return [];
    const yes = r.result === "YES" ? 1 : 0;
    const pSide = r.side === "YES" ? r.p_market : 1 - r.p_market;
    const outcome: 0 | 1 = r.side === "YES" ? (yes as 0 | 1) : ((1 - yes) as 0 | 1);
    return [brier(pSide, outcome)];
  });
  const avgWin = mean(wins.map((r) => r.ev_cents!));
  const avgLoss = mean(losses.map((r) => -r.ev_cents!));
  const avgEntry = mean(calls.map((r) => r.ask! + (r.fee ?? takerFee(r.ask!))));
  const needed = avgWin != null && avgLoss != null && avgEntry != null && avgWin + avgLoss > 0 ? (100 * avgLoss) / (avgWin + avgLoss) : null;
  const bmMean = mean(bm);
  const bkMean = mean(bk);
  return {
    windows: graded.length,
    waits: graded.length - calls.length,
    calls: calls.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: calls.length ? Math.round((100 * wins.length) / calls.length) : null,
    needed: needed == null ? null : r1(needed),
    net_cents: r1(calls.reduce((s, r) => s + r.ev_cents!, 0)),
    avg_entry: avgEntry == null ? null : r1(avgEntry),
    max_dd: r1(dd),
    brier_model: bmMean == null ? null : r3(bmMean),
    brier_market: bkMean == null ? null : r3(bkMean),
  };
}
