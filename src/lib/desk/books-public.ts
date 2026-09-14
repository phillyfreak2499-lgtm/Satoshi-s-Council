import { createServerFn } from "@tanstack/react-start";
import type { Books } from "./books";

/** Read-only persisted book for the canonical public Books page. */
export const publicBooksSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<Books> => {
  const engine = await import("./server-engine");
  engine.ensureServerEngine();
  const { booksSummary } = await import("./books.server");
  return booksSummary();
});
