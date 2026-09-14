import { createFileRoute } from "@tanstack/react-router";
import { H2, P, Page } from "@/components/desk/Page";

export const Route = createFileRoute("/legal")({
  head: () => ({
    meta: [
      { title: "Paper only · Satoshi's Council" },
      { name: "description", content: "Satoshi's Council is a paper-only research desk. No orders, no accounts, no advice, no affiliation with Kalshi." },
    ],
    links: [{ rel: "canonical", href: "https://satoshiscouncil.com/legal" }],
  }),
  component: Legal,
});

function Legal() {
  return (
    <Page title="Paper only, in plain words" lede="The short version: nothing on this site places a trade, holds money or tells you what to do with yours.">
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">Last updated September 14, 2026 · United States audience</p>
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
      <H2>Analytics and fonts</H2>
      <P>
        The site uses Google Analytics 4 to understand aggregate visits and feature use, and Google Fonts to serve Geist and IBM Plex Mono. Those providers
        may receive ordinary request details such as an IP address, browser information and the page requested. The desk does not send them an exchange
        account, wallet or real-money trading history because it has none.
      </P>
      <H2>Audience and jurisdiction</H2>
      <P>
        This notice is written for a United States audience. The law where you access the site still applies, and nothing here overrides local restrictions.
        The site does not accept wagers, open brokerage accounts or choose a trading venue for you. Do not use it where access would be unlawful.
      </P>
      <H2>Your data</H2>
      <P>
        Arena callsigns and alert subscriptions are tied to a random token stored in your own browser; there are no logins. Push alerts go only to a
        browser that turned them on in SETTINGS and can be turned off there.
      </P>
    </Page>
  );
}
