import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SITE_DESTINATIONS, sitePathActive, type SitePath } from "@/lib/desk/navigation";
import { cn } from "@/lib/utils";
import { SiteHeader, type MenuItem } from "./SiteHeader";
import "./observatory.css";
import "./interface-polish.css";

export type HeaderAction = { label: string; hint?: string; onSelect: () => void };
const PRIMARY: readonly SitePath[] = ["/", "/lab", "/?tab=atelier", "/books", "/chamber"];
const SHORTCUTS = PRIMARY;
const linkClass = "council-site-link flex min-h-11 items-center gap-1 rounded-md px-3 font-mono text-micro tracking-wide";

/** Shared by the real app and the isolated design preview. No data fetching. */
export function CouncilNavigation({ pathname, search = "", action, tour, preview = false, controls }: {
  pathname: string;
  search?: string;
  action?: HeaderAction;
  tour?: string;
  controls?: ReactNode;
  /** Preview links explicitly open the existing site; never imitate live rooms. */
  preview?: boolean;
}) {
  const active = (href: SitePath) => sitePathActive(pathname, href, search);
  const hrefFor = (href: SitePath) => preview ? `https://satoshiscouncil.com${href}` : href;
  const target = preview ? "_blank" : undefined;
  const rel = preview ? "noreferrer" : undefined;
  const menu: MenuItem[] = SITE_DESTINATIONS.map(item => ({ label: item.menuLabel, href: hrefFor(item.href), hint: item.hint, group: item.group, active: active(item.href), external: preview }));
  if (action) menu.push({ ...action, group: "This page" });
  const links = (paths: readonly SitePath[]) => paths.map(path => {
    const item = SITE_DESTINATIONS.find(candidate => candidate.href === path)!;
    return <a key={path} href={hrefFor(path)} target={target} rel={rel} aria-current={active(path) ? "page" : undefined}
      className={cn(linkClass, active(path) ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>{item.label}</a>;
  });
  return <SiteHeader fold="xl" tour={tour} menu={menu} brandHref={preview ? "/" : undefined} controls={controls}
    shortcuts={<nav aria-label="Quick access" className="council-site-shortcuts">{links(SHORTCUTS)}</nav>}
    nav={<nav aria-label="Site sections" className="flex items-center gap-1">
      {links(PRIMARY)}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={cn(linkClass, "text-muted hover:bg-surface-2 hover:text-fg")}>
          All sections<span aria-hidden="true" className="ml-1 text-subtle">▾</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="council-all-sections z-50 max-h-[75dvh] min-w-64 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
          {SITE_DESTINATIONS.map((item, index) => <div key={item.href}>
            {index === 0 || item.group !== SITE_DESTINATIONS[index - 1]?.group ? <DropdownMenu.Label className="px-3 pb-1 pt-3 font-mono text-micro uppercase tracking-widest text-subtle">{item.group}</DropdownMenu.Label> : null}
            <DropdownMenu.Item asChild className="flex min-h-11 cursor-pointer items-center justify-between gap-5 rounded-sm px-3 font-mono text-micro outline-none data-[highlighted]:bg-surface-2">
              <a href={hrefFor(item.href)} target={target} rel={rel} aria-current={active(item.href) ? "page" : undefined}><span>{item.label}</span><span className="text-subtle">{item.hint}</span></a>
            </DropdownMenu.Item>
          </div>)}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      {links(["/?tab=settings"])}
      {action ? <button type="button" onClick={action.onSelect} className={cn(linkClass, "text-muted hover:bg-surface-2 hover:text-fg")}>{action.label}</button> : null}
    </nav>} />;
}
