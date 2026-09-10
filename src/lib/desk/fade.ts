/**
 * What a bad recent run should do to a seat's authority.
 *
 * THE RULE THIS REPLACES. The chair used to flip a seat's sign: eight graded
 * directional calls with fewer than ~38% hits and the seat's read was inverted —
 * a DOWN read counted as UP. That is a much stronger claim than the evidence
 * supports. A predictor that is wrong is not thereby a working predictor in
 * reverse; it is most likely reading noise, and eight windows cannot tell those
 * apart. Worse, the flip applied only to the seat's signed contribution and not
 * to its printed lean, so the conflict fraction, the category-diversity bonus,
 * the quorum count and the evidence-family fold all went on booking that
 * seat's weight on the side it was no longer pushing.
 *
 * THE RULE NOW. A bad run can take authority away. It can never hand a seat
 * authority in the opposite direction. The scale returned here is always in
 * [0, 1]: the seat keeps its own side and simply gets quieter, and at the far
 * end it is benched to zero weight — graded, visible, and silent — rather than
 * being believed backwards.
 *
 * Benching at zero is an established shape in this desk: a seat with a dead
 * feed already rides at zero weight while still counting in sit-mass, so the
 * chair reads "nobody is arguing for a side" rather than "one fewer seat
 * exists".
 *
 * An inverse hypothesis is a fine thing to want. It belongs in a SHADOW card
 * that states it and is graded prospectively, not in an automatic sign flip
 * applied to a seat's live read.
 *
 * Pure module.
 */

/** Graded calls needed before a bad run means anything at all. */
export const FADE_MIN_N = 8;
/** Hit rate over the recent window below which a seat is treated as faded. */
export const FADE_RATE = 0.38;
/** At most this hit rate, with a persistent fade, and the seat is benched outright. */
export const BENCH_RATE = 0.125;
/** Fade strength at or above which a faded seat may be benched rather than shrunk. */
export const BENCH_FADE = 0.75;
/** How quiet a freshly faded seat gets. */
export const FADE_SCALE_MAX = 0.5;
/** How quiet a persistently faded seat gets before benching. */
export const FADE_SCALE_MIN = 0.2;

export type FadeVerdict = {
  /** Multiplier on the seat's weight. Always in [0, 1] — a sign is never flipped. */
  scale: number;
  /** True when the seat keeps its side but speaks more quietly. */
  faded: boolean;
  /** True when the seat is silent this window: zero weight, still graded. */
  benched: boolean;
  /** Plain reason, or null when nothing is wrong. */
  why: string | null;
};

const OK: FadeVerdict = { scale: 1, faded: false, benched: false, why: null };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * How loudly a seat may speak, given its recent graded results and how
 * persistent its fade has been. `recent` is the seat's rolling record of 1 (hit)
 * and 0 (miss), newest last; only the last FADE_MIN_N count. `fadeStrength` is
 * the learner's existing 0..1 measure of how long the seat has been cold.
 */
export function fadeVerdict(recent: readonly number[], fadeStrength: number): FadeVerdict {
  const slice = recent.slice(-FADE_MIN_N);
  if (slice.length < FADE_MIN_N) return OK;
  const rate = slice.reduce((a, b) => a + (b ? 1 : 0), 0) / slice.length;
  if (rate >= FADE_RATE) return OK;
  const fade = clamp01(fadeStrength);
  const pct = Math.round(rate * 100);
  if (rate <= BENCH_RATE && fade >= BENCH_FADE) {
    return {
      scale: 0,
      faded: true,
      benched: true,
      why: `benched — ${pct}% of its last ${slice.length} and cold for a while`,
    };
  }
  // Quieter the longer it has been cold, never louder, never reversed.
  const scale = FADE_SCALE_MAX - (FADE_SCALE_MAX - FADE_SCALE_MIN) * fade;
  return {
    scale: Math.round(scale * 100) / 100,
    faded: true,
    benched: false,
    why: `faded — ${pct}% of its last ${slice.length}`,
  };
}
