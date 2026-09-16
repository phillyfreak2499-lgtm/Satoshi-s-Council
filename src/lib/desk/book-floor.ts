/**
 * The chair's paper book has a price floor, and right now that floor is on a
 * trial.
 *
 * A read and a fill are two different things. The chair's UP / DOWN / WAIT on
 * the strip and the board is its opinion; a fill is the book paying an ask for
 * it. The book fills only at FLOOR_LIVE_CENTS or better. Under the floor the
 * read still shows, still grades every seat, still grades the chair's own hit
 * rate, and still lands in the ledger with no entry — so the floor can always
 * be revisited on data rather than on memory. Nothing is positioned, so a
 * later tick at the floor can still fill the same window.
 *
 * THIS IS A PRICE FLOOR, NOT A CONFIDENCE BAR. 80¢ means the contract costs
 * 80¢, not that the desk is 80% sure.
 *
 * WHY 70 BECAME 80, AND WHY IT IS A TRIAL. The 70¢ floor was set on 52 graded
 * calls: the 20 booked under 70¢ won 4 and lost 280¢, the 32 at 70¢ or better
 * won 28 and made +202¢. What the record since then shows is that the floor
 * did not go far enough. Across all calls to the trial, the 70–79¢ shelf won
 * 65.5% of 29 against the 74.3% it needed and lost 200¢, while 80¢ and up was
 * the only part of the book in profit. That is a hypothesis about where the
 * seats' reads are actually worth paying for, not a proven number — 29 calls
 * is thin, and a shelf can look bad for a week by luck. So the live floor
 * moves to 80¢ as a TIME-BOXED TRIAL, reviewed after three to seven days or
 * 25 live fills at the new floor, whichever comes first, and it is not to be
 * tuned again before that review.
 *
 * The trade the trial makes: win more often for a smaller prize each time. At
 * 80¢ a win pays about 18¢ after the fee and a loss costs about 81¢, so the
 * book needs roughly 82 wins in 100 to stand still — a higher bar than 70¢
 * asked for, bought with a much better hit rate. Whether that is the better
 * side of the trade is the question the trial answers.
 *
 * HOW TO REVERT. Set FLOOR_LIVE_CENTS back to 70. That is the whole revert:
 * one constant, one line. No other file hard-codes the live floor, and there
 * is no second booking engine to unwind.
 *
 * THE SHADOW BOOK. Every window in the trial is also counted at the old 70¢
 * floor, as research — what the book would have done had nothing changed.
 * That is a separate ledger, never the headline net, and it never gates a
 * fill. It exists so the trial can be judged against the thing it replaced on
 * the same windows rather than against a remembered version of it.
 *
 * Old fills are left exactly as they were booked. Nothing here rewrites a
 * historical grade or a past ledger row.
 */
import { takerFeeCents } from "./clock.ts";
import { markSide } from "./scalp.ts";
import type { CallLogRow, ChairResult, Lean, Snapshot } from "./types";

/**
 * The live floor: the only ask the paper book will pay. THE ONE CONSTANT TO
 * CHANGE — set it back to 70 to end the trial, and nothing else needs touching.
 */
export const FLOOR_LIVE_CENTS = 80;

/** The floor the shadow book keeps counting, so the trial has something to beat. */
export const FLOOR_SHADOW_CENTS = 70;

/**
 * When the live floor became FLOOR_LIVE_CENTS. Fills before this moment were
 * booked under the old floor and stay exactly as they were; only windows
 * closing from here on are played by the new one, which is what makes the
 * trial's record separable from the record that motivated it.
 */
export const FLOOR_LIVE_SINCE = "2026-09-10T23:00:00.000Z";

/**
 * When the 70¢ floor itself went live: the merge that shipped it, 2026-09-08
 * 20:47 UTC. The last fill under 70¢ closed at 19:45 UTC that day and the
 * first floored window closed at 22:00 UTC. The books still split the record
 * here; nothing decides on it.
 */
export const CHAIR_FLOOR_SINCE_ISO = "2026-09-08T20:47:00.000Z";

/**
 * The floor as the rest of the desk has always named it. Kept as an alias of
 * the live floor so every label, digest line and tooltip follows the trial
 * without 80 being scattered anywhere.
 */
export const CHAIR_MIN_ASK_CENTS = FLOOR_LIVE_CENTS;

/**
 * Minimum speaking seats on the booked side at the tick the book pays.
 * A price floor is not a team. 1–1 and empty-floor books are how 7:15 / 7:30 /
 * 7:50 printed this morning.
 */
export const BOOK_MIN_SPEAKING = 2;

/** A real, payable price: a fill has to be a price, not a certainty or a hole. */
function realAsk(cents: number): boolean {
  return Number.isFinite(cents) && cents > 0 && cents < 100;
}

/** A paper fill is allowed at this ask: at or above the LIVE floor, and a real price. */
export function bookable(cents: number): boolean {
  return realAsk(cents) && cents >= FLOOR_LIVE_CENTS;
}

/**
 * Would the old floor have booked this ask? Research only — the shadow book
 * reads it to count what 70¢ would have done on the same windows. Never call
 * this to decide a fill; `bookable` is the only gate on the live book.
 */
export function bookableShadow(cents: number): boolean {
  return realAsk(cents) && cents >= FLOOR_SHADOW_CENTS;
}

/**
 * The paper book's final edge guard (S2-10).
 *
 * A paper fill — the live book AND its 70¢ shadow, which differ ONLY by the price
 * floor — may be recorded only when the CURRENT snapshot edge for the side being
 * booked, after fees, is finite and strictly positive. The side edge is exactly the
 * `snap.edge_up` / `snap.edge_down` the Chair's own edge gate reads (chair.ts); this
 * re-asserts that one economic test at the book boundary, because a post-stick lean
 * (server-engine `decideChair` → `stickLean`, which is not edge-aware) can deliver a
 * side the current edge gate had already turned to WAIT — a stale/sticky lean then
 * reaching the book after the edge check failed. Receipt that proved it:
 * KXBTC15M-26SEP110445-45 booked UP at 80¢ with fair 80.4 and fee 2, edge_up -1.6.
 *
 * This reads no fair and no fee of its own — no second edge formula — and decides
 * nothing about direction, size, or the Chair's displayed read. Fail closed: a
 * non-finite edge blocks the fill. It is a BOOKING invariant, not a Chair rewrite.
 */
export function paperBookEdgeOk(
  snap: Pick<Snapshot, "edge_up" | "edge_down">,
  lean: "UP" | "DOWN",
): boolean {
  const edge = lean === "UP" ? snap.edge_up : snap.edge_down;
  return Number.isFinite(edge) && edge > 0;
}

/**
 * The paper book's team guard (S2-11).
 *
 * A sticky chair lean (`holdScore` keeps UP at 35% of the bar; `stickLean` holds
 * the last shown side for 12s) can still be UP after every seat has sat. The 80¢
 * price floor then pays that lean. Receipts:
 *   KXBTC15M-26SEP150815-15  empty floor, booked UP 80¢ → −82
 *   KXBTC15M-26SEP150830-30  under bar / 1–1, booked UP 82¢ → −84
 *   KXBTC15M-26SEP150900-00  0 agree / 1 against at 81¢; later +17
 *
 * Fail closed on the CURRENT chair, not the lean from minutes ago:
 *   speaking seats on the booked side ≥ BOOK_MIN_SPEAKING
 *   those seats strictly outnumber the other side
 *   the Chair's own bar gate passes now
 *   hard_fail is off
 *   quorum counts are finite
 *
 * The Chair's bar gate includes its aggressiveness multiplier. Recomputing
 * `score >= bar` here created a stricter second formula that could reject a
 * legitimate Chair UP/DOWN after the Chair itself had already cleared its bar.
 * When a legacy/test Chair has no bar gate, retain the old numeric fallback so
 * the guard still fails closed rather than silently weakening.
 *
 * HOLD is unchanged: this only blocks the first fill. A later WAIT does not unwind.
 */
export function paperBookTeamOk(
  chair: Pick<ChairResult, "score" | "bar" | "hard_fail" | "quorum" | "gates">,
  lean: "UP" | "DOWN",
): boolean {
  const up = chair.quorum?.up;
  const down = chair.quorum?.down;
  if (!Number.isFinite(up) || !Number.isFinite(down)) return false;
  const speakingFor = lean === "UP" ? up : down;
  const speakingAgainst = lean === "UP" ? down : up;
  if (speakingFor < BOOK_MIN_SPEAKING) return false;
  if (speakingFor <= speakingAgainst) return false;
  if (chair.hard_fail) return false;

  const barGate = Array.isArray(chair.gates) ? chair.gates.find((g) => g.id === "bar") : undefined;
  if (barGate) return barGate.pass;

  const score = chair.score;
  const bar = chair.bar;
  if (!Number.isFinite(score) || !Number.isFinite(bar) || !(bar > 0)) return false;
  if (lean === "UP" && !(score >= bar)) return false;
  if (lean === "DOWN" && !(score <= -bar)) return false;
  return true;
}

/**
 * The win rate a book of contracts at `ask` needs to stand still after the
 * Kalshi taker fee: a win pays 100 − ask − fee, a loss costs ask + fee, so the
 * break-even rate is (ask + fee)/100. At the trial's floor that is about 82%,
 * against about 72% at the old one — the cost of the better hit rate.
 */
export function floorBreakevenPct(ask: number): number {
  if (!realAsk(ask)) return 0;
  return Math.round((ask + takerFeeCents(ask)) * 10) / 10;
}

export type BookState =
  /** No read and no position. */
  | { kind: "wait" }
  /** A position is held on this window, booked at `cents`; `ask` is that side's ask now. */
  | { kind: "booked"; lean: "UP" | "DOWN"; cents: number; ask: number }
  /** The chair leans a side but its ask sits under the floor: no paper fill. */
  | { kind: "floor"; lean: "UP" | "DOWN"; ask: number }
  /** The chair leans a side at or above the floor and the book has not filled yet (next tick books). */
  | { kind: "filling"; lean: "UP" | "DOWN"; ask: number };

/**
 * The open paper position on this window, or null. Exported so the Floor can show
 * WHEN the entry was locked, not just at what price — a locked entry without its
 * timestamp cannot be told apart from a current quote. Pure lookup; decides nothing.
 */
export function openRow(snap: Snapshot, callLog: CallLogRow[]): CallLogRow | null {
  return (
    callLog.find(
      (r) => r.settle == null && r.ticker === snap.ticker && Math.abs(r.close_time - snap.close_time) < 90_000,
    ) ?? null
  );
}

/** What the book is doing with the chair's read on this window. */
export function bookState(snap: Snapshot, lean: Lean, callLog: CallLogRow[]): BookState {
  const row = openRow(snap, callLog);
  if (row) return { kind: "booked", lean: row.lean, cents: row.cents, ask: markSide(snap, row.lean) };
  if (lean !== "UP" && lean !== "DOWN") return { kind: "wait" };
  const ask = markSide(snap, lean);
  return bookable(ask) ? { kind: "filling", lean, ask } : { kind: "floor", lean, ask };
}
