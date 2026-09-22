import type { Books } from "@/lib/desk/books";
import {
  CANONICAL_RECORD_HREF,
  CANONICAL_RECORD_LABEL,
  canonicalFromBooks,
  fmtCents,
  fmtPct,
} from "@/lib/desk/canonical-record";

/** Identical block on Home, Books, and About. Live numbers; one named scope. */
export function CanonicalRecord({ books, compact = false }: { books: Books | null | undefined; compact?: boolean }) {
  if (!books) {
    return (
      <section className="rounded-md border border-border bg-surface p-4" aria-label={CANONICAL_RECORD_LABEL}>
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">{CANONICAL_RECORD_LABEL}</div>
        <p className="mt-2 font-sans text-body text-muted">
          The live paper book is the record. Open <a href={CANONICAL_RECORD_HREF} className="text-fg underline underline-offset-2">Books</a> for calls, W–L, net after fees, and the interval.
        </p>
      </section>
    );
  }
  const r = canonicalFromBooks(books);
  const interval = r.interval ? `${fmtPct(r.interval[0])}–${fmtPct(r.interval[1])}` : "—";
  return (
    <section className="rounded-md border border-border bg-surface p-4" aria-label={CANONICAL_RECORD_LABEL}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">{CANONICAL_RECORD_LABEL}</div>
        {compact ? <a href={CANONICAL_RECORD_HREF} className="font-mono text-micro text-muted hover:text-fg">Full record →</a> : null}
      </div>
      <p className="mt-1 font-mono text-micro leading-relaxed text-subtle">{r.scope}</p>
      <div className={`mt-3 grid gap-2 text-center ${compact ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"}`}>
        <div><div className="font-mono text-title tabular text-fg">{r.calls}</div><div className="font-sans text-ui text-muted">calls</div></div>
        <div><div className="font-mono text-title tabular text-fg">{r.wins}–{r.losses}</div><div className="font-sans text-ui text-muted">W–L</div></div>
        <div><div className="font-mono text-title tabular text-fg">{fmtCents(r.net, 1)}</div><div className="font-sans text-ui text-muted">net after fees</div></div>
        <div><div className="font-mono text-title tabular text-fg">{fmtCents(r.avg, 1)}</div><div className="font-sans text-ui text-muted">avg / call</div></div>
        <div><div className="font-mono text-title tabular text-fg">{fmtCents(r.maxDrawdown, 1)}</div><div className="font-sans text-ui text-muted">max drawdown</div></div>
        <div><div className="font-mono text-title tabular text-fg">{interval}</div><div className="font-sans text-ui text-muted">95% interval · n={r.calls}</div></div>
      </div>
      <p className="mt-2 font-mono text-micro text-subtle">
        Arena, shadow Chair v2, and the 70¢ comparison are {compact ? <a href={CANONICAL_RECORD_HREF} className="text-muted underline underline-offset-2">different scope — see the canonical record</a> : "different scope — see this block"}.
      </p>
    </section>
  );
}
