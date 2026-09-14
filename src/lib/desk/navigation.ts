export type SitePath =
  | "/"
  | "/chamber"
  | "/lab"
  | "/arena"
  | "/about"
  | "/faq"
  | "/legal";

export type SiteDestination = {
  href: SitePath;
  label: string;
  menuLabel: string;
  hint: string;
};

export const SITE_DESTINATIONS: readonly SiteDestination[] = [
  { href: "/", label: "Floor", menuLabel: "FLOOR", hint: "live desk" },
  { href: "/chamber", label: "Chamber", menuLabel: "CHAMBER", hint: "evidence-backed reactions" },
  { href: "/lab", label: "Lab", menuLabel: "LAB", hint: "prospective research" },
  { href: "/arena", label: "Arena", menuLabel: "ARENA", hint: "paper-call room" },
  { href: "/about", label: "How it works", menuLabel: "HOW IT WORKS", hint: "read, vote, grade" },
  { href: "/faq", label: "FAQ", menuLabel: "FAQ", hint: "plain-language answers" },
  { href: "/legal", label: "Paper only", menuLabel: "PAPER ONLY", hint: "no orders or advice" },
];

export function sitePathActive(pathname: string, href: SitePath): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
