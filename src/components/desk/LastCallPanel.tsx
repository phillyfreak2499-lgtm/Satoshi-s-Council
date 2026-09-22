import { useEffect, useState } from "react";
import type { BooksWindow } from "@/lib/desk/books";
import { lastCallLine } from "@/lib/desk/last-call-panel";
import { publicLastFill, publicLastWindow } from "@/lib/desk/record-public";

/**
 * Permanent floor panel: the last recorded paper fill, plus a replay door.
 * Replaces the "floor is measuring" modal as the proof the desk is selective.
 */
export function LastCallPanel({
  last,
  fill,
}: {
  last?: BooksWindow | null;
  fill?: BooksWindow | null;
}) {
  const [remoteFill, setRemoteFill] = useState<BooksWindow | null>(fill ?? null);
  const [remoteLast, setRemoteLast] = useState<BooksWindow | null>(last ?? null);

  useEffect(() => {
    if (fill) setRemoteFill(fill);
    if (last) setRemoteLast(last);
    if (fill && last) return;
    let alive = true;
    Promise.all([
      fill ? Promise.resolve(fill) : publicLastFill().catch(() => null),
      last ? Promise.resolve(last) : publicLastWindow().catch(() => null),
    ]).then(([nextFill, nextLast]) => {
      if (!alive) return;
      if (!fill) setRemoteFill(nextFill);
      if (!last) setRemoteLast(nextLast);
    });
    return () => {
      alive = false;
    };
  }, [fill, last]);

  const line = lastCallLine(remoteFill, remoteLast);
  if (!line) return null;

  return (
    <section
      aria-label="Last recorded paper call"
      className="rounded-md border border-border bg-surface p-4 sm:p-5"
    >
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">{line.label}</p>
      <p className="mt-2 font-sans text-body leading-relaxed text-fg">
        <a href={line.href} className="text-fg underline underline-offset-2 hover:text-muted">
          {line.text}
        </a>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {line.replayHref ? (
          <a
            href={line.replayHref}
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 font-mono text-ui text-fg hover:bg-surface-2"
          >
            Watch a real call →
          </a>
        ) : null}
        <a href="/books" className="font-mono text-micro text-muted hover:text-fg">
          Full record
        </a>
      </div>
    </section>
  );
}
