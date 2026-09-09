import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SiteHeader } from "./SiteHeader";
import { cn } from "@/lib/utils";

const NAV: { to: "/about" | "/faq" | "/legal"; label: string }[] = [
  { to: "/about", label: "How it works" },
  { to: "/faq", label: "FAQ" },
  { to: "/legal", label: "Paper only" },
];

/** Chrome for the reading pages: brand, three quiet links, one way onto the floor. */
export function Page({ title, lede, children, wide = false }: { title: string; lede: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a href="#page-main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader
        nav={
          <nav aria-label="Reading pages" className="flex flex-wrap items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex min-h-11 items-center rounded-md px-2 font-mono text-micro tracking-wide text-muted hover:bg-surface-2 hover:text-fg"
                activeProps={{ className: "bg-surface-2 text-fg" }}
              >
                {n.label}
              </Link>
            ))}
            <Link to="/" className="btn btn-primary btn-sm ml-1">
              Open the floor
            </Link>
          </nav>
        }
        menu={[...NAV.map((n) => ({ label: n.label, href: n.to, hint: "page" })), { label: "Open the floor", href: "/" }, { label: "THE PIT", href: "/arena", hint: "room" }]}
      />
      <main id="page-main" className={cn("gutter mx-auto w-full flex-1 py-8", wide ? "max-w-5xl" : "max-w-[72ch]")}>
        <h1 className="font-sans text-display font-medium tracking-tight text-fg">{title}</h1>
        <p className="mt-2 font-sans text-body text-muted">{lede}</p>
        <div className="prose-desk mt-8">{children}</div>
        <div className="mt-10 border-t border-border pt-6">
          <Link to="/" className="btn btn-primary">
            Open the floor
          </Link>
          <span className="ml-3 font-mono text-micro text-subtle">The 60-second tour starts on your first visit; replay it from ? in the header.</span>
        </div>
      </main>
      <footer className="border-t border-border px-4 py-3 font-mono text-micro text-subtle">
        <div className="mx-auto max-w-4xl">
          Paper research desk · Bitcoin only · Not financial advice · Not affiliated with Kalshi ·{" "}
          <Link to="/legal" className="underline-offset-2 hover:text-fg hover:underline">
            what paper means
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 font-sans text-title font-medium text-fg first:mt-0">{children}</h2>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 font-sans text-body leading-relaxed text-muted">{children}</p>;
}
