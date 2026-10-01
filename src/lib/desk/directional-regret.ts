import { takerFeeCents } from "./clock.ts";
import type { ChairResult, Snapshot } from "./types";
export function regretObservation(
  snap: Snapshot,
  chair: ChairResult,
  reasons: readonly string[],
  booked: boolean,
) {
  if (
    snap.demo === true ||
    booked ||
    (chair.lean !== "UP" && chair.lean !== "DOWN") ||
    !snap.ticker ||
    !Number.isFinite(snap.as_of) ||
    !Number.isFinite(snap.close_time) ||
    snap.as_of >= snap.close_time
  )
    return null;
  const quote =
    chair.lean === "UP" ? (snap.yes_ask_exact ?? snap.yes_ask) : (snap.no_ask_exact ?? snap.no_ask);
  const ask = Number.isFinite(quote) && quote > 0 && quote < 100 ? quote : null;
  return {
    ticker: snap.ticker,
    close: snap.close_time,
    observed: snap.as_of,
    side: chair.lean,
    ask,
    fee: ask == null ? null : takerFeeCents(ask),
    evidence: {
      regime: snap.regime_key,
      feeds: snap.health,
      quote_receipt: snap.obs,
      quote_precision:
        (chair.lean === "UP" ? snap.yes_ask_exact : snap.no_ask_exact) != null
          ? "exact"
          : "snapshot",
      yes_ask: snap.yes_ask,
      no_ask: snap.no_ask,
      score: chair.score,
      bar: chair.bar,
      gates: chair.gates,
    },
    reasons: reasons.length ? [...reasons] : ["booking reason unavailable"],
  };
}
export function regretNet(side: string, ask: number, fee: number, winner: string) {
  return Math.round(((side === winner ? 100 : 0) - ask - fee) * 10) / 10;
}
export const REGRET_BANDS = [
  "<70¢",
  "70–79.9¢",
  "80–84.9¢",
  "85–89.9¢",
  "90–94.9¢",
  "95–99.9¢",
  "missing ask",
] as const;
export function regretBand(ask: number | null) {
  return ask == null
    ? REGRET_BANDS[6]
    : ask < 70
      ? REGRET_BANDS[0]
      : ask < 80
        ? REGRET_BANDS[1]
        : ask < 85
          ? REGRET_BANDS[2]
          : ask < 90
            ? REGRET_BANDS[3]
            : ask < 95
              ? REGRET_BANDS[4]
              : REGRET_BANDS[5];
}

/** An existing opposite-side position does not turn this read into a fill. */
export function directionAlreadyBooked(
  calls: readonly { ticker: string; close_time: number; lean: string }[],
  snap: Pick<Snapshot, "ticker" | "close_time">,
  chair: Pick<ChairResult, "lean">,
) {
  return calls.some(
    (r) => r.ticker === snap.ticker && r.close_time === snap.close_time && r.lean === chair.lean,
  );
}
