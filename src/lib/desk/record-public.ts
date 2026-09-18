import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import type { BooksWindow } from "./books";
import { RECORD_CACHE_CONTROL, type WeekRecord } from "./record";

/** Read-only weekly brief for the public /record page. Never cached: the week rolls every 15 minutes. */
export const publicWeekRecord = createServerFn({ method: "GET" }).handler(async (): Promise<WeekRecord> => {
  try {
    setResponseHeader("cache-control", RECORD_CACHE_CONTROL);
  } catch {
    /* no response in scope (a direct server-side call); the document route sets the header itself */
  }
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
