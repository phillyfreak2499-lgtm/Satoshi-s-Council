/** The same plain-language notice on every public room. */
export function PaperDisclaimer() {
  return (
    <footer className="company-footer" data-tour="tour-footer">
      <div className="company-container">
      <div className="company-footer-top"><div><a href="/" className="company-footer-brand">Satoshi’s Council</a><p>Perspective. Discipline. A public record.</p></div><nav aria-label="Footer"><a href="/about">How it works</a><a href="/faq">FAQ</a><a href="/board">Community</a><a href="/?tab=settings">Preferences</a><a href="https://discord.gg/Z32GGkEneu" target="_blank" rel="noopener noreferrer">Discord</a><a href="https://www.facebook.com/groups/satoshiscouncil/" target="_blank" rel="noopener noreferrer">Facebook</a><a href="https://x.com/TEAS2PLEASE" target="_blank" rel="noopener noreferrer">X</a></nav></div>
      <p className="company-footer-notice">
        Paper research only · Bitcoin only · No live orders · Not financial advice · Not affiliated with Kalshi ·{" "}
        <a href="/legal" className="underline underline-offset-2 hover:text-fg">What paper means</a>
      </p>
      <p className="company-footer-chrome">
        Paper only · <a href="/faq" className="underline underline-offset-2 hover:text-fg">FAQ</a> ·{" "}
        <a href="/legal" className="underline underline-offset-2 hover:text-fg">Legal</a>
      </p>
      </div>
    </footer>
  );
}
