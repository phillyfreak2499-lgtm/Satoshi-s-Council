/**
 * Directional Lean — one seat's research direction and intensity on a 0–100
 * scale, for people who follow a specialist even while SATOSHI waits.
 *
 * WHAT IT IS. A display transform of the seat's OWN read as the vote pipeline
 * already retains it: `raw_lean` (the side the seat saw before the whisper
 * filter) and `raw_conf` (its untransformed strength, 0–92 by `directionalConf`).
 * Both are carried on every vote by `sitUnlessSure` in bots.ts, so a read the
 * Chair never heard is still on the frame and can be shown as research context.
 * A lean is computed ONLY when the frame genuinely retained both raw fields
 * (`raw_retained` on the seat fact). Nothing is rebuilt from the final vote or
 * its confidence, nothing is inferred from paper or shadow metadata, and a
 * missing strength is never read as zero: a partial or legacy frame is NO READ.
 *
 * WHAT IT IS NOT. Not a probability, not a win chance, not SATOSHI's verdict and
 * not a paper position. It decides nothing, weighs nothing, and never feeds the
 * Chair, the book, the learner or any gate. Pure: same fact in, same lean out;
 * no clock, no database, no network, no mutation of its input.
 *
 * THE MAPPING, in full:
 *   UP   with strength s → 50 + s / 2
 *   DOWN with strength s → 50 − s / 2
 *   WAIT                 → 50 (NEUTRAL: the seat itself read no direction)
 *   no read on the frame → null (NO READ: a DOWN feed silenced the seat, or the
 *                          frame did not retain both raw fields)
 * with s / 2 rounded to a whole number first, then clamped to 0–100. Equal strengths on
 * opposite sides mirror around 50. A mirror of `raw_conf`, nothing more.
 *
 * STATUS comes from the pro-floor voice (the pipeline's own precedence): a seat
 * is an authorized speaker only when its final voice is directional AND the
 * frame carries the Chair row that aggregated it (`aggregated`). A directional
 * vote with no Chair row yet is RESEARCH READ, never SPEAKING, because nothing
 * on the frame proves SATOSHI heard it. Everything else is research only, and
 * the status says which reason the frame proves. A STALE feed is flagged
 * beside the read, never hidden.
 *
 * WINDOWS. A lean is stamped with the window it was read in. Nothing carries
 * across a ticker or close-time change: the caller rebuilds from the current
 * frame, and `leanIsCurrent` refuses a lean stamped for another window.
 */
import type { SeatFact } from "./pro-floor.ts";
import type { Lean, SeatId } from "./types.ts";

export const DIRECTIONAL_LEAN_LABEL = "DIRECTIONAL LEAN";
export const DIRECTIONAL_LEAN_DISCLAIMER =
  "Directional Lean shows research direction and intensity. It is not a probability and not a SATOSHI call.";
export const RESEARCH_ONLY_LINE = "Research only — SATOSHI did not hear this vote.";
export const LEAN_MIN = 0;
export const LEAN_MAX = 100;
export const LEAN_CENTER = 50;

export type LeanDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "NO_READ";

/** Truthful seat states, each one the frame can prove. */
export type SeatLeanStatus =
  | "SPEAKING"
  | "RESEARCH READ"
  | "BELOW BAR"
  | "SUPPRESSED"
  | "SHADOW"
  | "BENCH"
  | "MUTED"
  | "VETO"
  | "RETIRED"
  | "NON-VOTER"
  | "DOWN"
  | "SIT";

export type LeanWindow = { ticker: string; close_time: number; as_of: number };

export type SeatLean = {
  seat: SeatId;
  callsign: string;
  /** 0 strongly bearish · 50 neutral · 100 strongly bullish. Null when there is no read. */
  score: number | null;
  direction: LeanDirection;
  /** The seat's own side as the frame retains it. Null when the frame has no raw read. */
  researchSide: Lean | null;
  /** The seat's own untransformed strength the score was mirrored from. */
  sourceStrength: number | null;
  status: SeatLeanStatus;
  /** Plain-English status for the Guided Floor. */
  statusPlain: string;
  /** True only when the Chair aggregated this seat's directional vote on this frame. */
  isAuthorizedSpeaker: boolean;
  /** The feed under the seat is STALE. The read is shown, the warning beside it. */
  stale: boolean;
  /** What the Chair actually heard from this seat. Never merged with the research side. */
  heardLean: Lean;
  /** The seat's own one-line reason, when the frame carries one. */
  reason: string;
  /** The rule card behind the read, when there is one. */
  skillId: string | null;
  window: LeanWindow;
  disclaimer: typeof DIRECTIONAL_LEAN_DISCLAIMER;
};

const STATUS_PLAIN: Readonly<Record<SeatLeanStatus, string>> = Object.freeze({
  SPEAKING: "SATOSHI heard this read.",
  "RESEARCH READ": "Directional read on the frame. No Chair row yet, so SATOSHI has not aggregated it.",
  "BELOW BAR": RESEARCH_ONLY_LINE,
  SUPPRESSED: RESEARCH_ONLY_LINE,
  SHADOW: "Shadow rule — research only, never a vote.",
  BENCH: "Benched — research only this window.",
  MUTED: "No authority this window — research only.",
  VETO: "Authority removed this window — research only.",
  RETIRED: "Retired seat — research only.",
  "NON-VOTER": "Pit crew — never a vote.",
  DOWN: "Feed down — no read this frame.",
  SIT: "Sitting — no direction read.",
});

function clampScore(n: number): number {
  return Math.min(LEAN_MAX, Math.max(LEAN_MIN, Math.round(n)));
}

/**
 * The one mapping. Exported so a test can pin it and a surface can never
 * re-derive it. Both inputs must be genuinely present: a side that is a Lean
 * and a finite strength. A missing strength is null, never zero.
 */
export function leanScore(side: Lean | null | undefined, strength: number | null | undefined): number | null {
  if (side !== "UP" && side !== "DOWN" && side !== "WAIT") return null;
  if (typeof strength !== "number" || !Number.isFinite(strength)) return null;
  if (side === "WAIT") return LEAN_CENTER;
  const s = Math.max(0, strength);
  // Round the half-offset once, then mirror it, so UP and DOWN at the same
  // strength sit the same distance from 50 (Math.round(49.5) is 50 but
  // Math.round(50.5) is 51, which would tilt odd strengths bullish).
  const offset = Math.round(s / 2);
  return clampScore(side === "UP" ? LEAN_CENTER + offset : LEAN_CENTER - offset);
}

export function leanDirection(score: number | null): LeanDirection {
  if (score == null) return "NO_READ";
  if (score > LEAN_CENTER) return "BULLISH";
  if (score < LEAN_CENTER) return "BEARISH";
  return "NEUTRAL";
}

function statusOf(fact: SeatFact): SeatLeanStatus {
  switch (fact.voice) {
    case "speaking":
      // A directional final voice is SPEAKING only with the Chair row that proves
      // the aggregation. Without the row the frame shows a read, not a hearing.
      return fact.aggregated === true ? "SPEAKING" : "RESEARCH READ";
    case "unhealthy":
      return "DOWN";
    case "benched":
      return "BENCH";
    case "muted":
      return "MUTED";
    case "vetoed":
      return "VETO";
    case "retired":
      return "RETIRED";
    case "non-voter":
      return "NON-VOTER";
    case "suppressed":
      if (fact.skill_status === "SHADOW") return "SHADOW";
      if (fact.skill_status === "BENCH") return "BENCH";
      return fact.suppression === "below-speak-bar" ? "BELOW BAR" : "SUPPRESSED";
    case "waiting":
    default:
      return "SIT";
  }
}

/**
 * The read model. Reads `fact` and `window`; writes nothing; returns a fresh object.
 * A DOWN feed is NO READ even if a stale raw field lingers, because `applyHealth`
 * silenced the seat before any read could stand.
 */
export function seatDirectionalLean(fact: SeatFact, window: LeanWindow): SeatLean {
  const silenced = fact.voice === "unhealthy" || fact.health === "DOWN";
  // Only what the frame genuinely retained: both raw fields, or nothing.
  const retained = !silenced && fact.raw_retained === true && typeof fact.raw_conf === "number" && Number.isFinite(fact.raw_conf)
    && (fact.raw_lean === "UP" || fact.raw_lean === "DOWN" || fact.raw_lean === "WAIT");
  const researchSide: Lean | null = retained ? fact.raw_lean : null;
  const sourceStrength = retained ? fact.raw_conf : null;
  const score = leanScore(researchSide, sourceStrength);
  const status = statusOf(fact);
  return {
    seat: fact.seat,
    callsign: fact.callsign,
    score,
    direction: leanDirection(score),
    researchSide,
    sourceStrength,
    status,
    statusPlain: STATUS_PLAIN[status],
    isAuthorizedSpeaker: fact.voice === "speaking" && fact.aggregated === true,
    stale: fact.health_warning === true,
    heardLean: fact.final_lean,
    reason: fact.why ?? "",
    skillId: fact.skill_used && fact.skill_used !== "SIT" ? fact.skill_used : null,
    window: { ticker: window.ticker, close_time: window.close_time, as_of: window.as_of },
    disclaimer: DIRECTIONAL_LEAN_DISCLAIMER,
  };
}

/** Every seat, from the facts the Pro Floor already built. Same order as the facts. */
export function seatDirectionalLeans(facts: readonly SeatFact[], window: LeanWindow): SeatLean[] {
  return facts.map((fact) => seatDirectionalLean(fact, window));
}

/** A lean belongs to exactly one window. Anything stamped for another is not current. */
export function leanIsCurrent(lean: Pick<SeatLean, "window">, now: Pick<LeanWindow, "ticker" | "close_time">): boolean {
  return lean.window.ticker === now.ticker && lean.window.close_time === now.close_time;
}

/** Guided wording for the direction. */
export const DIRECTION_WORD: Readonly<Record<LeanDirection, string>> = Object.freeze({
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  NO_READ: "No read",
});

/** Pro wording for the research side beside the number. */
export function researchReadWord(lean: Pick<SeatLean, "researchSide" | "direction">): "UP" | "DOWN" | "NEUTRAL" | "NO READ" {
  if (lean.direction === "NO_READ") return "NO READ";
  if (lean.researchSide === "UP") return "UP";
  if (lean.researchSide === "DOWN") return "DOWN";
  return "NEUTRAL";
}

/**
 * The accessible announcement without the seat name, for a parent element that
 * already names the seat (a labelled row button). One helper, so no surface
 * carries its own wording of the lean.
 */
export function leanAnnouncement(lean: Pick<SeatLean, "score" | "direction" | "researchSide" | "stale" | "statusPlain">): string {
  if (lean.score == null) return `no directional read. ${lean.statusPlain}`;
  const side = researchReadWord(lean);
  return `Directional Lean ${lean.score} of 100, ${DIRECTION_WORD[lean.direction].toLowerCase()}, research read ${side}${lean.stale ? ", stale feed" : ""}. ${lean.statusPlain}`;
}

/** One sentence for assistive tech and for a text-only fallback. */
export function leanValueText(lean: SeatLean): string {
  return `${lean.seat}: ${leanAnnouncement(lean)}`;
}

/**
 * Guided Floor display order: every directional read ranked by its strength
 * (distance from the neutral 50) whatever its status — a stronger research-only
 * read shows before a weaker SPEAKING one — then the neutral seats, then the
 * seats with no read. Ties break on the seat id so the order is deterministic.
 * Presentation order only: it changes no status, no authority and no score.
 */
export function guidedLeanOrder(a: SeatLean, b: SeatLean): number {
  const rank = (l: SeatLean) => (l.score != null && l.direction !== "NEUTRAL" ? 0 : l.score != null ? 1 : 2);
  const d = rank(a) - rank(b);
  if (d) return d;
  const strength = Math.abs((b.score ?? LEAN_CENTER) - LEAN_CENTER) - Math.abs((a.score ?? LEAN_CENTER) - LEAN_CENTER);
  if (strength) return strength;
  return a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0;
}

/** How many directional reads the Guided Floor shows before the rest fold; the strongest come first. */
export const GUIDED_LEAN_VISIBLE = 4;
/** The one line under the Guided heading while SATOSHI waits. */
export const GUIDED_WAITING_LEAD = "SATOSHI is waiting, but individual specialists may still have research leans.";

/** The compact label used wherever the lean is summarised in one line. */
export const LEAN_SUMMARY_LABEL = "Directional Lean";

/**
 * One line for a normal reader, beside (never instead of) the technical status.
 * Presentation only: it reads the lean the read model already produced and
 * decides nothing. The direction word is the research direction; "count" is
 * whether SATOSHI counted the read, which the status already proves. Only
 * BELOW BAR proves a strength reason; a plain SUPPRESSED read is one the frame
 * cannot explain, so its line names no reason.
 */
export function leanPlainLine(lean: Pick<SeatLean, "score" | "direction" | "status" | "stale">): string {
  const noRead = lean.score == null || lean.direction === "NEUTRAL";
  if (lean.status === "DOWN" || lean.status === "SIT" || noRead) return "No qualifying directional read right now.";
  const word = DIRECTION_WORD[lean.direction];
  const line =
    lean.status === "SPEAKING" ? `${word} read — SATOSHI counted it.`
    : lean.status === "BELOW BAR" ? `${word} read — not strong enough for SATOSHI to count.`
    : lean.status === "SUPPRESSED" ? `${word} read — SATOSHI did not count it.`
    : lean.status === "RESEARCH READ" ? "Directional research read — SATOSHI has not counted it."
    : `${word} research read — SATOSHI does not count this seat this window.`;
  return lean.stale ? `${line} Read exists, but the supporting feed is stale.` : line;
}

/** "Directional Lean: 37 · Bearish", or "Directional Lean: No read". Never a probability. */
export function leanSummaryText(lean: Pick<SeatLean, "score" | "direction">): string {
  return lean.score == null ? `${LEAN_SUMMARY_LABEL}: ${DIRECTION_WORD.NO_READ}` : `${LEAN_SUMMARY_LABEL}: ${lean.score} · ${DIRECTION_WORD[lean.direction]}`;
}

/**
 * The identity of one rendered meter: the complete window plus the seat. A
 * meter element keyed by this remounts on any ticker or close-time change, so
 * no marker ever slides from a previous window's value.
 */
export function leanKey(lean: Pick<SeatLean, "seat" | "window">): string {
  return `${lean.window.ticker}|${lean.window.close_time}|${lean.seat}`;
}
