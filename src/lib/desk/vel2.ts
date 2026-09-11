/**
 * VEL 2.0 — how much the YES price SHOULD have moved, and what is left over.
 *
 * WHAT IT REPLACES. The production VEL read is built on `spot_lead_bps`, which
 * is computed as `spotReturnBps − yesDelta × 2`. That "× 2" is a single fixed
 * exchange rate between basis points of BTC and cents of YES, applied to every
 * window. It cannot be right in general: the same $50 move in BTC is nearly
 * meaningless with ten minutes left and the strike $400 away, and close to
 * decisive with forty seconds left and the strike $5 away. A fixed conversion
 * reads the first as a large dislocation and the second as a small one, which is
 * exactly backwards.
 *
 * WHAT IT DOES INSTEAD. A 15-minute UP/DOWN contract is a binary on the
 * settlement index against the strike, so its price has a known sensitivity to
 * the underlying. With P = Φ(d/σ), where d is the distance to the strike and σ
 * is the expected settlement move over the remaining time,
 *
 *     dP/dSpot = φ(d/σ) / σ
 *
 * which in cents per dollar of BTC is 100·φ(z)/σ. That is the expected response,
 * derived rather than fitted, and it conditions on everything the brief asks for
 * without a single free parameter: distance to strike and time remaining and
 * volatility all enter through d and σ, and the current YES probability enters
 * through z, since P = Φ(z). Sensitivity is largest at the money and collapses
 * deep in or out of it, which is the behaviour a fixed rate cannot express.
 *
 * The residual is then simply
 *
 *     observed YES move − expected YES move
 *
 * and THAT is the candidate dislocation: the part of the contract's move that
 * the underlying does not explain. Positive means YES moved up more than the
 * move in BTC justified.
 *
 * WHICH MARKET LEADS. The incumbent is named for an assumption — that spot
 * leads and Kalshi catches up. That may be true, sometimes, in some regimes, and
 * the way to find out is to measure it rather than encode it. `leadLag` reports
 * SPOT, KALSHI, SIMULTANEOUS or NONE by asking which series first moved beyond
 * its own noise floor inside the window, and says so honestly when neither did.
 *
 * NO LOOKAHEAD. Every function here takes a backward-looking path and an index
 * into it, and reads only at or before that index. Nothing can consult a later
 * sample, and a test asserts that appending future samples leaves an earlier
 * reading unchanged.
 *
 * SHADOW. Nothing here votes. No seat reads it, no skill is built on it in this
 * pass, and no path exists from this file to the chair's score. The production
 * VEL behaviour is untouched.
 *
 * Pure module.
 */

/** Standard normal density. */
export function normPdf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * The contract's sensitivity to the underlying: cents of YES per dollar of BTC.
 * Largest at the money, collapsing as the strike moves far away in either
 * direction or as σ grows. Zero when σ is not usable.
 */
export function expectedCentsPerDollar(dist: number, sigma: number): number {
  if (!(sigma > 0) || !Number.isFinite(dist)) return 0;
  const z = dist / sigma;
  return (100 * normPdf(z)) / sigma;
}

/** The YES move in cents that a given BTC move would normally produce. */
export function expectedYesMoveCents(dist: number, sigma: number, dSpot: number): number {
  if (!Number.isFinite(dSpot)) return 0;
  return round3(expectedCentsPerDollar(dist, sigma) * dSpot);
}

function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

export type Vel2Read = {
  /** Horizon measured, in seconds. */
  secs: number;
  /** BTC move over the horizon, in dollars. */
  d_spot: number;
  /** YES move over the horizon, in cents. */
  d_yes: number;
  /** What that BTC move should have done to YES, in cents. */
  expected_yes: number;
  /** Observed minus expected. The candidate dislocation. */
  residual: number;
  /** Sensitivity used, cents of YES per dollar of BTC. */
  cents_per_dollar: number;
  /** Standardised distance to strike at the start of the horizon. */
  z: number;
  /** True when the horizon had enough samples to measure at all. */
  ok: boolean;
};

const EMPTY: Vel2Read = {
  secs: 0,
  d_spot: 0,
  d_yes: 0,
  expected_yes: 0,
  residual: 0,
  cents_per_dollar: 0,
  z: 0,
  ok: false,
};

/**
 * One sample of the two series. `dist` and `sigma` are the window's state at
 * that moment, so the sensitivity is evaluated where the move actually started
 * rather than where it ended.
 */
export type Vel2Sample = {
  t: number;
  spot: number;
  yes: number;
  dist: number;
  sigma: number;
};

/** Samples at or before `now`, newest last. Never looks forward. */
function backward(samples: readonly Vel2Sample[], now: number, windowMs: number): Vel2Sample[] {
  return samples.filter((s) => s.t <= now && s.t >= now - windowMs);
}

/**
 * The residual over one horizon. Sensitivity is taken from the START of the
 * horizon: that is the state the market was in when the move began, and using
 * the end state would quietly let the outcome inform the expectation.
 */
export function vel2Residual(samples: readonly Vel2Sample[], now: number, secs: number): Vel2Read {
  const xs = backward(samples, now, secs * 1000);
  if (xs.length < 2) return { ...EMPTY, secs };
  const a = xs[0]!;
  const b = xs[xs.length - 1]!;
  const dSpot = b.spot - a.spot;
  const dYes = b.yes - a.yes;
  const cpd = expectedCentsPerDollar(a.dist, a.sigma);
  const expected = round3(cpd * dSpot);
  return {
    secs,
    d_spot: round3(dSpot),
    d_yes: round3(dYes),
    expected_yes: expected,
    residual: round3(dYes - expected),
    cents_per_dollar: round3(cpd),
    z: a.sigma > 0 ? round3(a.dist / a.sigma) : 0,
    ok: true,
  };
}

/** Which market moved first, or an honest admission that neither did. */
export type Leader = "SPOT" | "KALSHI" | "SIMULTANEOUS" | "NONE";

export type LeadLagRead = {
  leader: Leader;
  /** Samples into the window where spot first moved beyond its noise floor, or null. */
  spot_at: number | null;
  /** Same for the YES price. */
  yes_at: number | null;
  /** Noise floors used, so the verdict can be audited. */
  spot_floor: number;
  yes_floor: number;
};

/**
 * Which series moved first inside the window.
 *
 * Each series gets its own noise floor so the comparison is fair: BTC in dollars
 * and YES in cents are not the same units, and a floor of "one tick" in each is
 * the honest threshold. The first sample whose cumulative move from the window's
 * start exceeds that floor is when that series moved. Earlier index leads; the
 * same index is simultaneous at this resolution; neither crossing is NONE, which
 * is reported rather than defaulted to SPOT.
 */
export function leadLag(
  samples: readonly Vel2Sample[],
  now: number,
  secs: number,
  spotFloor: number,
  yesFloor = 0.5,
): LeadLagRead {
  const xs = backward(samples, now, secs * 1000);
  const base = { spot_floor: round3(spotFloor), yes_floor: round3(yesFloor) };
  if (xs.length < 2) return { leader: "NONE", spot_at: null, yes_at: null, ...base };
  const a = xs[0]!;
  let spotAt: number | null = null;
  let yesAt: number | null = null;
  for (let i = 1; i < xs.length; i++) {
    const s = xs[i]!;
    if (spotAt == null && Math.abs(s.spot - a.spot) >= spotFloor) spotAt = i;
    if (yesAt == null && Math.abs(s.yes - a.yes) >= yesFloor) yesAt = i;
    if (spotAt != null && yesAt != null) break;
  }
  let leader: Leader = "NONE";
  if (spotAt != null && yesAt != null) leader = spotAt < yesAt ? "SPOT" : yesAt < spotAt ? "KALSHI" : "SIMULTANEOUS";
  else if (spotAt != null) leader = "SPOT";
  else if (yesAt != null) leader = "KALSHI";
  return { leader, spot_at: spotAt, yes_at: yesAt, ...base };
}

/** The horizons the brief asks for, in seconds. */
export const VEL2_HORIZONS = [5, 15, 30, 60] as const;

export type Vel2Features = {
  h5: Vel2Read;
  h15: Vel2Read;
  h30: Vel2Read;
  h60: Vel2Read;
  /** Lead/lag over the 30s horizon, the middle one, where there is enough to see. */
  lead: LeadLagRead;
  /** Samples held. Low means the reads below are thin, not that the market is calm. */
  n: number;
};

/**
 * Every horizon at once, plus the lead/lag verdict. `spotFloor` should be the
 * caller's honest noise floor for BTC in dollars — a fraction of σ is a
 * reasonable choice, and it is passed in rather than guessed here.
 */
export function vel2Features(samples: readonly Vel2Sample[], now: number, spotFloor: number): Vel2Features {
  return {
    h5: vel2Residual(samples, now, 5),
    h15: vel2Residual(samples, now, 15),
    h30: vel2Residual(samples, now, 30),
    h60: vel2Residual(samples, now, 60),
    lead: leadLag(samples, now, 30, spotFloor),
    n: backward(samples, now, 60_000).length,
  };
}
