import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TrustStrip } from "./Welcome";

const NAV: { to: "/about" | "/faq" | "/legal"; label: string }[] = [
  { to: "/about", label: "How it works" },
  { to: "/faq", label: "FAQ" },
  { to: "/legal", label: "Paper only" },
];

/** Chrome for the reading pages: brand, three quiet links, one way onto the floor. */
export function Page({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a href="#page-main" className="skip-link">
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link to="/" className="flex min-h-11 items-center gap-2 rounded-sm">
            <span className="font-sans text-title font-medium tracking-tight">Satoshi&apos;s Council</span>
            <span className="font-mono text-micro uppercase tracking-widest text-subtle">paper desk</span>
          </Link>
          <nav aria-label="Reading pages" className="flex flex-wrap items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex min-h-11 items-center rounded-sm px-2 font-mono text-micro tracking-wide text-muted hover:bg-surface-2 hover:text-fg"
                activeProps={{ className: "bg-surface-3 text-fg" }}
              >
                {n.label}
              </Link>
            ))}
            <Link to="/" className="ml-1 flex min-h-11 items-center rounded-sm bg-fg px-3 font-mono text-micro font-medium text-bg hover:bg-chip">
              Open the floor
            </Link>
          </nav>
        </div>
      </header>
      <main id="page-main" className="mx-auto w-full max-w-[72ch] flex-1 px-4 py-8">
        <h1 className="font-sans text-[1.75rem] font-medium leading-tight tracking-tight text-fg">{title}</h1>
        <p className="mt-2 font-sans text-[1.0625rem] leading-relaxed text-muted">{lede}</p>
        <TrustStrip className="mt-4" />
        <div className="prose-desk mt-8">{children}</div>
        <div className="mt-10 border-t border-border pt-6">
          <Link to="/" className="inline-flex min-h-11 items-center rounded-sm bg-fg px-4 font-mono text-ui font-medium text-bg hover:bg-chip">
            Open the floor
          </Link>
          <span className="ml-3 font-mono text-micro text-subtle">The 60-second tour starts on your first visit; replay it from ? in the header.</span>
        </div>
      </main>
      <footer className="border-t border-border px-4 py-3 font-mono text-micro text-subtle">
        <div className="mx-auto max-w-4xl">Paper research desk · Bitcoin only · Not financial advice · Not affiliated with Kalshi.</div>
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
