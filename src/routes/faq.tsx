import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import * as Accordion from "@radix-ui/react-accordion";
import { Page } from "@/components/desk/Page";
import { COUNCIL_STRUCTURE_SENTENCE, COUNCIL_STRUCTURE_SHORT, COUNCIL_RETIRED_MEANS } from "@/lib/desk/council-public";

export const Route = createFileRoute("/faq")({
  head: () => pageHead("/faq", "Frequently asked questions · Satoshi's Council", "Understand paper calls, fees, settlement, research samples and the Council. Nothing here places a live order."),
  component: Faq,
});

/** Every answer is a plain string, so the first-paint HTML carries it as readable text with no JSX to hydrate. */
const QA: { q: string; a: string }[] = [
  {
    q: "How many Council seats actually vote?",
    a: `${COUNCIL_STRUCTURE_SENTENCE} Each seat has one job: WICK reads candles, TAPE reads the Kalshi book, CARRY reads funding, CLOCK reads the session, and so on. Only the 15 currently voting specialists can cast UP, DOWN or WAIT votes. The three pit-crew seats never count as votes. WARDEN, ORBIT and WIRE provide guard and context signals. ODDS, CHEAP and FADE are retired from votes. ${COUNCIL_RETIRED_MEANS} SATOSHI chairs the vote.`,
  },
  {
    q: "Why does the desk say WAIT so often?",
    a: "Because a 15-minute Bitcoin window is close to a coin flip most of the time, and the price already knows it. The chair only calls a side when the seats agree hard enough to be worth the ask plus the fee. WAIT is the honest answer more often than not, and the books show what happens when it speaks.",
  },
  {
    q: "How is the paper book doing?",
    a: "Open the Books at /books. The canonical paper record is the live 80¢ book: calls, W–L, net after fees, average per call, max drawdown, and a 95% interval, with the scope printed on the block. Today, this week, Arena, shadow Chair v2, and the 70¢ comparison are different scopes. It is a record, not a promised edge.",
  },
  {
    q: "What does selective mode require?",
    a: "There is no daily call quota and one loss does not automatically stop the desk. Each new entry still needs three healthy supporters from two evidence groups, no opposing vote, 3–10 minutes remaining, fresh feeds, a tight spread and resting size. The main model needs at least 3¢ after fees; a fresh settlement-index estimate must cover the ask and fee. Confirmation takes three observations over at least eight seconds. If the Central day's net after fees reaches −100¢, tighter checks stay on for the rest of that day: four healthy supporters from three groups, at least 5¢ main-model edge, more than 2¢ settlement-index margin, and five observations over at least twenty seconds. Once the day is profitable and has five wins or has reached +100¢ net, each new entry must leave the day positive even if it and all pending positions lose their full cost plus fees. A thin profit cushion can therefore mean WAIT. −100¢ is a tightening trigger, not a maximum possible daily loss. These owner-selected rules do not guarantee wins. Existing positions settle normally; Lab research stays separate.",
  },
  {
    q: "The chair shows UP or DOWN but the log has no fill. Why?",
    a: "The book needs a real ask at 80¢ or above and every selective-mode check must still pass when it pays. Reaching 80¢ alone is not permission to fill. The shared desk shows WAIT when the current setup, confirmation, feeds or daily limits block entry. A read and a booked position remain separate records, and an existing position stays locked until settlement. The 70¢ shadow comparison is research and never authorizes a fill.",
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

/** The first three answers are open on first paint; every answer is in the HTML, closed ones hidden. */
const OPEN_FIRST = ["q0", "q1", "q2"];

function Faq() {
  return (
    <Page title="Questions people ask" lede="Short answers. Anything you still wonder about, post it on the BOARD from the floor.">
      <div className="mb-4 rounded-md border border-border bg-surface px-4 py-3 font-mono text-micro text-subtle" role="note">
        <strong className="text-fg">Council structure:</strong> {COUNCIL_STRUCTURE_SHORT}. SATOSHI chairs; pit crew inform the Chair but never vote.
      </div>
      <Accordion.Root type="multiple" defaultValue={OPEN_FIRST} className="grid gap-2">
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
            <Accordion.Content forceMount className="px-4 pb-3 font-sans text-body leading-relaxed text-muted data-[state-closed]:hidden data-[state=closed]:hidden">{item.a}</Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
      <nav className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Follow the evidence">
        <a href="/books" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Books</strong><span className="block font-mono text-micro text-muted">paper P&L and replays</span></a>
        <a href="/board" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Board</strong><span className="block font-mono text-micro text-muted">updates, ideas, and feedback</span></a>
        <a href="/chamber" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Chamber</strong><span className="block font-mono text-micro text-muted">what the desk said and why</span></a>
        <a href="/lab" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Lab</strong><span className="block font-mono text-micro text-muted">prospective experiments</span></a>
      </nav>
    </Page>
  );
}
