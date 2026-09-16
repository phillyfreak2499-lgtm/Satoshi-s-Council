import { useEffect, useRef, useState, type ReactNode } from "react";
import { Crest } from "./Crest";
import { cn } from "@/lib/utils";

export type MenuItem = { label: string; hint?: string; href?: string; onSelect?: () => void; active?: boolean; group?: string; external?: boolean };

/**
 * One header for every page: crest and wordmark on the left, the page's own
 * navigation on the right, sticky. Under the fold breakpoint the navigation
 * folds into a menu button that opens a full-width panel below the header.
 */
const FOLD = {
  sm: { nav: "hidden min-w-0 items-center gap-1 sm:flex", button: "btn btn-secondary btn-sm sm:hidden", panel: "sm:hidden" },
  xl: { nav: "hidden min-w-0 items-center gap-1 xl:flex", button: "btn btn-secondary btn-sm xl:hidden", panel: "xl:hidden" },
  lg: { nav: "hidden min-w-0 items-center gap-1 lg:flex", button: "btn btn-secondary btn-sm lg:hidden", panel: "lg:hidden" },
} as const;

export function SiteHeader({
  nav,
  menu,
  onBrand,
  brandHref = "/",
  tour,
  fold = "sm",
  shortcuts,
  controls,
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
  /** High-value destinations remain one tap away beneath the compact header. */
  shortcuts?: ReactNode;
  /** One instance of optional page controls, available at every breakpoint. */
  controls?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const f = FOLD[fold];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const brand = (
    <>
      <span className="council-site-seal"><Crest size={32} figure title="" /></span>
      <img src="/wordmark.png" alt="Satoshi's Council" className="h-[26px] w-auto sm:h-7" draggable={false} />
      <span className="font-mono text-micro uppercase tracking-widest text-subtle">Beta</span>
    </>
  );
  return (
    <header data-tour={tour} data-extra-controls={Boolean(controls)} className="council-site-header sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
      <div className="council-site-bar gutter mx-auto flex h-[var(--header-h)] w-full max-w-[var(--max)] items-center justify-between gap-3">
        {onBrand ? (
          <button type="button" onClick={onBrand} className="council-site-brand flex min-h-11 items-center gap-2.5 rounded-md text-left" aria-label="Satoshi's Council — the floor">
            {brand}
          </button>
        ) : (
          <a href={brandHref} className="council-site-brand flex min-h-11 items-center gap-2.5 rounded-md" aria-label="Satoshi's Council — the floor">
            {brand}
          </a>
        )}
        <div className="flex min-w-0 items-center gap-1">
          {nav ? <div className={f.nav}>{nav}</div> : null}
          {controls}
          {menu?.length ? (
            <button
              type="button"
              ref={menuButton}
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
      {shortcuts ? <div className={f.panel}>{shortcuts}</div> : null}
      {open && menu?.length ? (
        <nav id="site-menu" aria-label="Site menu" className={cn("gutter absolute inset-x-0 top-full max-h-[calc(100dvh-var(--header-h))] overflow-y-auto border-b border-border bg-surface py-2 shadow-[0_24px_60px_rgba(0,0,0,0.5)]", f.panel)}>
          <ul className="grid gap-1">
            {menu.map((m, index) => (
              <li key={m.label}>
                {m.group && m.group !== menu[index - 1]?.group ? <div className="px-2 pb-1 pt-3 font-mono text-micro uppercase tracking-widest text-subtle">{m.group}</div> : null}
                {m.href ? (
                  <a href={m.href} target={m.external ? "_blank" : undefined} rel={m.external ? "noreferrer" : undefined} aria-current={m.active ? "page" : undefined} onClick={() => setOpen(false)} className={cn("flex min-h-11 items-center justify-between gap-3 rounded-md px-2 font-mono text-ui", m.active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
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
