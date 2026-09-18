export const SHOP_URL = "https://satoshis-council-shop.fourthwall.com/";
export type SitePath = "/" | "/desk" | "/chamber" | "/training" | "/books" | "/lab" | "/arena" | "/board" | "/about" | "/faq" | "/legal"
  | "/?tab=atelier" | "/?tab=settings" | "/?tab=crew" | "/?tab=structure" | "/?view=guided";
export type SiteGroup = "Explore" | "Research" | "Desk tools" | "Help";
export type SiteHref = SitePath | typeof SHOP_URL;
export type SiteDestination = { href: SiteHref; label: string; menuLabel: string; hint: string; group: SiteGroup; external?: boolean };
export const SITE_DESTINATIONS: readonly SiteDestination[] = [
  { href: "/", label: "Home", menuLabel: "Home", hint: "discover the Council", group: "Explore" },
  { href: "/desk", label: "Live Floor", menuLabel: "Live Floor", hint: "live Council desk", group: "Explore" },
  { href: "/chamber", label: "Council", menuLabel: "Council / The Chamber", hint: "Council conversations", group: "Explore" },
  { href: "/?tab=atelier", label: "Gallery", menuLabel: "Gallery", hint: "all visualizations and Streamer", group: "Explore" },
  { href: "/training", label: "Training", menuLabel: "Training", hint: "choose your coach", group: "Explore" },
  { href: "/board", label: "Community", menuLabel: "Community", hint: "the Board: ideas and updates", group: "Explore" },
  { href: SHOP_URL, label: "Shop", menuLabel: "Shop", hint: "official Council merch ↗", group: "Explore", external: true },
  { href: "/books", label: "Results", menuLabel: "Results / Paper books", hint: "paper results and replays", group: "Research" },
  { href: "/lab", label: "Research", menuLabel: "Research / The Lab", hint: "experiments and comparisons", group: "Research" },
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
export function sitePathActive(pathname: string, href: SiteHref, search = ""): boolean {
  if (href === SHOP_URL) return false;
  const query = new URLSearchParams(search);
  if (href.startsWith("/?")) {
    if (pathname !== "/" && pathname !== "/desk") return false;
    const target = new URLSearchParams(href.slice(2));
    if (target.get("tab") === "structure") return ["structure", "tape", "derivs", "book", "context"].includes(query.get("tab") ?? "");
    if (target.has("view") && query.has("tab") && query.get("tab") !== "satoshi") return false;
    return [...target].every(([key, value]) => query.get(key) === value);
  }
  if (href === "/") return pathname === "/" && !["tab", "seat", "view"].some(key => query.has(key));
  if (href === "/desk") return pathname === "/desk" || pathname.startsWith("/seat/") || (pathname === "/" && (query.get("tab") === "satoshi" || query.has("seat") || query.get("view") === "guided"));
  if (href === "/books" && pathname.startsWith("/window/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
