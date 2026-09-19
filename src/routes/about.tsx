import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { H2, P, Page } from "@/components/desk/Page";
import { COUNCIL_STRUCTURE_SENTENCE, COUNCIL_STRUCTURE_SHORT, COUNCIL_TOTAL_SEATS, COUNCIL_VOTING_SEATS, COUNCIL_PIT_CREW_SEATS } from "@/lib/desk/council-public";

export const Route = createFileRoute("/about")({
  head: () => pageHead("/about", "About · Satoshi's Council", "Meet the Council: 21 seats total, with 18 voting specialists and 3 non-voting pit-crew seats. Paper-only Bitcoin research."),
  component: About,
});

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "1",
    title: "Read",
    body: `${COUNCIL_STRUCTURE_SENTENCE} They sit across five desks. STRUCTURE reads candles and swings. TAPE reads order flow and the Kalshi book. DERIVS reads funding, open interest and liquidations. BOOK reads the odds themselves. CONTEXT reads the clock and the regime. Each seat has one job.`,
  },
  {
    n: "2",
    title: "Vote",
    body: "Only the 18 voting specialists cast UP, DOWN or WAIT votes. WARDEN, ORBIT and WIRE never count as votes; they provide guard and context signals to the Chair. A voting specialist that is not sure enough sits. SATOSHI weighs the eligible voting seats by their graded record and agreement. The score has to clear a bar or the desk waits. WAIT is the most common call, on purpose.",
  },
  {
    n: "3",
    title: "Grade",
    body: "The window settles on Kalshi's official value. Voting-seat directional reads and the Chair's directional call are graded against the result; recorded paper positions are graded in cents after the fee. Pit-crew context remains non-voting. The books are public.",
  },
];

function About() {
  return (
    <Page title="How the desk works" lede="A paper-only Bitcoin research desk. The Council has 21 seats: 18 voting specialists and 3 non-voting pit-crew seats. SATOSHI chairs the vote.">
      <section className="mb-4 rounded-md border border-border bg-surface p-4" aria-label="Council structure">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">Council structure</div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div><div className="font-mono text-title tabular text-fg">{COUNCIL_TOTAL_SEATS}</div><div className="font-sans text-ui text-muted">seats total</div></div>
          <div><div className="font-mono text-title tabular text-fg">{COUNCIL_VOTING_SEATS}</div><div className="font-sans text-ui text-muted">vote</div></div>
          <div><div className="font-mono text-title tabular text-fg">{COUNCIL_PIT_CREW_SEATS}</div><div className="font-sans text-ui text-muted">pit crew</div></div>
        </div>
        <p className="mt-2 text-center font-mono text-micro text-subtle">{COUNCIL_STRUCTURE_SHORT}</p>
      </section>
      <ol className="grid gap-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-md border border-border bg-surface p-4">
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">step {s.n}</div>
            <div className="mt-1 font-sans text-title font-medium text-fg">{s.title}</div>
            <p className="mt-1.5 font-sans text-body leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <P>
        The live floor grades 15-minute Bitcoin windows. The <a href="/training/wick" className="text-fg underline underline-offset-2">apprentice desk</a> teaches the same read without requiring you to sit every window. A separate <a href="/hour" className="text-fg underline underline-offset-2">hourly book</a> uses the same settlement family and keeps its own record.
      </P>
      <H2>What the words mean</H2>
      <P>
        A <strong className="text-fg">Council seat</strong> is one specialist role with one job. Eighteen are voting specialists; three are non-voting pit crew. The <strong className="text-fg">chair</strong> is SATOSHI, who weighs eligible voting seats and makes the
        call. A <strong className="text-fg">window</strong> is one 15-minute Kalshi market on Bitcoin: will the final-minute average finish above the strike or
        not. <strong className="text-fg">Paper</strong> means the desk books every call at the real ask, pays the real fee, and settles on the real result, without ever sending an
        order.
      </P>
      <H2>What it is not</H2>
      <P>
        It is not a trading bot, a signal service or advice. There is no account, no deposit and no live-trading arm. It is not affiliated with Kalshi; the
        desk reads Kalshi&apos;s public prices and official settlement values. It is Bitcoin only.
      </P>
      <H2>Why watch it</H2>
      <P>
        Because it argues out loud. Every call comes with the hypothesis, the evidence, the counter and the thing that would invalidate it, and every call is
        graded where you can see it. Hover or tap any dotted label on the floor for a one-line definition.
      </P>
      <H2>Follow the evidence</H2>
      <nav className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Evidence rooms">
        <a href="/books" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Books</strong><span className="block font-mono text-micro text-muted">paper P&amp;L and window replays</span></a>
        <a href="/board" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Board</strong><span className="block font-mono text-micro text-muted">desk updates and public feedback</span></a>
        <a href="/chamber" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Chamber</strong><span className="block font-mono text-micro text-muted">evidence-backed desk speech</span></a>
        <a href="/lab" className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2"><strong className="text-fg">Lab</strong><span className="block font-mono text-micro text-muted">frozen rules and live samples</span></a>
      </nav>
    </Page>
  );
}
