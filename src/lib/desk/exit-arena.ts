/**
 * The Exit Arena: what each frozen exit policy would have done to the position
 * the Chair actually took.
 *
 * SAME ENTRY, BY CONSTRUCTION. Every candidate is handed the one real paper fill
 * — the Chair's side, its price, its timestamp — rather than being allowed to
 * choose its own. That is not a rule enforced somewhere; it is the only entry
 * this module accepts. A window the Chair sat out produces no exit observation at
 * all, because there is nothing to exit.
 *
 * THE EXECUTABLE PRICE RULE, which is the whole integrity of this study.
 * A paper exit earns credit only at a price the position could genuinely have
 * been sold at:
 *
 *   holding UP (YES)  → the YES bid
 *   holding DOWN (NO) → 100 − the YES ask
 *
 * The second one deserves care, because it reads like the ask-substitution this
 * study forbids and is not. YES and NO sum to 100, so a buyer bidding X for NO is
 * the same order as a seller offering YES at 100 − X: the NO bid IS the complement
 * of the YES ask.
 *
 * THE WRONG TURN, NAMED, because someone will eventually try to "fix" this:
 *
 *   100 − yes_ask  =  the NO BID   ← what a NO holder can SELL into. Correct.
 *   100 − yes_bid  =  the NO ASK   ← what a NO buyer would PAY. Wrong here.
 *
 * Swapping to `100 − yes_bid` would price every DOWN exit at the wrong side of the
 * spread, in the flattering direction, and would look like a tidy-up. The test
 * `a DOWN holding is never priced off the NO ask` exists to fail that change.
 * Using the YES *bid* directly for a NO holding is the same error by another route.
 *
 * Nothing here uses a midpoint, a chart crossing, a later price applied
 * retroactively, or the ask on the side held. A point whose book is unusable is
 * not interpolated around: the observation is marked DATA_INVALID and counts
 * toward nothing.
 *
 * ELAPSED TIME, NOT ARRAY POSITION. The PROVE horizons are measured from the
 * entry timestamp against each sample's own timestamp. The replay series is
 * nominally every four seconds, but "nominally" is exactly how a desk ends up
 * calling six samples sixty seconds — so the horizon is never inferred from an
 * index.
 *
 * FEES. One fee at entry, matching the ledger's existing convention
 * (ev = settle − entry − takerFeeCents(entry)), because settlement is not a trade.
 * An exit that actually sells incurs a second fee. A position held to settlement
 * therefore pays one fee and an early exit pays two — which is part of what the
 * study is measuring, and why a candidate that scratches often must overcome its
 * own transaction cost.
 *
 * Pure module: no clock, no state, no database.
 */
import { takerFeeCents } from "./clock.ts";
import {
  EXIT_HOLD_V1,
  EXIT_PROVE120_V1,
  EXIT_PROVE180_V1,
  EXIT_PROVE240_V1,
  EXIT_TAKE90_V1,
  EXIT_TAKE90_V2,
  type Component,
} from "./floor-policy.ts";

export type Side = "UP" | "DOWN";

/** One replay sample, at an absolute instant. */
export type PricePoint = {
  /** Absolute ms. */
  t: number;
  yes_bid: number;
  yes_ask: number;
};

/** The paper fill every candidate is measured from. */
export type Entry = {
  side: Side;
  /** What the desk paid, in cents. */
  cents: number;
  /** Absolute ms the fill happened. */
  t: number;
};

export type ExitReason =
  /** Reached its target, then held to settlement. */
  | "PROVEN_HELD"
  /** Failed its target and sold at the first valid bid after the deadline. */
  | "DEADLINE"
  /** Hit a take-profit level. */
  | "TARGET"
  /** Never exited; settled. */
  | "SETTLEMENT"
  /** Could not be evaluated. Counts toward nothing. */
  | "DATA_INVALID";

export type Observation = {
  exit_cents: number | null;
  /** Absolute ms of the exit, null when the position settled. */
  exit_t: number | null;
  exit_reason: ExitReason;
  /** When the target was first met, for the PROVE family. */
  proven_at: number | null;
  secs_held: number | null;
  /** Best and worst the sellable bid got while the position was open, vs entry. */
  mfe_cents: number | null;
  mae_cents: number | null;
  /** Net paper cents after the fees actually incurred. */
  net_cents: number | null;
  /** True when the settlement favoured the side held. Independent of profit. */
  direction_right: boolean;
  data_invalid: boolean;
  invalid_why: string | null;
};

/**
 * The price the held side could be sold at, or null when the book cannot support
 * the question.
 *
 * Requires a two-sided, uncrossed book: a quote with a zero side, a 100 side, or
 * a bid above its ask is not a market anyone could trade against, and guessing
 * past it is how a study invents fills.
 */
export function sellableBid(side: Side, yes_bid: number, yes_ask: number): number | null {
  if (!Number.isFinite(yes_bid) || !Number.isFinite(yes_ask)) return null;
  if (!(yes_bid > 0) || !(yes_ask > 0)) return null;
  if (!(yes_bid < 100) || !(yes_ask < 100)) return null;
  if (yes_bid > yes_ask) return null; // crossed or locked: not tradeable
  // UP is held as YES and sold into the YES bid. DOWN is held as NO, whose bid is
  // the complement of the YES ask — the other side's own book, not a substitution.
  const px = side === "UP" ? yes_bid : 100 - yes_ask;
  return px > 0 && px < 100 ? px : null;
}

/** A usable sample: in the held interval, with a sellable price. */
type Usable = { t: number; px: number };

function usablePath(entry: Entry, path: readonly PricePoint[]): Usable[] {
  const out: Usable[] = [];
  for (const p of path) {
    if (!(p.t >= entry.t)) continue; // never price an exit before the fill existed
    const px = sellableBid(entry.side, p.yes_bid, p.yes_ask);
    if (px == null) continue;
    out.push({ t: p.t, px });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The settlement payoff for the side held. */
function payoff(side: Side, winner: Side): number {
  return side === winner ? 100 : 0;
}

const invalid = (why: string): Observation => ({
  exit_cents: null,
  exit_t: null,
  exit_reason: "DATA_INVALID",
  proven_at: null,
  secs_held: null,
  mfe_cents: null,
  mae_cents: null,
  net_cents: null,
  direction_right: false,
  data_invalid: true,
  invalid_why: why,
});

/**
 * Run one frozen exit policy against one real fill.
 *
 * `settleWinner` is the official settlement — the same value the ledger recorded,
 * never a price-derived guess.
 */
export function simulateExit(
  exit: Component,
  entry: Entry,
  path: readonly PricePoint[],
  settleWinner: Side,
): Observation {
  if (exit.kind !== "exit") return invalid(`${exit.id} is not an exit policy`);
  if (!(entry.cents > 0) || !(entry.cents < 100)) return invalid(`entry price ${entry.cents} unusable`);
  if (!Number.isFinite(entry.t)) return invalid("entry timestamp unusable");

  const pts = usablePath(entry, path);
  // HOLD needs no path to decide, but it still needs one to report excursions,
  // and a candidate compared against HOLD must be compared on the same windows.
  if (!pts.length) return invalid("no sellable price available after entry");

  const entryFee = takerFeeCents(entry.cents);
  const directionRight = entry.side === settleWinner;

  /** Settle the position: one fee, because settlement is not a trade. */
  const settled = (reason: "SETTLEMENT" | "PROVEN_HELD", provenAt: number | null, held: Usable[]): Observation => ({
    exit_cents: null,
    exit_t: null,
    exit_reason: reason,
    proven_at: provenAt,
    secs_held: null,
    ...excursions(held, entry.cents),
    net_cents: r1(payoff(entry.side, settleWinner) - entry.cents - entryFee),
    direction_right: directionRight,
    data_invalid: false,
    invalid_why: null,
  });

  /** Sell: two fees, entry and exit. */
  const sold = (at: Usable, reason: "DEADLINE" | "TARGET", provenAt: number | null, held: Usable[]): Observation => ({
    exit_cents: at.px,
    exit_t: at.t,
    exit_reason: reason,
    proven_at: provenAt,
    secs_held: r1((at.t - entry.t) / 1000),
    ...excursions(held, entry.cents),
    net_cents: r1(at.px - entry.cents - entryFee - takerFeeCents(at.px)),
    direction_right: directionRight,
    data_invalid: false,
    invalid_why: null,
  });

  if (exit.id === EXIT_HOLD_V1.id) return settled("SETTLEMENT", null, pts);

  if (exit.id === EXIT_TAKE90_V1.id || exit.id === EXIT_TAKE90_V2.id) {
    const take = Number(exit.params.take_cents);
    const hit = pts.find((p) => {
      if (p.px < take) return false;
      if (exit.id === EXIT_TAKE90_V1.id) return true; // preserve the frozen comparator
      // Use the same rounded net and both fees that sold() will record.
      const net = r1(p.px - entry.cents - entryFee - takerFeeCents(p.px));
      return net > Number(exit.params.min_net_cents);
    });
    if (!hit) return settled("SETTLEMENT", null, pts);
    return sold(hit, "TARGET", null, pts.filter((p) => p.t <= hit.t));
  }

  // The PROVE family.
  const target = entry.cents + Number(exit.params.target_cents);
  const horizonMs = Number(exit.params.horizon_s) * 1000;
  if (!(horizonMs > 0)) return invalid(`${exit.id} has no usable horizon`);
  const deadline = entry.t + horizonMs;

  // Proof must happen at or before the deadline, on elapsed time.
  const proof = pts.find((p) => p.t <= deadline && p.px >= target);
  if (proof) return settled("PROVEN_HELD", proof.t, pts);

  // Not proven. Exit at the FIRST valid bid at or after the deadline. If the
  // window ended before one existed, the position settles — inventing a fill at
  // the deadline's theoretical price is exactly what this study must not do.
  const after = pts.find((p) => p.t >= deadline);
  if (!after) return settled("SETTLEMENT", null, pts);
  return sold(after, "DEADLINE", null, pts.filter((p) => p.t <= after.t));
}

/** Best and worst the sellable bid reached while the position was open. */
function excursions(held: readonly Usable[], entryCents: number): { mfe_cents: number | null; mae_cents: number | null } {
  if (!held.length) return { mfe_cents: null, mae_cents: null };
  let hi = held[0]!.px;
  let lo = held[0]!.px;
  for (const p of held) {
    if (p.px > hi) hi = p.px;
    if (p.px < lo) lo = p.px;
  }
  return { mfe_cents: r1(hi - entryCents), mae_cents: r1(lo - entryCents) };
}

/** Every registered exit policy against one fill, control first. */
export function runArena(
  exits: readonly Component[],
  entry: Entry,
  path: readonly PricePoint[],
  settleWinner: Side,
): { exit: Component; obs: Observation }[] {
  return exits.map((exit) => ({ exit, obs: simulateExit(exit, entry, path, settleWinner) }));
}

/**
 * The replay series as absolute-timestamped price points.
 *
 * `cols.t` is seconds from `cols.t0`, which is milliseconds. Converting here, once,
 * keeps the arena working in one unit and keeps the horizon arithmetic away from
 * array indices.
 */
export function pointsFromReplay(cols: {
  t0: number;
  t: readonly number[];
  yes_bid: readonly number[];
  yes_ask: readonly number[];
}): PricePoint[] {
  const out: PricePoint[] = [];
  const n = Math.min(cols.t.length, cols.yes_bid.length, cols.yes_ask.length);
  for (let i = 0; i < n; i++) {
    const off = Number(cols.t[i]);
    if (!Number.isFinite(off)) continue;
    out.push({ t: cols.t0 + off * 1000, yes_bid: Number(cols.yes_bid[i]), yes_ask: Number(cols.yes_ask[i]) });
  }
  return out;
}

/** The PROVE/TAKE challengers, for callers that want them without the control. */
export const CHALLENGER_EXITS: readonly Component[] = Object.freeze([
  EXIT_PROVE120_V1,
  EXIT_PROVE180_V1,
  EXIT_PROVE240_V1,
  EXIT_TAKE90_V1,
  EXIT_TAKE90_V2,
]);
