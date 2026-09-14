import { useRouterState } from "@tanstack/react-router";
import { SITE_DESTINATIONS, sitePathActive } from "@/lib/desk/navigation";
import { cn } from "@/lib/utils";
import { SiteHeader, type MenuItem } from "./SiteHeader";

type HeaderAction = {
  label: string;
  hint?: string;
  onSelect: () => void;
};

/** The same public wayfinding on every room and reading page. */
export function GlobalHeader({ action }: { action?: HeaderAction }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const menu: MenuItem[] = SITE_DESTINATIONS.map((item) => ({
    label: item.menuLabel,
    href: item.href,
    hint: item.hint,
    active: sitePathActive(pathname, item.href),
  }));
  if (action) menu.push(action);

  return (
    <SiteHeader
      fold="xl"
      nav={
        <nav aria-label="Site sections" className="flex items-center gap-1">
          {SITE_DESTINATIONS.map((item) => {
            const active = sitePathActive(pathname, item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-2 font-mono text-micro tracking-wide",
                  active
                    ? "bg-surface-2 text-fg"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {item.label}
              </a>
            );
          })}
          {action ? (
            <button
              type="button"
              onClick={action.onSelect}
              className="flex min-h-11 items-center rounded-md px-2 font-mono text-micro tracking-wide text-muted hover:bg-surface-2 hover:text-fg"
            >
              {action.label}
            </button>
          ) : null}
        </nav>
      }
      menu={menu}
    />
  );
}
