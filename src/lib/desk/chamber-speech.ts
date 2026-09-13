/**
 * Chamber PR 1 — client-safe read-only speech surface.
 *
 * listChamberSpeech is a GET createServerFn so ChamberSpeech.tsx can call it
 * without importing a *.server.ts module (TanStack import-protection).
 * No POST. No recordSystemEvent. No observeChairWaitMilestone.
 */
import { createServerFn } from "@tanstack/react-start";
import { statementFromEvent, type ChamberStatement } from "./chamber-reactions";
import { listPublicChamberEvents } from "./system-events.server";

/** Read-only. Up to five latest persisted statements per active speaker. */
export const listChamberSpeech = createServerFn({ method: "GET" }).handler(async (): Promise<ChamberStatement[]> => {
  const rows = await listPublicChamberEvents(5);
  const out: ChamberStatement[] = [];
  for (const row of rows) {
    const stmt = statementFromEvent(row);
    if (stmt) out.push(stmt);
  }
  return out;
});
