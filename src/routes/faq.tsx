import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import * as Accordion from "@radix-ui/react-accordion";
import { Page } from "@/components/desk/Page";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ · Satoshi's Council" },
      { name: "description", content: "What a seat is, why the desk says WAIT so often, what paper means, whether money is at risk, and why it is Bitcoin only." },
    ],
  }),
  component: Faq,
});

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "What is a seat?",
    a: "One specialist with one job. WICK reads candles, TAPE reads the Kalshi book, CARRY reads funding, CLOCK reads the session, and so on. Twenty-one of them sit at five desks; eighteen vote UP, DOWN or WAIT with a confidence, while three — WARDEN, ORBIT and WIRE — sit as non-voting pit crew that inform the chair. Each shows its hypothesis, evidence and counter.",
  },
  {
    q: "Why does the desk say WAIT so often?",
    a: "Because a 15-minute Bitcoin window is close to a coin flip most of the time, and the price already knows it. The chair only calls a side when the seats agree hard enough to be worth the ask plus the fee. WAIT is the honest answer more often than not, and the books show what happens when it speaks.",
  },
  {
    q: "How is the paper book doing?",
    a: (
      <>
        Open <a href="/books" className="text-fg underline underline-offset-2">the Books</a>. Every result is labeled by scope: today, this week, the current floor era, or all-time. Net cents include the recorded entry and Kalshi fee, and the live 80¢ floor trial is shown beside the 70¢ shadow book on the same windows. It is a record, not a promised edge.
      </>
    ),
  },
  {
    q: "The chair shows UP or DOWN but the log has no fill. Why?",
    a: "The price floor. The chair's read and the paper book are two different things. The book fills at 80¢ or better — a time-boxed trial of a higher floor, raised from 70¢ because on the record the chair's cheaper calls lost money. A read under the floor still shows on the strip and still grades the seats; it is booked only if the ask reaches the floor before the window closes. The old 70¢ floor is still counted alongside as a shadow book, so the trial can be judged against the thing it replaced on the same windows. The shadow is research and never gates a fill.",
  },
  {
    q: "What does paper mean?",
    a: "Every call is booked at the real ask, charged the real Kalshi fee, held to the real settlement, and graded in cents. No order is ever sent. The ledger, the seats' records and the chair's books are all paper.",
  },
  {
    q: "Is any money at risk?",
    a: "No. There is no account, no deposit, no wallet and no live-trading arm. The Arena lets you make your own paper calls under a callsign; those are paper too.",
  },
  {
    q: "Why Bitcoin only?",
    a: "The desk is built around one market: Kalshi's 15-minute Bitcoin contract, which settles on the average of the final minute's sixty BRTI prints. Every seat, every grade and every replay assumes that window. There is no ETH and no basket.",
  },
  {
    q: "What do the seat and skill status labels mean?",
    a: "There are two layers. A seat status says how the chair hears a specialist: LIVE votes normally; UNCALIBRATED is still earning history; MUTED is owner-silenced; FADED is discounted; FOLDED or DOWN does not vote; VETO is a hard block; INVERT is retired and never flips a side. A skill status says where one rule sits: CANDIDATE is proposed, SHADOW is being evaluated, LIVE is eligible to speak, and BENCH is parked. WAIT and SIT are current-window reads, not status levels.",
  },
  {
    q: "Where do the prices come from?",
    a: "Spot from public exchange feeds, the book and settlement values from Kalshi's public API, derivatives from public venue endpoints. When a feed goes stale the desk says so on the strip; a seat that cannot see sits.",
  },
  {
    q: "Is this affiliated with Kalshi?",
    a: "No. The desk reads Kalshi's public prices and official settlement values to grade itself. It has no relationship with Kalshi and places no orders anywhere.",
  },
];

function Faq() {
  return (
    <Page title="Questions people ask" lede="Short answers. Anything you still wonder about, post it on the BOARD from the floor.">
      <Accordion.Root type="multiple" defaultValue={["q0", "q1"]} className="grid gap-2">
        {QA.map((item, i) => (
          <Accordion.Item key={i} value={`q${i}`} className="rounded-md border border-border bg-surface">
            <Accordion.Header>
              <Accordion.Trigger className="group flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left font-sans text-body font-medium text-fg hover:bg-surface-2">
                {item.q}
                <span aria-hidden="true" className="font-mono text-muted transition-transform group-data-[state=open]:rotate-45">
                  +
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="px-4 pb-3 font-sans text-body leading-relaxed text-muted">{item.a}</Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
      <nav className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Follow the evidence">
        <a href="/books" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Books</strong><span className="block font-mono text-micro text-muted">paper P&amp;L and replays</span></a>
        <a href="/board" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Board</strong><span className="block font-mono text-micro text-muted">updates, ideas, and feedback</span></a>
        <a href="/chamber" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Chamber</strong><span className="block font-mono text-micro text-muted">what the desk said and why</span></a>
        <a href="/lab" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Lab</strong><span className="block font-mono text-micro text-muted">prospective experiments</span></a>
      </nav>
    </Page>
  );
}
