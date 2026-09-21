import { useCountdownText } from "@/lib/desk/hooks";
import { clockMs } from "@/lib/desk/math";
import { clockET, fmtCents, fmtPct, type HourBrief } from "@/lib/desk/hour";
import type { HourResearchBrief } from "@/lib/desk/hour-research-brief";
import { utcStamp } from "@/lib/desk/display-evidence";
import { GlobalHeader } from "./GlobalHeader";
import { HourClockHero, HourResearchBoard } from "./HourResearch";
import { PaperDisclaimer } from "./PaperDisclaimer";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-sm border border-border bg-canvas p-3">
      <div className="font-mono text-micro uppercase tracking-widest text-subtle">{label}</div>
      <div className="mt-1 font-mono text-data tabular text-fg">{value}</div>
      {sub ? <div className="mt-1 font-mono text-micro text-muted">{sub}</div> : null}
    </div>
  );
}

function Block({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby={`hour-${n}`}>
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">{n}</div>
      <h2 id={`hour-${n}`} className="mt-1 font-sans text-title font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function LiveWindow({ data }: { data: HourBrief }) {
  const live = data.live;
  const closeMs = live ? Date.parse(live.close_time) : 0;
  const ticking = useCountdownText(closeMs);
  // The shared ticker has no server snapshot; print the time left as of the brief until it ticks.
  const left = ticking === "—" && live ? clockMs(Math.max(0, closeMs - Date.parse(data.at))) : ticking;
  return (
    <Block n="01" title="Live window">
      {!live ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">No open hourly contract in the feed this request. Nothing is guessed; the page rereads on the next load.</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Contract" value={live.ticker} sub={`${live.ladder} strikes on this hour · ${live.pick === "nearest-spot" ? "rung nearest spot" : "middle rung, spot unknown"}`} />
            <Stat label="Closes" value={left} sub={`${clockET(closeMs)} Eastern · ${utcStamp(live.close_time)}`} />
            <Stat label="Best ask" value={live.yes_ask == null ? "none in feed" : `${live.yes_ask}¢`} sub={live.yes_ask == null ? "the feed carried no ask" : `yes side · bid ${live.yes_bid == null ? "—" : `${live.yes_bid}¢`}`} />
            <Stat label="Posture" value={data.posture.lean} sub={data.posture.live_rule ? "hourly rule live" : "no hourly rule exists"} />
          </dl>
          <p className="mt-3 max-w-[78ch] font-sans text-ui leading-relaxed text-muted">{live.question}</p>
          <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            A strike ladder, not the 15-minute UP/DOWN contract.{live.strike != null ? ` This rung: ${usd(live.strike)}.` : ""} Settles on the CF Benchmarks value at the top of the hour. {data.posture.reason} Authority: {data.authority}.
          </p>
        </>
      )}
    </Block>
  );
}

export function HourRoom({ initial, research = null }: { initial: HourBrief | null; research?: HourResearchBrief | null }) {
  const data = initial;
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#hour-main" className="skip-link">Skip to content</a>
      <GlobalHeader />
      <main id="hour-main" className="council-reading-page council-page-wide gutter mx-auto w-full py-6 sm:py-8">
        <section className="border-b border-border pb-6">
          <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">Results · The hour</div>
          <h1 className="council-page-title mt-2 font-sans text-display font-medium tracking-tight">The hour on the record.</h1>
          <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">Same index. Longer window. Paper only.</p>
          {data ? <p className="mt-2 font-mono text-micro text-subtle">Kalshi series {data.series} · hourly book authority {data.authority} · as of {utcStamp(data.at)}.</p> : null}
        </section>

        {research ? <HourClockHero data={research} /> : null}

        {!data ? (
          <div className="mt-6 rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">The hour could not be read. This is not a zero result.</div>
        ) : (
          <>
            <LiveWindow data={data} />

            <HourResearchBoard data={research} />

            <Block n="08" title="Score">
              <p className="mt-2 font-mono text-micro text-subtle">{data.window.label}. Hourly ledger only; no 15-minute row is counted here.</p>
              {data.ledger_unavailable ? (
                <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">The hourly ledger could not be read this request. That is not a zero record.</p>
              ) : data.score.fills === 0 ? (
                <>
                  <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-fg">{data.copy.empty}</p>
                  <p className="mt-2 font-mono text-micro text-subtle">{data.score.windows} hourly {data.score.windows === 1 ? "window" : "windows"} graded, {data.score.sits} sat. No fill, so no win rate, no net and no drawdown to print.</p>
                </>
              ) : (
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Stat label="Sits" value={String(data.score.sits)} sub={`of ${data.score.windows} graded hourly windows`} />
                  <Stat label="Fills" value={String(data.score.fills)} sub={`${data.score.wins} won`} />
                  <Stat label="Win rate vs needed" value={`${fmtPct(data.score.win_rate)} vs ${fmtPct(data.score.needed)}`} sub="needed is the break-even rate at the prices paid" />
                  <Stat label="Net after fees" value={fmtCents(data.score.net)} sub="one contract per fill, real ask, real fee" />
                  <Stat label="Max drawdown" value={data.score.max_dd ? fmtCents(data.score.max_dd) : "0.0¢"} sub="worst peak to trough on the hourly book" />
                </dl>
              )}
            </Block>

            <Block n="09" title="One right WAIT">
              <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">{data.right_wait ? data.right_wait.reason : "There is no hourly WAIT to show yet. A sit becomes evidence only when a recorded lean never filled and the other side paid."}</p>
              {data.right_wait ? <p className="mt-2 font-mono text-micro text-subtle">{data.right_wait.ticker} · {utcStamp(data.right_wait.close_time)}</p> : null}
            </Block>

            <Block n="10" title="One wrong fill">
              {data.wrong_fill ? (
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Side" value={data.wrong_fill.side} sub={`${data.wrong_fill.result} paid`} />
                    <Stat label="Ask" value={`${data.wrong_fill.ask.toFixed(0)}¢`} sub={`fee ${data.wrong_fill.fee.toFixed(0)}¢`} />
                    <Stat label="Result after fee" value={fmtCents(data.wrong_fill.ev)} />
                    <Stat label="Closed" value={clockET(Date.parse(data.wrong_fill.close_time))} sub={utcStamp(data.wrong_fill.close_time)} />
                  </dl>
                  <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">{data.wrong_fill.question || data.wrong_fill.ticker}</p>
                </>
              ) : (
                <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">No real hourly fill has lost, because there is no hourly fill yet. Nothing is invented here.</p>
              )}
            </Block>

            <section className="mt-6 rounded-md border border-border bg-canvas p-4 sm:p-5" aria-label="Where to go next">
              <p className="font-sans text-ui text-fg">{data.copy.separate}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-micro">
                <a href="/desk" className="text-fg underline underline-offset-4">Live 15-minute floor <span aria-hidden="true">→</span></a>
                <a href="/record" className="text-fg underline underline-offset-4">This week (15-minute) <span aria-hidden="true">→</span></a>
                <a href="/training/wick" className="text-fg underline underline-offset-4">Start with WICK <span aria-hidden="true">→</span></a>
              </div>
            </section>
          </>
        )}
      </main>
      <PaperDisclaimer />
    </div>
  );
}
