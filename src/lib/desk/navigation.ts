export type SitePath = "/" | "/chamber" | "/training" | "/books" | "/lab" | "/arena" | "/board" | "/about" | "/faq" | "/legal";
export type SiteGroup = "Explore" | "Research" | "Help";
export type SiteDestination = { href: SitePath; label: string; menuLabel: string; hint: string; group: SiteGroup };
export const SITE_DESTINATIONS: readonly SiteDestination[] = [
  { href: "/", label: "Floor", menuLabel: "Floor", hint: "live Council desk", group: "Explore" },
  { href: "/chamber", label: "Chamber", menuLabel: "Chamber", hint: "Council conversations", group: "Explore" },
  { href: "/training", label: "Training", menuLabel: "Training", hint: "choose your coach", group: "Explore" },
  { href: "/board", label: "Community", menuLabel: "Community", hint: "the Board: ideas and updates", group: "Explore" },
  { href: "/books", label: "Books", menuLabel: "Books", hint: "paper results and replays", group: "Research" },
  { href: "/lab", label: "Lab", menuLabel: "Lab", hint: "experiments and comparisons", group: "Research" },
  { href: "/arena", label: "Arena", menuLabel: "Arena", hint: "paper calls and rankings", group: "Research" },
  { href: "/about", label: "How it works", menuLabel: "How it works", hint: "read, vote, grade", group: "Help" },
  { href: "/faq", label: "FAQ", menuLabel: "FAQ", hint: "plain-language answers", group: "Help" },
  { href: "/legal", label: "Paper only", menuLabel: "Paper only", hint: "no orders or advice", group: "Help" },
];
export function sitePathActive(pathname: string, href: SitePath): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/seat/");
  if (href === "/books" && pathname.startsWith("/window/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
