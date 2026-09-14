import { createServerFn } from "@tanstack/react-start";
import type { Arena } from "./arena";
import type { Rack } from "./pit";

export type PublicArenaSnapshot = {
  rack: Rack;
  board: Arena;
};

/** Read-only public Arena state. No device token, callsign, or write path. */
export const publicArenaSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicArenaSnapshot> => {
    const engine = await import("./server-engine");
    engine.ensureServerEngine();
    const [{ rackFor }, { arenaSummary }] = await Promise.all([
      import("./pit.server"),
      import("./arena.server"),
    ]);
    const [rack, board] = await Promise.all([rackFor(null), arenaSummary(null)]);
    return { rack, board };
  },
);
