/**
 * Presentation helper for a quiet Chamber.
 * Collapses consecutive SATOSHI WAIT dispatches into one digest line.
 * Does not write events, change the Chair, or alter the book.
 */
import { SIT_IS_THE_CALL } from "./chair-words.ts";

export function sitStreakLine(n: number): string {
  const count = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
  if (count <= 1) return SIT_IS_THE_CALL;
  return `The Chair has sat ${count} consecutive windows on this feed. Sitting this window is the call.`;
}
