import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";

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
    void pull();
    const t = window.setInterval(() => void pull(), 60_000);
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
          <table className="w-full font-mono text-micro">
            <thead className="text-subtle">
              <tr className="text-left">
                <th className="py-1 pr-2">seat</th>
                <th className="py-1 pr-2">reads</th>
                <th className="py-1 pr-2">spoke</th>
                <th className="py-1 pr-2">gagged</th>
                <th className="py-1 pr-2">best conf</th>
                <th className="py-1 pr-2">mid n</th>
                <th className="py-1 pr-2">mid right</th>
                <th className="py-1 pr-2">¢/contract</th>
                <th className="py-1 pr-2">graded</th>
                <th className="py-1 pr-2">flags</th>
              </tr>
            </thead>
            <tbody>
              {crew.reports.map((r) => (
                <tr key={r.seat} className="border-t border-border/60 text-fg" title={r.note ?? undefined}>
                  <td className="py-1 pr-2 font-semibold">{r.seat}</td>
                  <td className="py-1 pr-2">{r.reads}</td>
                  <td className="py-1 pr-2">{r.spoke}</td>
                  <td className="py-1 pr-2">{r.gagged}</td>
                  <td className={cn("py-1 pr-2", r.max_conf != null && r.max_conf < crew.bar && r.reads >= 10 ? "text-warn" : "")}>
                    {fmt(r.max_conf)}
                  </td>
                  <td className="py-1 pr-2">{r.mid_n}</td>
                  <td className="py-1 pr-2">{r.mid_hit_pct == null ? "—" : `${r.mid_hit_pct}%`}</td>
                  <td className={cn("py-1 pr-2", (r.mid_cents ?? 0) > 0 ? "text-up" : (r.mid_cents ?? 0) < 0 ? "text-down" : "")}>
                    {r.mid_cents == null ? "—" : `${r.mid_cents > 0 ? "+" : ""}${fmt(r.mid_cents, 1)}`}
                  </td>
                  <td className="py-1 pr-2">{r.grade_n}</td>
                  <td className="py-1 pr-2">
                    {r.flags.length
                      ? r.flags.map((f) => (
                          <span key={f} className={cn("mr-1", FLAG_TONE[f] ?? "")}>
                            {f}
                          </span>
                        ))
                      : <span className="text-subtle">—</span>}
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

      <div className="grid gap-3 lg:grid-cols-2">
        <Section k="crew.coach" title="COACH · knobs">
          <div className="mb-2 font-mono text-micro text-subtle">
            Only COACH writes these. Bar = {crew.bar} + offset. A move is judged a week later on windows it did not see; a bad one is reverted.
          </div>
          {knobRows.length ? (
            <table className="w-full font-mono text-micro">
              <thead className="text-subtle">
                <tr className="text-left">
                  <th className="py-1 pr-2">seat</th>
                  <th className="py-1 pr-2">bar</th>
                  <th className="py-1 pr-2">edge ×</th>
                  <th className="py-1 pr-2">bench</th>
                  <th className="py-1 pr-2">why</th>
                </tr>
              </thead>
              <tbody>
                {knobRows.map(([seat, k]) => (
                  <tr key={seat} className="border-t border-border/60 text-fg">
                    <td className="py-1 pr-2 font-semibold">{seat}</td>
                    <td className="py-1 pr-2">
                      {crew.bar + k.speak_offset}
                      {k.speak_offset ? <span className="text-subtle"> ({k.speak_offset > 0 ? "+" : ""}{k.speak_offset})</span> : null}
                    </td>
                    <td className="py-1 pr-2">{k.edge_mult.toFixed(2)}</td>
                    <td className="py-1 pr-2">{k.benched_until > Date.now() ? `until ${new Date(k.benched_until).toISOString().slice(0, 10)}` : "—"}</td>
                    <td className="py-1 pr-2 text-muted">{k.reason || "—"}</td>
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
          <div className="mb-2 font-mono text-micro text-subtle">First-party counts only: no scripts, no cookies, no people. Chicago days.</div>
          {crew.hits && crew.hits.days.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] font-mono text-micro">
                <thead className="text-subtle">
                  <tr className="text-left">
                    <th className="py-1 pr-2 font-medium">day</th>
                    {HIT_COLS.map((c) => (
                      <th key={c.k} className="py-1 pr-2 text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crew.hits.days.map((d) => (
                    <tr key={d.day} className="border-t border-border/60 text-muted">
                      <td className="py-1 pr-2 text-fg">{d.day.slice(5)}</td>
                      {HIT_COLS.map((c) => (
                        <td key={c.k} className="py-1 pr-2 text-right tabular">
                          {d.events[c.k] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-border text-fg">
                    <td className="py-1 pr-2">total</td>
                    {HIT_COLS.map((c) => (
                      <td key={c.k} className="py-1 pr-2 text-right tabular">
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
