/**
 * Colour for a lean. Colour is never the only carrier of the state on screen —
 * the UP/DOWN/WAIT word sits beside it everywhere this is used.
 */
import type { Lean } from "@/lib/desk/types";

export function leanTone(lean: Lean | null): string {
  return lean === "UP" ? "text-up" : lean === "DOWN" ? "text-down" : "text-wait";
}
