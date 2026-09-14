import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const shell =
  "flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-fg";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className={shell}>
      <span className="text-down" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <p className="font-mono text-micro uppercase tracking-[0.22em] text-subtle">
        The Council hit turbulence
      </p>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md font-mono text-ui break-words text-muted">
        {error.message || "An unexpected error occurred. Try reloading the page."}
      </p>
      <a href="/" className="btn btn-primary">
        return to the floor
      </a>
    </main>
  );
}

export function AppNotFoundComponent() {
  return (
    <main className={shell}>
      <div
        className="grid size-16 place-items-center rounded-full border border-gold/40 bg-gold/10 font-mono text-lg text-gold"
        aria-hidden="true"
      >
        404
      </div>
      <p className="font-mono text-micro uppercase tracking-[0.22em] text-subtle">
        Satoshi&apos;s Council
      </p>
      <h1 className="text-2xl font-semibold">That room is not on the floor.</h1>
      <p className="max-w-md font-mono text-ui text-muted">
        The link may be old, mistyped, or tied to a seat or window that does not exist.
      </p>
      <nav className="flex flex-wrap justify-center gap-2" aria-label="Recovery links">
        <a href="/" className="btn btn-primary">
          open the floor
        </a>
        <a href="/faq" className="btn btn-secondary">
          read the FAQ
        </a>
      </nav>
    </main>
  );
}
