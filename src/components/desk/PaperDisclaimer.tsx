/** The same plain-language notice on every public room. */
export function PaperDisclaimer() {
  return (
    <footer className="border-t border-border px-4 py-3 font-mono text-micro leading-relaxed text-subtle">
      <p className="mx-auto max-w-5xl">
        Paper research only · Bitcoin only · No live orders · Not financial advice · Not affiliated with Kalshi ·{" "}
        <a href="/legal" className="underline underline-offset-2 hover:text-fg">What paper means</a>
      </p>
    </footer>
  );
}
