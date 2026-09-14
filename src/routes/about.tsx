import { createFileRoute } from "@tanstack/react-router";
import { H2, P, Page } from "@/components/desk/Page";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How the desk works · Satoshi's Council" },
      { name: "description", content: "Twenty-one specialist seats read Bitcoin every 15 minutes; SATOSHI chairs the vote; every window is graded on paper. Nothing here places a live trade." },
    ],
  }),
  component: About,
});

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "1",
    title: "Read",
    body: "Twenty-one seats sit at five desks. STRUCTURE reads candles and swings. TAPE reads order flow and the Kalshi book. DERIVS reads funding, open interest and liquidations. BOOK reads the odds themselves. CONTEXT reads the clock and the regime. Each seat looks at one thing and says what it sees.",
  },
  {
    n: "2",
    title: "Vote",
    body: "Eighteen of the seats vote UP, DOWN or WAIT with a confidence; three — WARDEN, ORBIT and WIRE — sit as non-voting pit crew whose reads inform the chair but never count as a vote. A voting seat that is not sure enough sits; you still see what it whispered. SATOSHI weighs the seats by their graded record and how much they agree. The score has to clear a bar or the desk waits. WAIT is the most common call, on purpose.",
  },
  {
    n: "3",
    title: "Grade",
    body: "The window settles on Kalshi's official value, and every seat and the chair are marked right or wrong, in cents, after the fee they would have paid. Skills move between LIVE, SHADOW, BENCH, UNCALIBRATED and MUTED on that record alone. The books are public.",
  },
];

function About() {
  return (
    <Page title="How the desk works" lede="A paper-only Bitcoin research desk. Every 15 minutes, twenty-one specialist seats read the market, SATOSHI chairs the vote, and the result is graded in public.">
      <ol className="grid gap-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-md border border-border bg-surface p-4">
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">step {s.n}</div>
            <div className="mt-1 font-sans text-title font-medium text-fg">{s.title}</div>
            <p className="mt-1.5 font-sans text-body leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <H2>What the words mean</H2>
      <P>
        A <strong className="text-fg">seat</strong> is one specialist with one job. The <strong className="text-fg">chair</strong> is SATOSHI, who weighs the seats and makes the
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
