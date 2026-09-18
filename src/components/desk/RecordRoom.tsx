import { useEffect, useRef, useState } from "react";
import { fmtCents, fmtPct, scoreNote, type WeekRecord } from "@/lib/desk/record";
import { publicWeekRecord } from "@/lib/desk/record-public";
import { utcStamp } from "@/lib/desk/display-evidence";
import { GlobalHeader } from "./GlobalHeader";
import { PaperDisclaimer } from "./PaperDisclaimer";

/** One graded window, linked to its replay when one exists. */
function WindowLink({ ticker, close_time, replay }: { ticker: string; close_time: string; replay: boolean }) {
  const when = utcStamp(close_time);
  return replay ? (
    <a href={`/window/${encodeURIComponent(ticker)}`} className="font-mono text-micro text-fg underline underline-offset-4">
      Replay · {when} <span aria-hidden="true">↗</span>
    </a>
  ) : (
    <span className="font-mono text-micro text-subtle">{when} · no replay was recorded for this window</span>
  );
}

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
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby={`record-${n}`}>
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">{n}</div>
      <h2 id={`record-${n}`} className="mt-1 font-sans text-title font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

/** A brief older than this is reread: on mount, when the tab comes back into view, and on a timer while it stays open. */
const REREAD_AFTER_MS = 60_000;

export function RecordRoom({ initial }: { initial: WeekRecord | null }) {
  const [data, setData] = useState<WeekRecord | null>(initial);
  const readAt = useRef(initial ? Date.parse(initial.at) : 0);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    // The 7-day window rolls every 15 minutes. The first paint is this minute's
    // week because the page is never cached; if a browser still hands back an
    // old copy (a back navigation, a restored tab), the brief is reread at once,
    // and an open tab rereads on a timer and whenever it comes back into view.
    let alive = true;
    let busy = false;
    const reread = async () => {
      if (busy || document.visibilityState !== "visible" || Date.now() - readAt.current < REREAD_AFTER_MS) return;
      busy = true;
      try {
        const next = await publicWeekRecord();
        if (!alive || !next) return;
        readAt.current = Date.parse(next.at) || Date.now();
        setData(next);
      } catch {
        /* keep the brief already on screen; it is dated */
      } finally {
        busy = false;
      }
    };
    const onVisible = () => void reread();
    void reread();
    const timer = setInterval(onVisible, REREAD_AFTER_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);
  const note = data ? scoreNote(data) : null;
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.copy);
      setCopied("copied");
    } catch {
      setCopied("select the text below and copy it");
    }
  };
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#record-main" className="skip-link">Skip to content</a>
      <GlobalHeader />
      <main id="record-main" className="council-reading-page council-page-wide gutter mx-auto w-full py-6 sm:py-8">
        <section className="border-b border-border pb-6">
          <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">Results · This week</div>
          <h1 className="council-page-title mt-2 font-sans text-display font-medium tracking-tight">The week on the record.</h1>
          <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">Paper grades. Public prices. No live orders.</p>
          {data ? <p className="mt-2 font-mono text-micro text-subtle">{data.window.label}. As of {utcStamp(data.at)}.</p> : null}
        </section>

        {!data ? (
          <div className="mt-6 rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">The week could not be read. This is not a zero result; the books are unchanged.</div>
        ) : (
          <>
            <Block n="01" title="Score">
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Sits" value={String(data.score.sits)} sub={`of ${data.score.windows} graded windows`} />
                <Stat label="Fills" value={String(data.score.fills)} sub={data.score.fills ? `${data.score.wins} won` : "no paper fills this week"} />
                <Stat label="Win rate vs needed" value={data.score.fills ? `${fmtPct(data.score.win_rate)} vs ${fmtPct(data.score.needed)}` : "—"} sub={data.score.fills ? "needed is the break-even rate at the prices paid" : "nothing to grade"} />
                <Stat label="Net after fees" value={fmtCents(data.score.net)} sub="one contract per fill, real ask, real fee" />
                <Stat label="Max drawdown" value={data.score.max_dd == null ? "—" : data.score.max_dd ? fmtCents(data.score.max_dd) : "0.0¢"} sub={data.score.max_dd == null ? "scorecard unavailable this refresh" : "worst peak to trough this week"} />
              </dl>
              <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
                {note?.text} <a href="/books" className="text-fg underline underline-offset-4">Books, last 7 days <span aria-hidden="true">→</span></a>
              </p>
            </Block>

            <Block n="02" title="One WAIT that was the right call">
              {data.best_wait ? (
                <>
                  <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">{data.best_wait.reason}</p>
                  <div className="mt-3"><WindowLink ticker={data.best_wait.ticker} close_time={data.best_wait.close_time} replay={data.best_wait.replay} /></div>
                </>
              ) : (
                <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">No WAIT this week can be shown as a saved loss. Sits are the default answer, not a score.</p>
              )}
            </Block>

            <Block n="03" title="One fill that was wrong">
              {data.wrong_fill ? (
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Side" value={data.wrong_fill.side ?? "—"} sub={`settled ${data.wrong_fill.winner}`} />
                    <Stat label="Ask" value={`${data.wrong_fill.ask.toFixed(0)}¢`} sub={`fee ${data.wrong_fill.fee.toFixed(0)}¢`} />
                    <Stat label="Result after fee" value={fmtCents(data.wrong_fill.ev)} />
                    <Stat label="Invalidate line" value={data.wrong_fill.invalidate ? "recorded" : "not recorded"} />
                  </dl>
                  <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">
                    {data.wrong_fill.invalidate ? `The read was off if ${data.wrong_fill.invalidate}.` : "No invalidation condition was recorded at the first directional read for this window."}
                  </p>
                  <div className="mt-3"><WindowLink ticker={data.wrong_fill.ticker} close_time={data.wrong_fill.close_time} replay={data.wrong_fill.replay} /></div>
                </>
              ) : (
                <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">{data.score.fills ? "No fill lost this week." : "No fills in the last 7 days. Nothing to grade here, and nothing is invented."}</p>
              )}
            </Block>

            <Block n="04" title="One seat note">
              <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">{data.seat_note ? data.seat_note.line : "No graded directional seat reads this week."}</p>
              <p className="mt-2 font-mono text-micro text-subtle">A seat record is a graded frequency, not a rating. It does not change how the Chair hears the seat.</p>
            </Block>

            {data.missing_windows > 0 ? (
              <Block n="05" title="Missing windows">
                <p className="mt-3 font-sans text-ui leading-relaxed text-muted">Missing windows are outages in the record, not WAITs. {data.missing_windows} in the last 90 days. <a href="/books" className="underline underline-offset-4">See the books</a>.</p>
              </Block>
            ) : null}

            <section className="mt-6 rounded-md border border-border bg-canvas p-4 sm:p-5" aria-label="Where to go next">
              <p className="font-sans text-ui text-fg">A directional read and a recorded paper fill are different.</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-micro">
                <a href="/desk" className="text-fg underline underline-offset-4">Open the live floor <span aria-hidden="true">→</span></a>
                <a href="/training/wick" className="text-fg underline underline-offset-4">Start with WICK <span aria-hidden="true">→</span></a>
                <a href="/books" className="text-fg underline underline-offset-4">Full books <span aria-hidden="true">→</span></a>
              </div>
              <p className="mt-3 font-mono text-micro text-subtle">A longer Bitcoin clock is graded separately <a href="/hour" className="text-fg underline underline-offset-4">→ /hour</a></p>
            </section>

            <details className="mt-6 rounded-md border border-border bg-surface p-4">
              <summary className="cursor-pointer font-sans text-ui text-fg">Copy the week</summary>
              <p className="mt-2 font-mono text-micro text-subtle">Plain text, in the site voice. Paste it where you like.</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-sm border border-border bg-canvas p-3 font-mono text-micro leading-relaxed text-muted">{data.copy}</pre>
              <div className="mt-3 flex items-center gap-3">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>Copy</button>
                {copied ? <span role="status" className="font-mono text-micro text-subtle">{copied}</span> : null}
              </div>
            </details>
          </>
        )}
      </main>
      <PaperDisclaimer />
    </div>
  );
}
