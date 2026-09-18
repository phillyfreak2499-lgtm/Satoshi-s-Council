/**
 * Read-only Lab snapshot for the Chair v2 / Chair v3 shadow scoreboards.
 *
 * Both numbers come from ledgers the desk already keeps:
 *   - Chair v2: the engine's own V2Stats (refreshV2Stats in server-engine),
 *     read off the server frame — the same object the desk page shows. This
 *     module never refits, never writes desk_samples, never calls predictV2
 *     or decideV2.
 *   - Chair v3: the cached strict walk-forward report (chair-v3.server), which
 *     runs walkForwardV3 read-only over rows already stored. fitV3, predictV3
 *     and V3_FEATURES are untouched.
 *
 * Authority: none. Nothing here reaches the live Chair, the paper book, the
 * learner, promotion, or any writer. A failed source renders as unavailable,
 * never as a zero record, and one source failing does not hide the other.
 */
import { buildChairV2Card, buildChairV3Card, type ChairV2Card, type ChairV3Card } from "./chair-shadow-lab";
import { chairV3Snapshot } from "./chair-v3.server";

/** The desk page waits this long for the engine frame; the Lab does the same. */
const FRAME_WAIT_MS = 2_500;

export type ChairShadowLabSnapshot = {
  at: string;
  authority: "none";
  paper_only: true;
  chair_v2: ChairV2Card;
  chair_v3: ChairV3Card;
};

/** The engine's published v2 frame, or null if the brain is unreachable in time. */
async function v2FromFrame(): Promise<ChairV2Card> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Dynamic on purpose, as home-public and call-quality do: the Lab must not
    // become a static dependency of the brain, and the brain never imports the Lab.
    const { getServerFrame } = await import("./server-engine");
    const frame = await Promise.race([
      getServerFrame(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FRAME_WAIT_MS);
      }),
    ]);
    if (!frame) return buildChairV2Card({ stats: null, weights_n: 0, fitted_at: 0 });
    return buildChairV2Card({
      stats: frame.v2.stats,
      weights_n: frame.v2.weights_n,
      fitted_at: frame.v2.fitted_at,
    });
  } catch {
    return buildChairV2Card({ stats: null, weights_n: 0, fitted_at: 0 });
  } finally {
    clearTimeout(timer);
  }
}

/** The existing walk-forward report, projected to the card. */
async function v3FromReport(): Promise<ChairV3Card> {
  try {
    const s = await chairV3Snapshot();
    return buildChairV3Card({
      report: {
        n_rows: s.rows,
        n_scored: s.scored,
        market_brier: s.market_brier,
        v3_brier: s.v3_brier,
        brier_delta: s.brier_delta,
        market_log_loss: s.market_log_loss,
        v3_log_loss: s.v3_log_loss,
        avg_abs_adjustment_pp: s.avg_abs_adjustment_pp,
        max_abs_adjustment_pp: s.max_abs_adjustment_pp,
      },
      model_n: s.fitted?.n ?? 0,
      at: s.at,
    });
  } catch {
    return buildChairV3Card({ report: null, model_n: null, at: null });
  }
}

export async function chairShadowLabSnapshot(): Promise<ChairShadowLabSnapshot> {
  const [chair_v2, chair_v3] = await Promise.all([v2FromFrame(), v3FromReport()]);
  return { at: new Date().toISOString(), authority: "none", paper_only: true, chair_v2, chair_v3 };
}
