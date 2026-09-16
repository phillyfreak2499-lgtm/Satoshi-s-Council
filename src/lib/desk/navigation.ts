export type SitePath = "/" | "/chamber" | "/training" | "/books" | "/lab" | "/arena" | "/board" | "/about" | "/faq" | "/legal"
  | "/?tab=atelier" | "/?tab=settings" | "/?tab=crew" | "/?tab=structure" | "/?view=guided";
export type SiteGroup = "Explore" | "Research" | "Desk tools" | "Help";
export type SiteDestination = { href: SitePath; label: string; menuLabel: string; hint: string; group: SiteGroup };
export const SITE_DESTINATIONS: readonly SiteDestination[] = [
  { href: "/", label: "Floor", menuLabel: "Floor", hint: "live Council desk", group: "Explore" },
  { href: "/chamber", label: "Chamber", menuLabel: "Chamber", hint: "Council conversations", group: "Explore" },
  { href: "/?tab=atelier", label: "Gallery", menuLabel: "Gallery", hint: "all visualizations and Streamer", group: "Explore" },
  { href: "/training", label: "Training", menuLabel: "Training", hint: "choose your coach", group: "Explore" },
  { href: "/board", label: "Community", menuLabel: "Community", hint: "the Board: ideas and updates", group: "Explore" },
  { href: "/books", label: "Books", menuLabel: "Books", hint: "paper results and replays", group: "Research" },
  { href: "/lab", label: "Lab", menuLabel: "Lab", hint: "experiments and comparisons", group: "Research" },
  { href: "/arena", label: "Arena", menuLabel: "Arena", hint: "paper calls and rankings", group: "Research" },
  { href: "/?tab=structure", label: "Specialists", menuLabel: "Specialists", hint: "all five specialist desks", group: "Desk tools" },
  { href: "/?tab=crew", label: "Pit crew", menuLabel: "Pit crew", hint: "support and diagnostics", group: "Desk tools" },
  { href: "/?view=guided", label: "Guided Floor", menuLabel: "Guided Floor", hint: "the plain-language view", group: "Desk tools" },
  { href: "/?tab=settings", label: "Settings", menuLabel: "Settings", hint: "display, alerts and preferences", group: "Desk tools" },
  { href: "/about", label: "How it works", menuLabel: "How it works", hint: "read, vote, grade", group: "Help" },
  { href: "/faq", label: "FAQ", menuLabel: "FAQ", hint: "plain-language answers", group: "Help" },
  { href: "/legal", label: "Paper only", menuLabel: "Paper only", hint: "no orders or advice", group: "Help" },
];
/** Query-based rooms retain their existing URLs; no replacement routes. */
export function sitePathActive(pathname: string, href: SitePath, search = ""): boolean {
  const query = new URLSearchParams(search);
  if (href.startsWith("/?")) {
    if (pathname !== "/") return false;
    const target = new URLSearchParams(href.slice(2));
    if (target.get("tab") === "structure") return ["structure", "tape", "derivs", "book", "context"].includes(query.get("tab") ?? "");
    if (target.has("view") && query.has("tab") && query.get("tab") !== "satoshi") return false;
    return [...target].every(([key, value]) => query.get(key) === value);
  }
  if (href === "/") return (pathname === "/" && (!query.has("tab") || query.get("tab") === "satoshi") && query.get("view") !== "guided") || pathname.startsWith("/seat/");
  if (href === "/books" && pathname.startsWith("/window/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
