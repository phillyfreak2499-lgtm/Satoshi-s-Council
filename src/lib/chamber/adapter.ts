/**
 * THE SEAM — documented, NOT wired in Phase 0.
 *
 * How real read-only desk state would drive the room later: a pure projection of a
 * slice of the public `GET /frame` payload into a ChamberState. It performs no I/O
 * and imports nothing from the desk engine — only the desk's `Lean` type, so the
 * Chair's published lean is spelled the one canonical way.
 *
 * What it will and will not say (the truth rule):
 * - Satoshi's DIRECTIONAL / WAIT follows the Chair's actually published lean, and
 *   nothing else. No lean in the frame → OBSERVING.
 * - The Warden follows real integrity signals only: a recorded error or a feed
 *   reported DOWN → ALERT; a stale feed or a tick older than STALE_TICK_S →
 *   INVESTIGATING; otherwise ALL_CLEAR.
 * - The Alchemist is IDLE. The frame exposes no evidence-backed research activity,
 *   so none is invented. (Ambient motion in the Lab is fictional and allowed.)
 */
import type { Lean } from "@/lib/desk/types";
import type { ChamberState, Direction, SatoshiState, WardenState } from "./states.ts";

/** The slice of the public frame the projection reads. Structural on purpose. */
export type FrameSlice = {
  chair: { lean: Lean } | null;
  lastError: string | null;
  tick_age_s: number;
  snap: { health?: { spot?: string; kalshi?: string } } | null;
};

/** A tick this old means the desk is not currently observing the market. */
export const STALE_TICK_S = 30;

export function fromServerFrame(f: FrameSlice): ChamberState {
  const lean = f.chair?.lean ?? null;
  const satoshi: SatoshiState = lean === "UP" || lean === "DOWN" ? "DIRECTIONAL" : lean === "WAIT" ? "WAIT" : "OBSERVING";
  const direction: Direction = satoshi === "DIRECTIONAL" ? (lean as "UP" | "DOWN") : null;

  const spot = f.snap?.health?.spot ?? "";
  const kalshi = f.snap?.health?.kalshi ?? "";
  const down = spot === "DOWN" || kalshi === "DOWN";
  const stale = spot === "STALE" || kalshi === "STALE" || !(f.tick_age_s >= 0) || f.tick_age_s > STALE_TICK_S;
  const warden: WardenState = f.lastError || down ? "ALERT" : stale ? "INVESTIGATING" : "ALL_CLEAR";

  return { satoshi, direction, alchemist: "IDLE", warden };
}
