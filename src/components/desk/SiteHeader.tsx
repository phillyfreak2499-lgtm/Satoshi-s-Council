import { useEffect, useState, type ReactNode } from "react";
import { Crest } from "./Crest";
import { cn } from "@/lib/utils";

export type MenuItem = { label: string; hint?: string; href?: string; onSelect?: () => void; active?: boolean };

/**
 * One header for every page: crest and wordmark on the left, the page's own
 * navigation on the right, sticky. Under the fold breakpoint the navigation
 * folds into a menu button that opens a full-width panel below the header.
 */
const FOLD = {
  sm: { nav: "hidden min-w-0 items-center gap-1 sm:flex", button: "btn btn-secondary btn-sm sm:hidden", panel: "sm:hidden" },
  lg: { nav: "hidden min-w-0 items-center gap-1 lg:flex", button: "btn btn-secondary btn-sm lg:hidden", panel: "lg:hidden" },
} as const;

export function SiteHeader({
  nav,
  menu,
  onBrand,
  brandHref = "/",
  tour,
  fold = "sm",
}: {
  /** Desktop navigation, rendered inline. */
  nav?: ReactNode;
  /** The same destinations for the phone menu. */
  menu?: MenuItem[];
  onBrand?: () => void;
  brandHref?: string;
  tour?: string;
  /** Below this breakpoint the navigation folds into the menu button; a wide nav folds under lg. */
  fold?: keyof typeof FOLD;
}) {
  const [open, setOpen] = useState(false);
  const f = FOLD[fold];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const brand = (
    <>
      <Crest size={24} />
      <span className="whitespace-nowrap font-sans text-ui font-medium tracking-tight text-fg sm:text-body">Satoshi&apos;s Council</span>
      <span className="font-mono text-micro uppercase tracking-widest text-subtle">Beta</span>
    </>
  );
  return (
    <header data-tour={tour} className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
      <div className="gutter mx-auto flex h-[var(--header-h)] w-full max-w-[var(--max)] items-center justify-between gap-3">
        {onBrand ? (
          <button type="button" onClick={onBrand} className="flex min-h-11 items-center gap-2.5 rounded-md text-left" aria-label="Satoshi's Council — the floor">
            {brand}
          </button>
        ) : (
          <a href={brandHref} className="flex min-h-11 items-center gap-2.5 rounded-md" aria-label="Satoshi's Council — the floor">
            {brand}
          </a>
        )}
        <div className="flex min-w-0 items-center gap-1">
          {nav ? <div className={f.nav}>{nav}</div> : null}
          {menu?.length ? (
            <button
              type="button"
              className={f.button}
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "close" : "menu"}
            </button>
          ) : null}
        </div>
      </div>
      {open && menu?.length ? (
        <nav id="site-menu" aria-label="Site menu" className={cn("gutter absolute inset-x-0 top-full border-b border-border bg-surface py-2 shadow-[0_24px_60px_rgba(0,0,0,0.5)]", f.panel)}>
          <ul className="grid gap-1">
            {menu.map((m) => (
              <li key={m.label}>
                {m.href ? (
                  <a href={m.href} className={cn("flex min-h-11 items-center justify-between gap-3 rounded-md px-2 font-mono text-ui", m.active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
                    {m.label}
                    {m.hint ? <span className="font-mono text-micro text-subtle">{m.hint}</span> : null}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      m.onSelect?.();
                      setOpen(false);
                    }}
                    className={cn("flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left font-mono text-ui", m.active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}
                  >
                    {m.label}
                    {m.hint ? <span className="font-mono text-micro text-subtle">{m.hint}</span> : null}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
