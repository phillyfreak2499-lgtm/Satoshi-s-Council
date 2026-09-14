import { useRouterState } from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SITE_DESTINATIONS, sitePathActive, type SiteGroup } from "@/lib/desk/navigation";
import { cn } from "@/lib/utils";
import { SiteHeader, type MenuItem } from "./SiteHeader";

type HeaderAction = { label: string; hint?: string; onSelect: () => void };
const linkClass = "flex min-h-11 items-center gap-1 rounded-md px-3 font-mono text-micro tracking-wide";
export function GlobalHeader({ action, tour }: { action?: HeaderAction; tour?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const menu: MenuItem[] = SITE_DESTINATIONS.map((item) => ({ label: item.menuLabel, href: item.href, hint: item.hint, group: item.group, active: sitePathActive(pathname, item.href) }));
  if (action) menu.push({ ...action, group: "This page" });
  const groupMenu = (group: SiteGroup) => {
    const items = SITE_DESTINATIONS.filter((item) => item.group === group);
    const active = items.some((item) => sitePathActive(pathname, item.href));
    return <DropdownMenu.Root key={group}>
      <DropdownMenu.Trigger className={cn(linkClass, active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
        {group}<span aria-hidden="true" className="ml-1 text-subtle">▾</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-64 rounded-md border border-border bg-surface p-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
        <DropdownMenu.Label className="px-3 py-2 font-mono text-micro uppercase tracking-widest text-subtle">{group}</DropdownMenu.Label>
        {items.map((item) => <DropdownMenu.Item key={item.href} asChild className="flex min-h-11 cursor-pointer items-center justify-between gap-5 rounded-sm px-3 font-mono text-micro outline-none data-[highlighted]:bg-surface-2">
          <a href={item.href} aria-current={sitePathActive(pathname, item.href) ? "page" : undefined}><span>{item.label}</span><span className="text-subtle">{item.hint}</span></a>
        </DropdownMenu.Item>)}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>;
  };
  return <SiteHeader fold="xl" tour={tour} menu={menu} nav={<nav aria-label="Site sections" className="flex items-center gap-1">
    {SITE_DESTINATIONS.filter((item) => item.group === "Explore" && item.href !== "/board").map((item) => <a key={item.href} href={item.href} aria-current={sitePathActive(pathname, item.href) ? "page" : undefined} className={cn(linkClass, sitePathActive(pathname, item.href) ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>{item.label}</a>)}
    {groupMenu("Research")}
    <a href="/board" aria-current={sitePathActive(pathname, "/board") ? "page" : undefined} className={cn(linkClass, sitePathActive(pathname, "/board") ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>Community</a>
    {groupMenu("Help")}
    {action ? <button type="button" onClick={action.onSelect} className={cn(linkClass, "text-muted hover:bg-surface-2 hover:text-fg")}>{action.label}</button> : null}
  </nav>} />;
}
