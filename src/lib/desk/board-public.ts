import { createServerFn } from "@tanstack/react-start";
import type { BoardPost } from "./board";

/** The Board for the route's first paint: read on the server, never a loading line. Boots the shared engine so the DESK notes are upserted. */
export const publicBoard = createServerFn({ method: "GET" }).handler(async (): Promise<BoardPost[] | null> => {
  try {
    const engine = await import("./server-engine");
    engine.ensureServerEngine();
    const { readBoard } = await import("./board");
    return await readBoard();
  } catch {
    // Null, not an empty board: the page prints the not-answering line and keeps polling.
    return null;
  }
});
