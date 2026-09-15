import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";
import { RETIRED_SEATS } from "@/lib/desk/crew";

type Report = {
  seat: string;
  reads: number;
  spoke: number;
  gagged: number;
  max_conf: number | null;
  avg_conf: number | null;
  spoke_hit_pct: number | null;
  mid_n: number;
  mid_hit_pct: number | null;
  mid_cents: number | null;
  grade_n: number;
  flags: string[];
  note: string | null;
};
type Knobs = { edge_mult: number; speak_offset: number; benched_until: number; updated_at: number; reason: string };
type LogRow = { t: string; who: string; seat: string | null; action: string; detail: string };
type Hits = { days: { day: string; events: Record<string, number> }[]; totals: Record<string, number>; last_error: string | null };
type Crew = {
  hits?: Hits | null;
  day: string | null;
  bar: number;
  reports: Report[];
  knobs: Record<string, Knobs>;
  log: LogRow[];
  last_error: string | null;
};

const HIT_COLS: { k: string; label: string }[] = [
  { k: "room_view", label: "pit views" },
  { k: "desk_view", label: "desk views" },
  { k: "lock", label: "locks" },
  { k: "tour_start", label: "desk tours" },
  { k: "tour_done", label: "finished" },
  { k: "pit_tour_start", label: "pit tours" },
  { k: "pit_tour_done", label: "finished" },
  { k: "gloss_open", label: "glossary" },
  { k: "palette_open", label: "search" },
  { k: "share", label: "shares" },
  { k: "settle_alert", label: "alerts" },
];

const FLAG_TONE: Record<string, string> = {
  GOLD: "text-up",
  ANTI: "text-down",
  DEAD: "text-muted",
  MUTE: "text-warn",
  DEADLOCK: "text-warn",
};

type Pattern = {
  slug: string;
  kind: "pair" | "coalition";
  members: string[];
  agree_side: "UP" | "DOWN";
  cited_side: "UP" | "DOWN";
  status: "cited" | "inverted" | "candidate" | "stale";
  train_n: number;
  train_hits: number;
  train_wilson: number;
  test_n: number;
  test_hits: number;
  test_wilson: number;
  member_solo: number;
  net_cents: number;
  booked_n: number;
  cited_wilson: number;
  note: string;
};
type Ledger = {
  meta: { windows: number; train_n: number; test_n: number } | null;
  counts: { cited: number; inverted: number; candidate: number };
  patterns: Pattern[];
  last_run_day: string | null;
  last_error: string | null;
};

const STATUS_TONE: Record<string, string> = {
  cited: "text-up",
  inverted: "text-warn",
  candidate: "text-subtle",
  stale: "text-muted",
};

function Section({ k, title, children }: { k: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">
        <Tip k={k} hoverOnly>
          {title}
        </Tip>
      </h3>
      {children}
    </section>
  );
}

function fmt(n: number | null | undefined, d = 0): string {
  return n == null ? "—" : n.toFixed(d);
}

export function CrewTab() {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/crew", { headers: { accept: "application/json" } });
        const j = (await r.json()) as Crew & { error?: string };
        if (!alive) return;
        if (j.error) setErr(j.error);
        else {
          setCrew(j);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    const pullLedger = async () => {
      try {
        const r = await fetch("/ledger", { headers: { accept: "application/json" } });
        const j = (await r.json()) as Ledger & { error?: string };
        if (alive && !j.error) setLedger(j);
      } catch {
        /* the ledger pane is optional — leave it empty if the fetch fails */
      }
    };
    void pull();
    void pullLedger();
    const t = window.setInterval(() => {
      void pull();
      void pullLedger();
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  if (!crew) {
    return <div className="p-6 font-mono text-ui text-muted">{err ? `Pit Crew is off the floor: ${err}` : "Fetching the crew's board…"}</div>;
  }
  const knobRows = Object.entries(crew.knobs ?? {}).filter(([, k]) => k.speak_offset !== 0 || k.edge_mult !== 1 || k.benched_until > 0);
  const sweepLog = crew.log.filter((r) => r.who === "SWEEP").slice(0, 12);
  const coachLog = crew.log.filter((r) => r.who === "COACH").slice(0, 12);
  const wrenchLog = crew.log.filter((r) => r.who === "WRENCH").slice(0, 12);

  return (
    <div className="grid gap-3 p-3">
      <Section k="crew.sweep" title={`SWEEP · scorecard${crew.day ? ` · ${crew.day}` : ""}`}>
        <div className="mb-2 font-mono text-micro text-subtle">
          Last 7 days per seat. Reads = had a side; spoke = cleared its bar; mid-window = right and paid at the ask, 7.5 minutes out. Bar {crew.bar}.
        </div>
        <div className="overflow-x-auto">
          <table className="table-research">
            <thead>
              <tr className="text-left">
                <th >seat</th>
                <th >reads</th>
                <th >spoke</th>
                <th >gagged</th>
                <th >best conf</th>
                <th >mid n</th>
                <th >mid right</th>
                <th >¢/contract</th>
                <th >graded</th>
                <th >flags</th>
              </tr>
            </thead>
            <tbody>
              {crew.reports.map((r) => (
                <tr key={r.seat} className="border-t border-border/60 text-fg" title={r.note ?? undefined}>
                  <td className="font-semibold">{r.seat}</td>
                  <td >{r.reads}</td>
                  <td >{r.spoke}</td>
                  <td >{r.gagged}</td>
                  <td className={cn(r.max_conf != null && r.max_conf < crew.bar && r.reads >= 10 ? "text-warn" : "")}>
                    {fmt(r.max_conf)}
                  </td>
                  <td >{r.mid_n}</td>
                  <td >{r.mid_hit_pct == null ? "—" : `${r.mid_hit_pct}%`}</td>
                  <td className={cn((r.mid_cents ?? 0) > 0 ? "text-up" : (r.mid_cents ?? 0) < 0 ? "text-down" : "")}>
                    {r.mid_cents == null ? "—" : `${r.mid_cents > 0 ? "+" : ""}${fmt(r.mid_cents, 1)}`}
                  </td>
                  <td >{r.grade_n}</td>
                  <td >
                    {RETIRED_SEATS[r.seat] ? <span className="mr-1 text-subtle">RETIRED</span> : null}
                    {r.flags.length
                      ? r.flags.map((f) => (
                          <span key={f} className={cn("mr-1", FLAG_TONE[f] ?? "")}>
                            {f}
                          </span>
                        ))
                      : RETIRED_SEATS[r.seat] ? null : <span className="text-subtle">—</span>}
                  </td>
                </tr>
              ))}
              {!crew.reports.length && (
                <tr>
                  <td colSpan={10} className="py-2 text-subtle">
                    No scorecard yet — SWEEP runs once a day after the recap.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sweepLog.length > 0 && (
          <ul className="mt-2 grid gap-1 font-mono text-micro text-muted">
            {sweepLog.map((r, i) => (
              <li key={i}>
                <span className="text-subtle">{r.t.slice(0, 16).replace("T", " ")}</span> · {r.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        k="crew.ledger"
        title={`LEDGER · pattern cards${
          ledger?.meta ? ` · ${ledger.meta.train_n}/${ledger.meta.test_n} split` : ""
        }`}
      >
        <div className="mb-2 font-mono text-micro text-subtle">
          Cross-seat vote <Tip k="ledger.coalition">coalitions</Tip> and <Tip k="ledger.pair">pairs</Tip> mined from the ledger. A
          card is <Tip k="ledger.cited">cited</Tip> only when its edge holds on windows AFTER the range it was found on (
          <Tip k="ledger.walkforward">walk-forward</Tip>), and <Tip k="ledger.inverted">inverted</Tip> rather than deleted when
          it resolves against its members. LEDGER never votes.
        </div>
        {ledger && ledger.patterns.length ? (
          <div className="overflow-x-auto">
            <table className="table-research">
              <thead>
                <tr className="text-left">
                  <th>seats</th>
                  <th>reads</th>
                  <th>status</th>
                  <th>out of sample</th>
                  <th>
                    <Tip k="ledger.wilson">W</Tip> vs best seat
                  </th>
                  <th>training</th>
                  <th>net ¢</th>
                </tr>
              </thead>
              <tbody>
                {ledger.patterns.map((p) => (
                  <tr key={p.slug} className="border-t border-border/60 text-fg" title={p.note || undefined}>
                    <td className="font-semibold">
                      {p.members.join("+")}
                      <span className="ml-1 text-subtle">{p.kind === "coalition" ? "coalition" : "pair"}</span>
                    </td>
                    <td>
                      <span className={p.agree_side === "UP" ? "text-up" : "text-down"}>{p.agree_side}</span>
                      <span className="text-subtle"> → </span>
                      <span className={p.cited_side === "UP" ? "text-up" : "text-down"}>{p.cited_side}</span>
                    </td>
                    <td className={cn("uppercase", STATUS_TONE[p.status] ?? "")}>{p.status}</td>
                    <td>
                      {p.test_n ? (
                        <>
                          {p.status === "inverted" ? p.test_n - p.test_hits : p.test_hits}/{p.test_n}
                          <span className="text-subtle"> · W{Math.round(p.cited_wilson * 100)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      W{Math.round(p.cited_wilson * 100)}
                      <span className="text-subtle"> vs {Math.round(p.member_solo * 100)}</span>
                    </td>
                    <td className="text-muted">
                      {p.train_hits}/{p.train_n}
                    </td>
                    <td className={cn(p.net_cents > 0 ? "text-up" : p.net_cents < 0 ? "text-down" : "text-subtle")}>
                      {p.booked_n ? `${p.net_cents > 0 ? "+" : ""}${fmt(p.net_cents, 1)}` : "—"}
                      {p.booked_n ? <span className="text-subtle"> ({p.booked_n})</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="font-mono text-micro text-muted">
            {ledger?.meta
              ? `No pattern clears the walk-forward test yet — ${ledger.meta.windows} windows mined.`
              : "LEDGER runs once a day after the recap. It needs about forty graded windows before its first mine."}
          </div>
        )}
        {ledger?.last_error ? <div className="mt-1 font-mono text-micro text-down">ledger: {ledger.last_error}</div> : null}
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section k="crew.coach" title="COACH · knobs">
          <div className="mb-2 font-mono text-micro text-subtle">
            Only COACH writes these. Bar = {crew.bar} + offset. A move is judged a week later on windows it did not see; a bad one is reverted.
          </div>
          {knobRows.length ? (
            <table className="table-research">
              <thead>
                <tr className="text-left">
                  <th >seat</th>
                  <th >bar</th>
                  <th >edge ×</th>
                  <th >bench</th>
                  <th >why</th>
                </tr>
              </thead>
              <tbody>
                {knobRows.map(([seat, k]) => (
                  <tr key={seat} className="border-t border-border/60 text-fg">
                    <td className="font-semibold">{seat}</td>
                    <td >
                      {crew.bar + k.speak_offset}
                      {k.speak_offset ? <span className="text-subtle"> ({k.speak_offset > 0 ? "+" : ""}{k.speak_offset})</span> : null}
                    </td>
                    <td >{k.edge_mult.toFixed(2)}</td>
                    <td >{k.benched_until > Date.now() ? `until ${new Date(k.benched_until).toISOString().slice(0, 10)}` : "—"}</td>
                    <td className="text-muted">{k.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="font-mono text-micro text-muted">Every seat on the default bar. COACH needs about a month of mid-window reads before its first move.</div>
          )}
          {coachLog.length > 0 && (
            <ul className="mt-2 grid gap-1 font-mono text-micro text-muted">
              {coachLog.map((r, i) => (
                <li key={i}>
                  <span className="text-subtle">{r.t.slice(0, 16).replace("T", " ")}</span> · {r.detail}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section k="crew.wrench" title="WRENCH · mechanic's log">
          <div className="mb-2 font-mono text-micro text-subtle">
            A scheduled session that opens pull requests for real bugs. It never merges, never touches knobs.
          </div>
          {wrenchLog.length ? (
            <ul className="grid gap-1 font-mono text-micro text-muted">
              {wrenchLog.map((r, i) => (
                <li key={i}>
                  <span className="text-subtle">{r.t.slice(0, 10)}</span> · {r.detail}
                </li>
              ))}
            </ul>
          ) : (
            <div className="font-mono text-micro text-muted">No entries yet.</div>
          )}
        </Section>

        <Section k="crew.traffic" title="TRAFFIC · last 7 days">
          <div className="mb-2 font-mono text-micro text-subtle">Counted on the server, not by the site's Google tag: no cookies, no people. Chicago days.</div>
          {crew.hits && crew.hits.days.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] font-mono text-micro">
                <thead>
                  <tr className="text-left">
                    <th className="font-medium">day</th>
                    {HIT_COLS.map((c) => (
                      <th key={c.k} className="text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crew.hits.days.map((d) => (
                    <tr key={d.day} className="border-t border-border/60 text-muted">
                      <td className="text-fg">{d.day.slice(5)}</td>
                      {HIT_COLS.map((c) => (
                        <td key={c.k} className="text-right tabular">
                          {d.events[c.k] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-border text-fg">
                    <td >total</td>
                    {HIT_COLS.map((c) => (
                      <td key={c.k} className="text-right tabular">
                        {crew.hits!.totals[c.k] ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="font-mono text-micro text-muted">Nothing counted yet.</div>
          )}
          {crew.hits?.last_error ? <div className="mt-1 font-mono text-micro text-down">counter: {crew.hits.last_error}</div> : null}
        </Section>
      </div>
      {crew.last_error && <div className="font-mono text-micro text-down">crew error: {crew.last_error}</div>}
    </div>
  );
}
