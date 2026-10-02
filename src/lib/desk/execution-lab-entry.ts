/** Independent late-only revalidation on a private learner copy. No producer
 * calls are rerun and no production booking state can leak into alreadyIn. */
import { runChair } from "./chair";
import { softenTimeGates } from "./time-gates";
import { selectiveChair, selectiveBookOk, type EntryWatch } from "./selective-entry.ts";
import type { CallLogRow, Learner, Lean, Settings, Snapshot, Vote } from "./types";
import type { Entry } from "./exit-arena.ts";
import { stickLean, type Stick } from "./stick";

export function lateEntry(input: {
  snap: Snapshot; votes: Vote[]; learner: Learner; settings: Settings;
  calls: CallLogRow[]; start: number; ready: boolean; watch: EntryWatch | null; lastLean: Lean; stick?: Stick;
}): { entry: Entry | null; watch: EntryWatch | null; lean: Lean; stick?: Stick } {
  const seconds = (input.snap.close_time-input.snap.as_of)/1000;
  if (!(seconds > 0 && seconds <= 120) || !input.ready || input.snap.demo)
    return { entry: null, watch: null, lean: "WAIT" };
  const learner = structuredClone(input.learner);
  learner.window_memory.entry_lean = null;
  const snap = structuredClone(input.snap);
  const raw = softenTimeGates(runChair(structuredClone(input.votes), snap, learner,
    structuredClone(input.settings), input.lastLean), snap);
  const sticky=stickLean(input.stick,raw.lean,snap.as_of);
  raw.lean=sticky.lean;
  const context = { calls: input.calls, ready: input.ready, start: input.start, watch: input.watch };
  const evaluated = selectiveChair(snap, raw, context);
  const ok = selectiveBookOk(snap, evaluated.chair, { ...context, watch: evaluated.watch });
  const side = evaluated.chair.lean;
  return { watch: evaluated.watch, lean: side, stick:sticky.st,
    entry: ok && (side === "UP" || side === "DOWN")
      ? { side, cents: side === "UP" ? snap.yes_ask : snap.no_ask, t: snap.as_of } : null };
}
