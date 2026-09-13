import { useEffect, useMemo, useState } from "react";
import { listChamberSpeech } from "@/lib/desk/chamber-speech";
import type { ChamberStatement } from "@/lib/desk/chamber-reactions";
import { SiteHeader } from "./SiteHeader";
import { Crest } from "./Crest";

const CAST = [
  ["SATOSHI", "Chair", "Speaks from finalized Chair milestones and recorded paper calls."],
  ["WARDEN", "Integrity", "Speaks on real Kalshi feed-health transitions."],
  ["ALCHEMIST", "Research", "Speaks from frozen, prospective Lab specimen milestones."],
  ["WRENCH", "Infrastructure", "Silent — no public infrastructure trigger yet."],
  ["SWEEP", "Conditions", "Silent — no public regime trigger yet."],
  ["COACH", "Seat behavior", "Silent — no public team trigger yet."],
] as const;

type Exchange = {
  key: string;
  label: string;
  latest: string;
  statements: ChamberStatement[];
};

function exchangeKey(s: ChamberStatement): string {
  const e = s.evidence;
  if (e.ticker && e.close_time) return `window:${e.ticker}:${e.close_time}`;
  if (e.candidate_id) return `experiment:${e.candidate_id}`;
  return `event:${s.event_key}`;
}

function exchangeLabel(row: ChamberStatement): string {
  const e = row.evidence;
  return e.ticker || e.candidate_label || e.candidate_id || "desk event";
}

function groupExchanges(rows: ChamberStatement[]): Exchange[] {
  const map = new Map<string, Exchange>();
  for (const row of rows) {
    const key = exchangeKey(row);
    const existing = map.get(key);
    if (existing) {
      existing.statements.unshift(row);
      continue;
    }
    map.set(key, {
      key,
      label: exchangeLabel(row),
      latest: row.occurred_at,
      statements: [row],
    });
  }
  return [...map.values()];
}

function SpeakerMark({ speaker }: { speaker: ChamberStatement["speaker"] }) {
  if (speaker === "SATOSHI") {
    return <Crest size={30} figure className="shrink-0" title="SATOSHI" />;
  }
  return (
    <span className="grid size-[30px] shrink-0 place-items-center rounded-sm border border-border bg-canvas font-mono text-[11px] font-bold text-subtle" aria-hidden="true">
      {speaker === "ALCHEMIST" ? "A" : "W"}
    </span>
  );
}

function Evidence({ statement }: { statement: ChamberStatement }) {
  const [open, setOpen] = useState(false);
  const e = statement.evidence;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="min-h-11 font-mono text-micro uppercase tracking-widest text-muted hover:text-fg sm:min-h-0"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide evidence" : "Show evidence"}
      </button>
      {open ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 border-l border-border pl-3 font-mono text-micro text-subtle sm:grid-cols-2">
          {e.kind === "chair-wait" ? (
            <div><dt className="inline text-muted">reason </dt><dd className="inline">{e.wait_reason || "—"}</dd></div>
          ) : e.kind === "chair-directional" ? (
            <>
              <div><dt className="inline text-muted">side </dt><dd className="inline">{e.lean || "—"}</dd></div>
              <div><dt className="inline text-muted">paper entry </dt><dd className="inline tabular">{e.entry_cents != null ? `${e.entry_cents}¢` : "—"}</dd></div>
            </>
          ) : e.kind === "experiment" ? (
            <>
              <div><dt className="inline text-muted">specimen </dt><dd className="inline">{e.candidate_label || e.candidate_id || "—"}</dd></div>
              <div><dt className="inline text-muted">countable sample </dt><dd className="inline tabular">{e.sample_n ?? "—"}</dd></div>
              {e.milestone != null ? <div><dt className="inline text-muted">milestone </dt><dd className="inline tabular">{e.milestone}</dd></div> : null}
              <div><dt className="inline text-muted">paired vs {e.control_id || "control"} </dt><dd className="inline tabular">{e.paired_n != null ? `${e.paired_n} windows` : "—"}{e.paired_delta != null ? ` · ${e.paired_delta >= 0 ? "+" : ""}${e.paired_delta}¢ avg` : ""}</dd></div>
              {e.frozen_at ? <div><dt className="inline text-muted">frozen </dt><dd className="inline tabular">{new Date(e.frozen_at).toISOString()}</dd></div> : null}
              <div><dt className="inline text-muted">authority </dt><dd className="inline">{e.paper_only ? "paper-only" : "—"} · {e.authority || "none"}</dd></div>
            </>
          ) : (
            <>
              <div><dt className="inline text-muted">feed </dt><dd className="inline">{e.feed || "—"}</dd></div>
              <div><dt className="inline text-muted">continuity </dt><dd className="inline">{e.gap || "—"}</dd></div>
              {e.receipt_age_s != null ? <div><dt className="inline text-muted">receipt age </dt><dd className="inline tabular">{e.receipt_age_s}s</dd></div> : null}
              {e.last_change_age_s != null ? <div><dt className="inline text-muted">last change </dt><dd className="inline tabular">{e.last_change_age_s}s</dd></div> : null}
            </>
          )}
          {e.ticker ? <div className="min-w-0"><dt className="inline text-muted">window </dt><dd className="inline break-all">{e.ticker}</dd></div> : null}
          {e.close_time ? <div><dt className="inline text-muted">close </dt><dd className="inline tabular">{new Date(e.close_time).toISOString()}</dd></div> : null}
          {e.failed_hard.length ? <div><dt className="inline text-muted">gates </dt><dd className="inline">{e.failed_hard.join(" · ")}</dd></div> : null}
          {e.quorum ? <div><dt className="inline text-muted">quorum </dt><dd className="inline">{e.quorum.up} up · {e.quorum.down} down · {e.quorum.wait} wait</dd></div> : null}
          {e.score != null && e.bar != null ? <div><dt className="inline text-muted">score / bar </dt><dd className="inline tabular">{e.score} / {e.bar}</dd></div> : null}
        </dl>
      ) : null}
    </div>
  );
}

function Statement({ statement }: { statement: ChamberStatement }) {
  return (
    <article className="relative border-l border-border pl-4 sm:pl-5">
      <span className="absolute -left-[3px] top-3 size-[5px] rounded-full bg-subtle" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <SpeakerMark speaker={statement.speaker} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-mono text-micro font-bold uppercase tracking-[0.16em] text-fg">{statement.speaker}</span>
            <time className="font-mono text-micro tabular text-subtle" dateTime={statement.occurred_at}>
              {new Date(statement.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </time>
          </div>
          <p className="mt-1 max-w-[72ch] font-sans text-body leading-relaxed text-fg">{statement.text}</p>
          <Evidence statement={statement} />
        </div>
      </div>
    </article>
  );
}

export function ChamberRoom() {
  const [rows, setRows] = useState<ChamberStatement[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    const pull = async () => {
      try {
        const next = await listChamberSpeech();
        if (mounted) setRows(next);
      } finally {
        if (mounted) setLoaded(true);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 12_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const exchanges = useMemo(() => groupExchanges(rows), [rows]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#chamber-main" className="skip-link">Skip to content</a>
      <SiteHeader
        nav={
          <nav aria-label="Desk rooms" className="flex items-center gap-1">
            <a href="/" className="btn btn-secondary btn-sm">Floor</a>
            <a href="/chamber" className="btn btn-secondary btn-sm" aria-current="page">Chamber</a>
            <a href="/arena" className="btn btn-secondary btn-sm">The Pit</a>
            <a href="/about" className="btn btn-secondary btn-sm">How it works</a>
          </nav>
        }
        menu={[
          { label: "THE FLOOR", href: "/", hint: "live desk" },
          { label: "THE CHAMBER", href: "/chamber", hint: "current room", active: true },
          { label: "THE PIT", href: "/arena", hint: "competition" },
          { label: "How it works", href: "/about", hint: "page" },
        ]}
      />

      <main id="chamber-main" className="gutter mx-auto w-full max-w-[var(--max)] py-6 sm:py-8">
        <section className="border-b border-border pb-6">
          <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">Read only · structured events</div>
          <h1 className="mt-2 font-sans text-display font-medium tracking-tight">THE CHAMBER</h1>
          <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">
            Watch the organization react to what the desk actually observed. Every line below comes from a persisted system event and carries its evidence with it.
          </p>
          <p className="mt-3 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            Chamber speech is downstream only. It cannot change the Chair, the learner, a seat, the Lab, or the paper book. When no evidence-backed event earns a voice, the room stays quiet.
          </p>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section aria-labelledby="exchange-heading">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">Observed conversation</div>
                <h2 id="exchange-heading" className="mt-1 font-sans text-title font-medium">Live exchanges</h2>
              </div>
              <div className="font-mono text-micro text-subtle">refreshes every 12s</div>
            </div>

            {!loaded ? (
              <div className="rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">Listening for structured events…</div>
            ) : exchanges.length === 0 ? (
              <div className="rounded-md border border-border bg-surface p-5">
                <div className="font-mono text-ui text-fg">The room is quiet.</div>
                <p className="mt-1 font-sans text-ui text-muted">No evidence-backed event has earned a voice.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {exchanges.map((exchange) => (
                  <section key={exchange.key} className="rounded-md border border-border bg-surface p-4 sm:p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                      <div className="min-w-0 font-mono text-micro uppercase tracking-widest text-subtle">
                        {exchange.statements.length > 1 ? "Exchange" : "Dispatch"} · <span className="break-all text-muted">{exchange.label}</span>
                      </div>
                      <time className="font-mono text-micro tabular text-subtle" dateTime={exchange.latest}>
                        {new Date(exchange.latest).toLocaleDateString()}
                      </time>
                    </div>
                    <div className="space-y-5">
                      {exchange.statements.map((statement) => <Statement key={statement.event_key} statement={statement} />)}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-3" aria-labelledby="cast-heading">
            <div>
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Organization</div>
              <h2 id="cast-heading" className="mt-1 font-sans text-title font-medium">Who can speak</h2>
            </div>
            <div className="overflow-hidden rounded-md border border-border bg-surface">
              {CAST.map(([name, role, status], i) => (
                <div key={name} className={i ? "border-t border-border p-3" : "p-3"}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-micro font-bold tracking-widest text-fg">{name}</span>
                    <span className="font-mono text-micro text-subtle">{role}</span>
                  </div>
                  <p className="mt-1 font-sans text-ui leading-snug text-muted">{status}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border bg-canvas p-3 font-mono text-micro leading-relaxed text-subtle">
              No character can talk another character into a production decision. Evidence first; presentation second.
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
