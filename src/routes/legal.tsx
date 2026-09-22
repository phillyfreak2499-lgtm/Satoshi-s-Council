import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { H2, P, Page } from "@/components/desk/Page";

export const Route = createFileRoute("/legal")({
  head: () => pageHead("/legal", "Paper only · Satoshi's Council", "Satoshi’s Council is a paper-only research desk. No live orders, no accounts, no financial advice, and no affiliation with Kalshi."),
  component: Legal,
});

function Legal() {
  return (
    <Page title="Paper only, in plain words" lede="The short version: nothing on this site places a trade, holds money or tells you what to do with yours.">
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">Last updated September 22, 2026 · United States audience</p>
      <H2>No orders, no accounts</H2>
      <P>
        Satoshi&apos;s Council never sends an order to any exchange or market. It has no accounts, deposits, wallets or payment flows. The calls, the ledger,
        the Arena and the books are paper: booked at public prices, charged the public fee, settled on the public result, and never real.
      </P>
      <H2>Not financial advice</H2>
      <P>
        Every UP, DOWN and WAIT is a research output from software that is still learning, and the site says so on every screen. Nothing here is a
        recommendation to buy, sell or hold anything. If you trade on your own account, that decision and its outcome are yours alone.
      </P>
      <H2>Not affiliated with Kalshi</H2>
      <P>
        The desk reads Kalshi&apos;s public prices and official settlement values to grade itself. It has no relationship with Kalshi, Inc. and no access to
        any account there. Kalshi is a trademark of its owner.
      </P>
      <H2>Data and delays</H2>
      <P>
        Prices, books and derivatives come from public feeds that can lag, pause or fail. The strip shows each feed&apos;s health; a seat that cannot see
        sits. Figures shown as PAPER are computed from those feeds and can differ from what a real order would have done.
      </P>
      <H2>Cookies and analytics</H2>
      <P>
        The site uses Google Analytics 4 for aggregate visits and Google Fonts for Geist and IBM Plex Mono. Ordinary request details (IP, browser, page) go to
        those providers. There is no advertising cookie wall and no account. The desk does not send them an exchange account, wallet or real-money trading
        history because it has none.
      </P>
      <H2>Audience and jurisdiction</H2>
      <P>
        This notice is written for a United States audience. The law where you access the site still applies, and nothing here overrides local restrictions.
        The site does not accept wagers, open brokerage accounts or choose a trading venue for you. Do not use it where access would be unlawful.
      </P>
      <H2>Your data</H2>
      <P>
        Board posts are public. The desk can hide or restore posts, retaining their original text and an internal moderation reason.
        To limit spam, the Board keeps a one-way network identifier and recent posting counts; it does not store your raw IP address in that record.
        Inactive rate-limit records are removed after seven days when new posts are processed.
      </P>
      <P>
        Arena callsigns and alert subscriptions are tied to a random token stored in your own browser; there are no logins. Push alerts go only to a
        browser that turned them on in SETTINGS and can be turned off there. The desk can hide a callsign that breaks house rules. Paper results
        stay on the private record.
      </P>
      <H2>Contact</H2>
      <P>
        Public questions about the desk stay on the Board at <a href="/board" className="underline underline-offset-2 hover:text-fg">/board</a>.
      </P>
      <P>
        Legal, trademark and security reports are not public conversation. Start a Board post whose first line is exactly LEGAL, TRADEMARK or SECURITY.
        The desk hides that post after reading and keeps the original text in the moderation log. Do not attach credentials, private keys or account passwords.
      </P>
    </Page>
  );
}
