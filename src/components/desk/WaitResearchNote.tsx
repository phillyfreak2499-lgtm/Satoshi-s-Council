/** Persistent context for the prolonged WAIT stretch. No live gate or outcome claims. */
export function WaitResearchNote() {
  return (
    <aside className="rounded-md border border-border bg-surface p-4 sm:p-5" aria-label="Why the desk has been waiting">
      <p className="font-mono text-micro uppercase tracking-widest text-wait">A longer WAIT stretch</p>
      <h2 className="mt-2 font-sans text-title font-medium text-fg">The Floor is still reading every window.</h2>
      <p className="mt-2 max-w-[75ch] font-sans text-ui leading-relaxed text-muted">
        SATOSHI has made few qualifying directional calls recently. The current rules need independent support,
        a qualifying price and confirmation before a paper call can book. We are measuring where promising
        setups stop in a separate research study. That study cannot change the live Chair or place a call.
      </p>
      <p className="mt-2 max-w-[75ch] font-sans text-ui leading-relaxed text-muted">
        WAIT is an intentional decision, but this long quiet stretch deserves investigation. We have no date
        for the next UP or DOWN paper call. <a href="/lab" className="underline underline-offset-2 hover:text-fg">See the research →</a>
      </p>
    </aside>
  );
}
