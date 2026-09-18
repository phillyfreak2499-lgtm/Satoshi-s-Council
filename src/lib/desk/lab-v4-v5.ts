/**
 * LAB V4/V5 pure policies.
 *
 * V4 answers one deliberately narrow question: what happens if abstention is
 * removed from the directional research path? There is no confidence, price,
 * quorum or edge threshold. It watches the same probability stream, locks after
 * a stable local peak stops improving, and is forced to choose at the deadline.
 *
 * V5 answers a different question: can the same probability stream make paper
 * money by entering/exiting/flipping inside the window? It has no directional
 * participation quota. It acts only when the next action has strictly better
 * expected terminal value after the executable spread and taker fees.
 *
 * Pure module. No database, Chair, learner, paper book or order path.
 */
import { takerFeeCents } from "./clock.ts";

export type Direction = "UP" | "DOWN";

export const V4_TIMING_VERSION = "V4_FORCED_DIRECTION_V1";
export const V5_POLICY_VERSION = "V5_PROFIT_HUNTER_V1";
export const V4_FRAME_SECONDS = 15;
export const V4_STABLE_MS = 20_000;
export const V4_PLATEAU_MS = 20_000;
export const V4_MIN_OBSERVATIONS = 4;
export const V4_DEADLINE_SECONDS = 20;

export type ForcedTimingState = {
  seen: number;
  side: Direction | null;
  side_since: number;
  best_certainty: number;
  best_at: number;
};

export type ForcedTimingStep = {
  state: ForcedTimingState;
  side: Direction;
  certainty: number;
  lock: boolean;
  reason: "STABLE_PEAK" | "DEADLINE" | null;
};

export function emptyForcedTiming(): ForcedTimingState {
  return { seen: 0, side: null, side_since: 0, best_certainty: -1, best_at: 0 };
}

export function forcedSide(pUp: number, previous: Direction | null = null): Direction {
  const p = Number.isFinite(pUp) ? Math.max(0, Math.min(1, pUp)) : 0.5;
  if (p > 0.5) return "UP";
  if (p < 0.5) return "DOWN";
  return previous ?? "UP";
}

/**
 * Timing is intentionally NOT a confidence gate. 50.01% and 99% obey the same
 * rule. A call locks after the chosen side has remained stable and directional
 * certainty has stopped setting a new local high; otherwise the final deadline
 * forces the current side. All inputs are known at this instant.
 */
export function stepForcedTiming(
  prior: ForcedTimingState,
  pUp: number,
  atMs: number,
  secsLeft: number,
): ForcedTimingStep {
  const at = Number.isFinite(atMs) ? atMs : 0;
  const side = forcedSide(pUp, prior.side);
  const certainty = Math.abs(Math.max(0, Math.min(1, Number.isFinite(pUp) ? pUp : 0.5)) - 0.5);

  const changed = prior.side !== side;
  const sideSince = changed || prior.seen === 0 ? at : prior.side_since;
  const improved = certainty > prior.best_certainty + 1e-12;
  const bestAt = improved || changed || prior.seen === 0 ? at : prior.best_at;
  const bestCertainty = changed ? certainty : improved ? certainty : Math.max(prior.best_certainty, certainty);
  const state: ForcedTimingState = {
    seen: prior.seen + 1,
    side,
    side_since: sideSince,
    best_certainty: bestCertainty,
    best_at: bestAt,
  };

  const deadline = Number.isFinite(secsLeft) && secsLeft <= V4_DEADLINE_SECONDS;
  const stable =
    state.seen >= V4_MIN_OBSERVATIONS &&
    at - state.side_since >= V4_STABLE_MS &&
    at - state.best_at >= V4_PLATEAU_MS;

  return {
    state,
    side,
    certainty,
    lock: deadline || stable,
    reason: deadline ? "DEADLINE" : stable ? "STABLE_PEAK" : null,
  };
}

export type ProfitPosition = Direction | null;
export type ExecutableQuotes = {
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
};

export type ProfitDecision =
  | { action: "HOLD"; from_side: Direction; to_side: Direction; expected_gain_cents: 0; reason: string }
  | { action: "NONE"; from_side: null; to_side: null; expected_gain_cents: 0; reason: string }
  | {
      action: "ENTER" | "EXIT" | "FLIP";
      from_side: Direction | null;
      to_side: Direction | null;
      sell_cents: number | null;
      buy_cents: number | null;
      fees_cents: number;
      cashflow_cents: number;
      expected_gain_cents: number;
      reason: string;
    };

function validPrice(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

function probability(p: number): number {
  return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0.5;
}

function pSide(side: Direction, pUp: number): number {
  const p = probability(pUp);
  return side === "UP" ? p : 1 - p;
}

function askOf(side: Direction, q: ExecutableQuotes): number | null {
  return validPrice(side === "UP" ? q.yes_ask : q.no_ask);
}

function bidOf(side: Direction, q: ExecutableQuotes): number | null {
  return validPrice(side === "UP" ? q.yes_bid : q.no_bid);
}

function opposite(side: Direction): Direction {
  return side === "UP" ? "DOWN" : "UP";
}

function round(n: number, d = 6): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

/**
 * One-contract, long-only paper policy. No arbitrary edge hurdle: positive
 * expected gain after the actual executable prices and fees is sufficient.
 *
 * With a position, HOLD is the expected settlement value from now. EXIT compares
 * the executable bid after the exit fee with that value. FLIP compares selling
 * the current side plus buying the opposite side with simply continuing to hold.
 */
export function profitDecision(
  position: ProfitPosition,
  pUp: number,
  q: ExecutableQuotes,
): ProfitDecision {
  const enter = (side: Direction) => {
    const ask = askOf(side, q);
    if (ask == null) return null;
    const fee = takerFeeCents(ask);
    const value = pSide(side, pUp) * 100;
    return { side, ask, fee, edge: value - ask - fee };
  };

  if (position == null) {
    const candidates = [enter("UP"), enter("DOWN")]
      .filter((x): x is NonNullable<ReturnType<typeof enter>> => Boolean(x))
      .sort((a, b) => b.edge - a.edge);
    const best = candidates[0];
    if (!best || !(best.edge > 0)) {
      return { action: "NONE", from_side: null, to_side: null, expected_gain_cents: 0, reason: "no positive expected entry after spread and fee" };
    }
    return {
      action: "ENTER",
      from_side: null,
      to_side: best.side,
      sell_cents: null,
      buy_cents: best.ask,
      fees_cents: best.fee,
      cashflow_cents: round(-best.ask - best.fee),
      expected_gain_cents: round(best.edge),
      reason: `${best.side} has the larger positive expected settlement edge after executable ask + fee`,
    };
  }

  const heldBid = bidOf(position, q);
  if (heldBid == null) {
    return { action: "HOLD", from_side: position, to_side: position, expected_gain_cents: 0, reason: "held side has no executable bid" };
  }
  const exitFee = takerFeeCents(heldBid);
  const exitValue = heldBid - exitFee;
  const holdValue = pSide(position, pUp) * 100;
  const other = opposite(position);
  const otherEntry = enter(other);

  if (otherEntry) {
    const flipValue = exitValue + otherEntry.edge;
    if (flipValue > holdValue + 1e-9) {
      return {
        action: "FLIP",
        from_side: position,
        to_side: other,
        sell_cents: heldBid,
        buy_cents: otherEntry.ask,
        fees_cents: round(exitFee + otherEntry.fee),
        cashflow_cents: round(heldBid - exitFee - otherEntry.ask - otherEntry.fee),
        expected_gain_cents: round(flipValue - holdValue),
        reason: `sell ${position} and buy ${other}: higher expected terminal value after both fees`,
      };
    }
  }

  if (exitValue > holdValue + 1e-9) {
    return {
      action: "EXIT",
      from_side: position,
      to_side: null,
      sell_cents: heldBid,
      buy_cents: null,
      fees_cents: round(exitFee),
      cashflow_cents: round(heldBid - exitFee),
      expected_gain_cents: round(exitValue - holdValue),
      reason: `executable ${position} exit is worth more now than expected settlement value`,
    };
  }

  return { action: "HOLD", from_side: position, to_side: position, expected_gain_cents: 0, reason: "holding has the best expected terminal value" };
}
