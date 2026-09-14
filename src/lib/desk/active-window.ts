import type { ChairResult, Snapshot, Vote } from "./types";
import { tickerAgrees } from "./window-identity.ts";

/** The last observed grading input for an open window. Never reconstructed. */
export type ActiveWindow = {
  ticker: string;
  close_time: number;
  snap: Snapshot;
  votes: Vote[];
  chair: ChairResult;
};

const lean = (v: unknown) => v === "UP" || v === "DOWN" || v === "WAIT";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Read only a complete, self-consistent checkpoint. Old state has none. */
export function restoreActiveWindow(raw: unknown, completed: readonly string[] = []): ActiveWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<ActiveWindow>;
  const s = w.snap;
  const c = w.chair;
  if (typeof w.ticker !== "string" || !w.ticker || !finite(w.close_time) || w.close_time <= 0) return null;
  if (!s || typeof s !== "object" || s.ticker !== w.ticker || s.close_time !== w.close_time) return null;
  if (tickerAgrees(w.ticker, w.close_time) === false) return null;
  if (!finite(s.as_of) || s.as_of < w.close_time - 960_000 || s.as_of > w.close_time + 60_000) return null;
  if (!s.health || !finite(s.spot) || !finite(s.strike) || !finite(s.secs_left)) return null;
  if (!c || !lean(c.lean) || !finite(c.confidence) || !finite(c.score) || !finite(c.bar) || !finite(c.sit_mass)) return null;
  if (!Array.isArray(w.votes) || !w.votes.length || w.votes.some((v) => !v || typeof v.seat !== "string" || !lean(v.lean) || !finite(v.confidence))) return null;
  if (completed.includes(`${w.ticker}:${w.close_time}`)) return null;
  return w as ActiveWindow;
}

/** Freeze exactly what was observed; never supply an already pending/graded window. */
export function checkpointActiveWindow(
  input: { snap: Snapshot; votes: Vote[]; chair: ChairResult } | null,
  completed: readonly string[],
  pending: readonly { ticker: string; close_time: number }[],
): ActiveWindow | null {
  if (!input) return null;
  const w = restoreActiveWindow({ ...input, ticker: input.snap.ticker, close_time: input.snap.close_time }, completed);
  if (!w || pending.some((p) => p.ticker === w.ticker && p.close_time === w.close_time)) return null;
  return w;
}
