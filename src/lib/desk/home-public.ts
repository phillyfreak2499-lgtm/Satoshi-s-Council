import { createServerFn } from "@tanstack/react-start";
import type { DeskFrame } from "./engine";

/** A read-only snapshot for the homepage; never seed shared client state on the server. */
export const publicHomeSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<DeskFrame | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getServerFrame } = await import("./server-engine");
    const { DEFAULT_SETTINGS } = await import("./persist");
    const frame = await Promise.race([
      getServerFrame(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 2500); }),
    ]);
    if (!frame) return null;
    return {
      snap: frame.snap, votes: frame.votes, chair: frame.chair,
      learner: frame.learner, call_log: frame.call_log, v2: frame.v2,
      settings: { ...DEFAULT_SETTINGS, ...frame.settings, source: "live" },
      ticking: false, settling: frame.settling, lastError: frame.lastError,
      brain_age_s: frame.tick_age_s >= 0 ? frame.tick_age_s : null,
      frame_at: frame.as_of,
    };
  } catch {
    return null; // The existing loading/error view can retry after hydration.
  } finally {
    clearTimeout(timer);
  }
});
