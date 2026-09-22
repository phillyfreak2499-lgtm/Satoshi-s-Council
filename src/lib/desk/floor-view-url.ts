/** Which floor a URL is asking for. Null means "use the saved preference." */
export function floorModeFromSearch(search: string): "guided" | "pro" | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const sp = new URLSearchParams(raw);
  const view = sp.get("view");
  if (view === "guided" || view === "pro") return view;
  if (sp.has("tab") || sp.has("seat")) return "pro";
  return null;
}
