import { SiteHeader } from "@/components/desk/SiteHeader";

const NAV = [
  { href: "/", label: "Open the floor", primary: true },
  { href: "/arena", label: "The Pit" },
  { href: "/?tab=books", label: "Books" },
  { href: "/?tab=board", label: "Board" },
] as const;

/**
 * What /chamber shows when it cannot draw: no WebGL2, or a scene that failed to
 * start. Plain HTML on the site's own chrome, with the desk's normal navigation.
 * The desk itself never depends on the 3D view, so nothing else is affected.
 */
export function ChamberFallback({ reason, detail }: { reason: "webgl2" | "error"; detail?: string }) {
  const why =
    reason === "webgl2"
      ? "This browser or device does not offer WebGL2, which the 3D view needs."
      : "The 3D view could not start.";
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg" data-chamber-fallback={reason}>
      <a href="#page-main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader
        brandHref="/"
        nav={
          <a href="/" className="btn btn-primary btn-sm">
            Open the floor
          </a>
        }
        menu={NAV.map((n) => ({ label: n.label, href: n.href }))}
      />
      <main id="page-main" className="gutter mx-auto flex w-full max-w-[72ch] flex-1 flex-col justify-center py-16">
        <p className="font-mono text-micro uppercase tracking-widest text-subtle">Observation interface</p>
        <h1 className="mt-2 font-sans text-display font-medium tracking-tight text-fg">THE CHAMBER</h1>
        <p className="mt-3 font-sans text-body text-muted">Observation interface unavailable in 3D.</p>
        <p className="mt-1 font-sans text-ui text-subtle">
          {why}
          {detail ? ` (${detail})` : ""} The desk itself is unaffected.
        </p>
        <nav aria-label="Desk navigation" className="mt-8 flex flex-wrap gap-2">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={"primary" in n && n.primary ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
              {n.label}
            </a>
          ))}
        </nav>
        <p className="mt-10 font-mono text-micro text-subtle">Paper research desk · Bitcoin only · Not financial advice · Not affiliated with Kalshi</p>
      </main>
    </div>
  );
}
