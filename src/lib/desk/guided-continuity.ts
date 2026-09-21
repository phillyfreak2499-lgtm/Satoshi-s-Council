/**
 * Guided Floor continuity — two plain-language read models. Pure. Authority: NONE.
 *
 * The Guided Floor already says what the Council decided. These two answer the
 * questions a beginner asks next, and they are the whole of this module:
 *
 *   whatWouldChange  — "what would change the decision?", from the Chair's own
 *                      gate state while the window is live.
 *   whatHappened     — "what happened?", from the recorded result once a window
 *                      has settled, so the site reads as one continuous thing
 *                      rather than a series of unrelated moments.
 *
 * WHAT THIS MODULE IS NOT ALLOWED TO DO, and why each rule exists:
 *
 *  - It never invents a condition. Every line traces to a recorded field: a
 *    failing hard gate, `chair.invalidate_if`, `chair.quorum`, or a settled
 *    `BooksWindow`. A beginner cannot tell an invented reason from a real one,
 *    which is exactly why inventing one is worse here than on the Pro Floor.
 *  - It never promises that clearing one condition produces a call. The desk
 *    applies every gate AND the bar, so "it just needs X" is false whenever
 *    anything else is also short — `whyFacts.more_than_one_thing_missing` is
 *    the Chair's own answer to that, and it is carried through verbatim.
 *  - It never turns gate confidence into a win probability, and never says
 *    what WILL happen.
 *  - It sets no thresholds of its own. There is not a single number comparison
 *    in this file that is not already decided upstream.
 *  - It writes nothing. No Chair, seat, learner, booking, grading or
 *    settlement state is reachable from here, in either direction.
 *
 * Presentation only. Paper research. No live orders.
 */
import type { BooksWindow } from "./books.ts";
import type { ChairResult, Gate } from "./types.ts";
import { invalidateCondition, whyFacts, type WhyFacts } from "./floor-clarity.ts";
import { fmtCents, readStamp } from "./record.ts";

// ---------------------------------------------------------------------------
// B — "What would change the decision?"
// ---------------------------------------------------------------------------

/**
 * The beginner phrasing for each hard gate the Chair publishes.
 *
 * These are deliberately the SAME words the Guided read already uses for the
 * same gate ids, so the two cards on one page cannot describe one condition two
 * different ways. Each line says what would have to improve — never what would
 * follow if it did.
 *
 * A gate id with no entry here is not guessed at: `conditionFor` falls back to
 * the Chair's own gate label, which is recorded text rather than our invention.
 */
const GATE_CONDITION: Readonly<Record<string, string>> = Object.freeze({
  warden: "The desk's data sources need to pass their freshness check.",
  semantic: "The desk's data sources need to pass their freshness check.",
  seq: "The market feed needs to arrive in order again.",
  derivs: "The derivatives feed needs to come back.",
  quote: "The Council is waiting for a fresher market price.",
  leftover: "The two sides of the market need to add up cleanly again.",
  chalk: "One side is already priced so high that there is almost no gain left to buy.",
  edge: "The current price leaves too little room after costs.",
  spread: "The gap between the buying and selling price needs to narrow.",
  law: "A temporary safety pause after recent misses needs to end.",
  early: "More of this 15-minute window needs to pass.",
  late: "This window is nearly over; the Council would rather wait for the next one.",
  quiet: "The market is too quiet right now and needs to move more.",
  top3: "The leading specialists need to agree more than they do now.",
  bar: "The evidence score still needs to clear the Council's required bar.",
});

/** What one failing gate would need, in a beginner's words. */
export function conditionFor(gate: Gate): string {
  const known = GATE_CONDITION[gate.id];
  if (known) return known;
  // Not a gate we have plain wording for: quote the Chair's own recorded label
  // rather than describing a condition we do not actually know.
  const label = String(gate.label ?? "").trim();
  return label ? `A desk condition is not met yet: ${label}.` : "A desk condition is not met yet.";
}

/** The sentence the brief requires whenever more than one thing is short. */
export const MULTI_BLOCKER_LINE =
  "More than one condition still needs to improve before the Council would act.";

export type WhatWouldChange = {
  /** "WAIT" while the Council is waiting, otherwise the side it currently reads. */
  stance: "WAIT" | "UP" | "DOWN";
  /** Plain conditions that would have to improve. Empty when nothing is recorded as short. */
  conditions: string[];
  /** True when the Chair's own state says more than one thing is missing. */
  multiple: boolean;
  /** What currently supports a directional read. Empty while waiting. */
  supports: string[];
  /** The recorded condition that would END a directional read, or "". */
  invalidate: string;
  /**
   * The closing line. It always refuses the "clear this one and it calls"
   * reading, because that is the single most tempting wrong conclusion here.
   */
  closing: string;
};

/**
 * What would change the decision, entirely from the Chair's current state.
 *
 * THE SOURCE OF TRUTH IS `whyFacts`, NOT THIS FILE. It already computes which
 * hard gates fail, whether the score is short as well, and its own
 * `more_than_one_thing_missing` flag. Recomputing any of that here would create
 * a second opinion that could drift from the one the Pro Floor shows, and the
 * two floors are supposed to be the same desk seen at two levels of detail.
 */
export function whatWouldChange(chair: ChairResult, plain: string): WhatWouldChange {
  const w: WhyFacts = whyFacts(chair, plain);
  const stance: WhatWouldChange["stance"] = chair.lean === "UP" || chair.lean === "DOWN" ? chair.lean : "WAIT";
  const invalidate = invalidateCondition(w.invalidate_if);

  if (stance !== "WAIT") {
    // A directional read: say what holds it up, and what would end it. The
    // quorum counts are recorded state, not a probability and not a forecast.
    const supports: string[] = [];
    const up = w.quorum.up ?? 0;
    const down = w.quorum.down ?? 0;
    const side = stance === "UP" ? up : down;
    const against = stance === "UP" ? down : up;
    if (side > 0) {
      supports.push(
        `${side} of the Council's specialists currently read ${stance}${against > 0 ? `, against ${against} the other way` : ""}.`,
      );
    }
    if (w.failed_hard.length === 0) {
      supports.push("Every hard condition the desk checks is currently passing.");
    }
    return {
      stance,
      // A directional read can still have a gate short — the desk may read a
      // side and decline to book it — so the failures are still listed.
      conditions: w.failed_hard.map(conditionFor),
      multiple: w.more_than_one_thing_missing,
      supports,
      invalidate,
      closing: invalidate
        ? "This is a live read on paper, not a prediction. It ends if that condition is met."
        : "This is a live read on paper, not a prediction. It can change while the window runs.",
    };
  }

  const conditions = w.failed_hard.map(conditionFor);
  // ONE GATE PLUS "more than one thing is missing" MEANS THE BAR IS THE OTHER
  // ONE. That flag is true when a second gate fails OR when the score is also
  // short, so with exactly one failing gate the second thing can only be the
  // bar. Naming it is a deduction from the Chair's own flag, not a new test —
  // and without it the card lists one condition and then says there is more
  // than one, which reads like a contradiction.
  if (conditions.length === 1 && w.more_than_one_thing_missing) {
    conditions.push(GATE_CONDITION.bar);
  }
  // No hard gate is failing, so the Chair is short on agreement or on price —
  // its own `wait_reason` says which, and there is no third possibility to guess at.
  if (conditions.length === 0) {
    if (w.wait_reason === "no-edge") {
      conditions.push("The current price leaves too little room after costs.");
    } else {
      conditions.push("The specialists do not agree strongly enough yet.");
      conditions.push("The evidence score still needs to clear the Council's required bar.");
    }
  }
  return {
    stance: "WAIT",
    conditions,
    multiple: w.more_than_one_thing_missing,
    supports: [],
    invalidate: "",
    closing:
      "Clearing any one of these would not by itself produce a call — every condition and the Council's bar still apply.",
  };
}

// ---------------------------------------------------------------------------
// C — "What happened?"
// ---------------------------------------------------------------------------

export type WhatHappened = {
  /** The window this describes, as a UTC stamp. */
  when: string;
  /** The paper position actually recorded: "none", or the side and its price. */
  position: string;
  /** Whether a paper position was recorded at all. */
  booked: boolean;
  /** The official settled side. */
  official: "UP" | "DOWN";
  /** The paper result in cents after fee, or null when nothing was booked or graded. */
  net: string | null;
  /** One line, built only from the four facts above. */
  lesson: string;
  /** The replay for this window, or the books when no ticker was recorded. */
  href: string;
  /** True when the recorded call's side matched the official result. */
  matched: boolean | null;
};

/**
 * The settled window, in four recorded facts and one sentence.
 *
 * NO HINDSIGHT IS MANUFACTURED. Everything here is read off the graded
 * `BooksWindow` the /books page already computes: the official winner, the
 * recorded paper call and its after-fee result. Nothing is recomputed, nothing
 * is re-graded, and no claim is made about what the desk "should" have done.
 *
 * THE COUNCIL'S READ IS NOT ASSERTED WHEN IT IS NOT RECORDED HERE. A booked
 * call carries its own side, so that side is the read. A window with no call
 * records no lean on this shape — the desk may have waited, or may have read a
 * side its own entry rules declined to book — so this says only the true thing,
 * that no paper position was recorded, and points at the replay where the
 * per-instant lean actually lives. Printing "WAIT" there would be a guess
 * dressed as a fact.
 *
 * Returns null when there is no graded window to describe, which is a missing
 * card rather than an empty one.
 */
export function whatHappened(last: BooksWindow | null | undefined): WhatHappened | null {
  if (!last || !Number.isFinite(Date.parse(last.close_time))) return null;
  if (last.winner !== "UP" && last.winner !== "DOWN") return null;

  const call = last.call;
  const booked = Boolean(call);
  const official = last.winner;
  const matched = call && call.lean ? call.lean === official : null;
  const graded = call != null && call.ev != null;

  const position = !call
    ? "none"
    : `${call.lean ?? "position"} at ${call.entry.toFixed(0)}¢`;
  const net = graded ? fmtCents(call.ev) : null;

  const lesson = (() => {
    if (!booked) {
      // The honest version: what is recorded is the absence of a position.
      return `No paper position was recorded for this window, and it settled ${official}. A window the desk sits out costs nothing and is still part of the record.`;
    }
    if (!graded) {
      return `A paper ${call?.lean ?? "position"} was recorded and the window settled ${official}. The after-fee result is not graded yet.`;
    }
    if (matched === true) {
      return `The paper ${call!.lean} call matched the official ${official} result, ${net} after the fee.`;
    }
    if (matched === false) {
      return `The paper ${call!.lean} call did not match the official ${official} result, ${net} after the fee.`;
    }
    return `A paper position was recorded and the window settled ${official}, ${net} after the fee.`;
  })();

  return {
    when: readStamp(last.close_time),
    position,
    booked,
    official,
    net,
    lesson,
    href: last.ticker ? `/window/${encodeURIComponent(last.ticker)}` : "/books",
    matched,
  };
}

// ---------------------------------------------------------------------------
// E — the shareable window line
// ---------------------------------------------------------------------------

export const SHARE_FOOTER = "Paper only. No live orders.";

/**
 * One window as plain text someone can paste anywhere.
 *
 * EVERY LINE IS A RECORDED FIELD. There is no performance claim, no streak, no
 * "we called it" — a share format that flatters the desk would quietly become a
 * reason to publish the flattering windows and not the others, and the record is
 * the product here. `read` is passed in by the caller from the recorded lean it
 * already holds, and is omitted entirely when it has none.
 */
export function shareWindowText(input: {
  ticker: string;
  close_time: string;
  read: "UP" | "DOWN" | "WAIT" | null;
  call: { lean: "UP" | "DOWN" | null; entry: number; ev: number | null } | null;
  winner: "UP" | "DOWN" | null;
  why: string | null;
  origin?: string;
}): string {
  const site = (input.origin ?? "").replace(/\/+$/, "");
  const lines = [
    "Satoshi's Council · Bitcoin 15-minute paper research",
    "",
    `Window: ${readStamp(input.close_time)}`,
  ];
  if (input.read) lines.push(`SATOSHI: ${input.read}`);
  lines.push(
    `Paper position: ${input.call ? `${input.call.lean ?? "position"} at ${input.call.entry.toFixed(0)}¢` : "none"}`,
  );
  lines.push(`Official result: ${input.winner ?? "not settled yet"}`);
  if (input.call && input.call.ev != null) lines.push(`Paper net: ${fmtCents(input.call.ev)}`);
  const why = (input.why ?? "").trim();
  if (why) lines.push(`Why: ${why}`);
  lines.push("", SHARE_FOOTER);
  if (input.ticker) lines.push(`${site}/window/${encodeURIComponent(input.ticker)}`);
  return lines.join("\n");
}
