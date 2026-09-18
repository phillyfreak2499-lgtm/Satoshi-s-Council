import { createServerFn } from "@tanstack/react-start";
import type { BooksWindow } from "./books";
import type { WeekRecord } from "./record";

/** Read-only weekly brief for the public /record page. */
export const publicWeekRecord = createServerFn({ method: "GET" }).handler(async (): Promise<WeekRecord> => {
  const engine = await import("./server-engine");
  engine.ensureServerEngine();
  const { weekRecord } = await import("./record.server");
  return weekRecord();
});

/** The last graded window, for the homepage's live module. Read-only. */
export const publicLastWindow = createServerFn({ method: "GET" }).handler(async (): Promise<BooksWindow | null> => {
  const engine = await import("./server-engine");
  engine.ensureServerEngine();
  const { booksSummary } = await import("./books.server");
  return (await booksSummary()).last;
});
