export type FloorView = "guided" | "pro";

/** Which floor a URL is asking for. Null means "use the saved preference." */
export function floorModeFromSearch(search: string): FloorView | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const sp = new URLSearchParams(raw);
  const view = sp.get("view");
  if (view === "guided" || view === "pro") return view;
  if (sp.has("tab") || sp.has("seat")) return "pro";
  return null;
}

/**
 * The view the server renders and the first client paint repeats. Only the
 * URL is read — never localStorage — so the two cannot disagree at hydration.
 */
export function initialFloorMode(search: string): FloorView {
  return floorModeFromSearch(search) === "guided" ? "guided" : "pro";
}

/**
 * The view after mount. AN EXPLICIT URL ALWAYS WINS: `?view=pro` and
 * `?view=guided` (and a Pro `?tab=`/`?seat=` deep link) outrank both the
 * stored choice and the first-visit default. Only a bare address falls back to
 * the stored choice, then to the first-visit default.
 */
export function mountedFloorMode(search: string, stored: FloorView | null, firstVisit: FloorView): FloorView {
  return floorModeFromSearch(search) ?? stored ?? firstVisit;
}

/**
 * The `view` value the floor writes back into its own address, or null to
 * drop it. Guided on the floor always says so; Pro keeps an explicit
 * `?view=pro` it arrived with (so a reload or a shared link still pins Pro)
 * and otherwise stays bare, as it always has.
 */
export function floorViewParam(current: string | null, mode: FloorView, onFloor: boolean): FloorView | null {
  if (!onFloor) return null;
  if (mode === "guided") return "guided";
  return current === "pro" ? "pro" : null;
}
