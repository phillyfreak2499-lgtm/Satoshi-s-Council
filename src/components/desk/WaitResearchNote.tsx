/** Persistent context for the prolonged WAIT stretch. No live gate or outcome claims. */
export function WaitResearchNote() {
  return (
    <aside className="rounded-md border border-border bg-surface p-4 sm:p-5" aria-label="Why the desk has been waiting">
      <p className="font-sans text-micro uppercase tracking-widest text-wait">About this WAIT stretch</p>
      <h2 className="mt-2 font-sans text-title font-medium text-fg">Why the Floor is waiting</h2>
      <p className="mt-2 max-w-[75ch] font-sans text-ui leading-relaxed text-muted">
        The Council has not found enough qualifying paper calls lately. A call needs supporting evidence,
        a price worth paying and confirmation; sometimes the book is already too expensive. The reason for
        this window's WAIT appears in the live decision above. A healthy feed can still lead to WAIT.
      </p>
      <p className="mt-2 max-w-[75ch] font-sans text-ui leading-relaxed text-muted">
        We are studying where possible calls stop and checking proposed changes against settled windows.
        The research cannot change the live decision or book a call by itself. We want UP and DOWN calls
        back when the evidence earns them; there is no promised date. <a href="/lab" className="underline underline-offset-2 hover:text-fg">Follow the research →</a>
      </p>
    </aside>
  );
}
