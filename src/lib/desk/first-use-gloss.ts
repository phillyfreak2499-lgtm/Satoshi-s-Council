import type { Gloss } from "./glossary";

/** First-use definitions for the jargon external audits flagged on the public rooms. */
export const FIRST_USE: Record<string, Gloss> = {
  "term.window": {
    title: "Window",
    body: "One 15-minute Bitcoin contract. The desk reads it live, then grades the official result when the window closes. The next window starts immediately.",
  },
  "term.chair": {
    title: "Chair",
    body: "SATOSHI — the one voice that turns specialist seats into a single paper call: UP, DOWN, or WAIT. Seats advise. The Chair decides.",
  },
  "term.paper-fill": {
    title: "Paper fill",
    body: "A recorded paper position at the ask plus Kalshi's fee. It stays on the books until the official settlement. A lean without a fill is not a trade.",
  },
  "term.directional-read": {
    title: "Directional read",
    body: "The Chair currently leans UP or DOWN. That is not the same as a paper fill: the book still has to clear price, fee, floor, and safety rules before anything is recorded.",
  },
  "term.sat": {
    title: "Sat",
    body: "The Chair took no paper position in that window. Sitting is a decision. It is not an outage and it is not a missed trade.",
  },
  "term.wait": {
    title: "WAIT",
    body: "The call when no seat has a directional read strong enough to speak, or a live rule blocks a new fill. WAIT is recorded. It is not an outage.",
  },
  "term.confluence": {
    title: "Confluence",
    body: "How far the Chair's score cleared its bar on the windows that filled — not just that it cleared. A high number means the seats agreed hard enough to pay the ask.",
  },
  "term.sit-mass": {
    title: "Sit-mass",
    body: "How much of the floor is sitting versus speaking a direction. More sit-mass raises the bar the Chair needs before it will book a paper fill.",
  },
  "term.gold": {
    title: "GOLD",
    body: "A seat flag. That specialist's mid-sample hit rate and paper cents both look strong. It is a grade on the seat, not a live buy signal.",
  },
  "term.sweep": {
    title: "SWEEP",
    body: "Pit-crew grader. Once a day it reads every seat from receipts and raises flags. SWEEP does not vote and does not trade.",
  },
  "term.brier": {
    title: "Brier",
    body: "A proper score for probability calls: mean squared error against the official 0/1 result. Lower is better. Used in the lab to compare a model with the market, never as a live order.",
  },
};

export function firstUseOf(key: string): Gloss | null {
  return FIRST_USE[key] ?? null;
}
