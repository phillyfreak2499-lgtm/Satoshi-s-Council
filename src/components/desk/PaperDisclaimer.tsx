/** The same plain-language notice on every public room. */
export function PaperDisclaimer() {
  return (
    <footer className="company-footer" data-tour="tour-footer">
      <div className="company-container">
      <div className="company-footer-top"><div><a href="/" className="company-footer-brand">Satoshi’s Council</a><p>Perspective. Discipline. A public record.</p></div><nav aria-label="Footer"><a href="/about">How it works</a><a href="/faq">FAQ</a><a href="/board">Community</a><a href="/?tab=settings">Preferences</a></nav></div>
      <p className="company-footer-notice">
        Paper research only · Bitcoin only · No live orders · Not financial advice · Not affiliated with Kalshi ·{" "}
        <a href="/legal" className="underline underline-offset-2 hover:text-fg">What paper means</a>
      </p>
      </div>
    </footer>
  );
}
