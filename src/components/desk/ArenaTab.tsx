import { humanRanks, sampleRate } from "@/lib/desk/display-evidence";
import { useEffect, useState } from "react";
import { arenaName, fetchArena, type Arena, type ArenaRow } from "@/lib/desk/arena";
import { fmtLocal } from "@/lib/desk/market-hours";
import { cn } from "@/lib/utils";
import { Pane } from "./bits";
import { Tip } from "./Tip";

function fmtSince(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
  }
}

function fmtC(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}¢`;
}

function Board({ title, rows, desk }: { title: string; rows: ArenaRow[]; desk: ArenaRow[] }) {
  const ranks = humanRanks(rows);
  const merged = [...rows.map((r) => ({ ...r, kind: "human" as const })), ...desk.map((r) => ({ ...r, kind: "desk" as const }))];
  return (
    <Pane title={title}>
      {merged.length ? (
        <table className="table-research">
          <thead>
            <tr className="text-left">
              <th >#</th>
              <th >callsign</th>
              <th >calls</th>
              <th >right</th>
              <th >net after fees</th>
              <th >said</th>
            </tr>
          </thead>
          <tbody>
            {merged.map((r) => (
              <tr key={`${r.kind}-${r.name}`} className={cn("border-t border-border/60", r.me ? "bg-surface-2 text-fg" : r.kind === "desk" ? "text-muted" : "text-fg")}>
                <td >{r.kind === "desk" ? "ref" : ranks.get(r.name) ?? "—"}</td>
                <td className="font-semibold">
                  {r.name}{r.kind === "desk" ? " · benchmark" : ""}
                  {r.me ? <span className="ml-1 text-subtle">(you)</span> : null}
                  {r.warming ? <span className="ml-1 font-normal text-subtle">warming up</span> : null}
                  {r.since ? <span className="ml-1 font-normal text-subtle">since {fmtSince(r.since)}</span> : null}
                </td>
                <td >{r.n}</td>
                <td >{sampleRate(r.hit_pct == null ? null : r.hit_pct / 100, r.n)}</td>
                <td className={cn(r.net > 0 ? "text-up" : r.net < 0 ? "text-down" : "")}>{fmtC(r.net)}</td>
                <td className="text-subtle">{r.avg_conf == null ? "—" : `${r.avg_conf}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="font-mono text-micro text-muted">Nobody has a settled call yet. Be first.</div>
      )}
    </Pane>
  );
}

export function ArenaTab({ tz, onCall }: { tz: string; onCall: () => void }) {
  const [arena, setArena] = useState<Arena | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const a = await fetchArena();
        if (alive) {
          setArena(a);
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

  if (!arena) return <div className="p-6 font-mono text-ui text-muted">{err ? `Arena is dark: ${err}` : "Opening the arena…"}</div>;
  const me = arena.me;
  const name = arenaName();
  const calib =
    me && me.n >= 20 && me.avg_conf != null && me.hit_pct != null
      ? me.hit_pct >= me.avg_conf + 5
        ? "the observed hit rate is above the average stated confidence"
        : me.hit_pct <= me.avg_conf - 10
          ? "the observed hit rate is below the average stated confidence"
          : "the two observed rates are close"
      : null;

  return (
    <div className="grid gap-3 p-3">
      <Pane title={<Tip k="tab.arena">YOUR RECORD</Tip>}>
        {!name ? (
          <div className="font-mono text-micro text-muted">
            No callsign yet. Go to SATOSHI, pick one under YOUR CALL, and make a call on the live window.{" "}
            <button type="button" onClick={onCall} className="text-fg underline underline-offset-2">
              take me there
            </button>
          </div>
        ) : !me ? (
          <div className="font-mono text-micro text-muted">
            <span className="text-fg">{name}</span> · no calls yet.{" "}
            <button type="button" onClick={onCall} className="text-fg underline underline-offset-2">
              make your first call
            </button>
          </div>
        ) : (
          <div className="grid gap-1 font-mono text-ui text-fg">
            <div>
              <span className="font-semibold">{me.name}</span> · {me.n} settled · {me.wins} won · {sampleRate(me.hit_pct == null ? null : me.hit_pct / 100, me.n)} ·{" "}
              <span className={me.net >= 0 ? "text-up" : "text-down"}>{fmtC(me.net)}</span> after fees
              {me.open ? ` · ${me.open} open` : ""}
              {me.rank_week ? ` · #${me.rank_week} of ${me.players_week} in the last 7 days` : ""}
            </div>
            {calib && (
              <div className="font-mono text-micro text-muted">
                you said {me.avg_conf}% on average and hit {me.hit_pct}% — {calib}
              </div>
            )}
            {me.calls.length > 0 && (
              <div className="mt-1 overflow-x-auto">
                <table className="table-research">
                  <thead>
                    <tr className="text-left">
                      <th >window</th>
                      <th >call</th>
                      <th >ask</th>
                      <th >sure</th>
                      <th >with</th>
                      <th >result</th>
                      <th >cents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.calls.map((c) => (
                      <tr key={c.ticker} className="border-t border-border/60">
                        <td className="text-muted">{fmtLocal(Date.parse(c.close_time), tz)}</td>
                        <td className={cn("font-semibold", c.lean === "UP" ? "text-up" : "text-down")}>{c.lean}</td>
                        <td >{c.entry_cents.toFixed(1)}¢</td>
                        <td className="text-subtle">{c.conf == null ? "—" : `${c.conf}%`}</td>
                        <td className="text-subtle">{c.mins_left.toFixed(1)}m left</td>
                        <td >{c.winner ?? <span className="text-subtle">open</span>}</td>
                        <td className={cn((c.cents ?? 0) > 0 ? "text-up" : (c.cents ?? 0) < 0 ? "text-down" : "")}>
                          {c.cents == null ? "—" : fmtC(c.cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Pane>
      <div className="grid gap-3 lg:grid-cols-2">
        <Board title="LEADERBOARD · LAST 7 DAYS" rows={arena.week} desk={arena.desk_week} />
        <Board title="LEADERBOARD · ALL-TIME" rows={arena.all} desk={arena.desk_all} />
      </div>
      <div className="font-mono text-micro text-subtle">
        Paper only. Every call is booked at the ask plus Kalshi's exact taker fee and settled by the official result, the same way the chair is scored.
      </div>
    </div>
  );
}
