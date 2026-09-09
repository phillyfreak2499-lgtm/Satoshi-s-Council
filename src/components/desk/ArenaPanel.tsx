import { useEffect, useState } from "react";
import { takerFeeCentsExact } from "@/lib/desk/clock";
import { arenaName, fetchArena, placeCall, setArenaName, type Arena, type HumanCall } from "@/lib/desk/arena";
import type { Snapshot } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { MinsLeft } from "./bits";
import { Tip } from "./Tip";

function fmtC(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}¢`;
}

/** The visitor's own paper call on the live window: one raised command bar under the tape. Same POST, same one-call lock. */
export function ArenaPanel({ snap, live, onOpenArena }: { snap: Snapshot; live: boolean; onOpenArena: () => void }) {
  const [name, setName] = useState(arenaName);
  const [draft, setDraft] = useState("");
  const [conf, setConf] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [arena, setArena] = useState<Arena | null>(null);

  const refresh = async () => {
    try {
      setArena(await fetchArena());
    } catch {
      /* the panel still lets you call; the record fills in later */
    }
  };
  useEffect(() => {
    if (!live) return;
    void refresh();
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [live, snap.ticker]);

  const mine: HumanCall | undefined = arena?.me?.calls.find((c) => c.ticker === snap.ticker);
  const minsLeft = Math.max(0, (snap.close_time - Date.now()) / 60_000);
  const tooLate = minsLeft < 0.5;
  const yesAsk = snap.yes_ask;
  const noAsk = snap.no_ask;
  const canCall = live && !busy && !mine && !tooLate && Boolean(name);

  const call = async (lean: "UP" | "DOWN") => {
    setBusy(true);
    setErr(null);
    try {
      await placeCall(lean, conf);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const me = arena?.me;
  return (
    <section data-tour="tour-arena" aria-labelledby="your-call-title" className="rounded-md border border-border-strong bg-surface-2 px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 id="your-call-title" className="font-mono text-micro uppercase tracking-widest text-subtle">
          <Tip k="arena.call">Your call</Tip>
        </h3>
      {!live ? (
        <div className="font-mono text-micro text-muted">Switch to Live in Settings to call the shared window. Demo is your private sandbox.</div>
      ) : !name ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v.length >= 2) {
              setArenaName(v);
              setName(v);
            }
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={16}
            placeholder="pick a callsign"
            className="input input-sm font-mono"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            join the floor
          </button>
          <span className="font-mono text-micro text-subtle">no login — the callsign lives in this browser</span>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-micro text-muted">
            <span>
              <span className="text-fg">{name}</span>
              {me && me.n > 0 ? (
                <>
                  {" "}· {me.n} settled · {me.hit_pct}% right · <span className={me.net >= 0 ? "text-up" : "text-down"}>{fmtC(me.net)}</span>
                  {me.rank_week ? ` · #${me.rank_week} of ${me.players_week} this week` : ""}
                </>
              ) : (
                " · no settled calls yet"
              )}
            </span>
            <button type="button" onClick={onOpenArena} className="text-subtle underline-offset-2 hover:text-fg hover:underline">
              leaderboard →
            </button>
          </div>
          {mine ? (
            <div className="font-mono text-ui text-fg">
              You: <span className={mine.lean === "UP" ? "text-up" : "text-down"}>{mine.lean}</span> @ {mine.entry_cents.toFixed(1)}¢ (fee {mine.fee.toFixed(2)}¢)
              {mine.winner ? (
                <>
                  {" "}· settled {mine.winner} · <span className={(mine.cents ?? 0) >= 0 ? "text-up" : "text-down"}>{fmtC(mine.cents ?? 0)}</span>
                </>
              ) : (
                <>
                  {" "}· settles in <MinsLeft closeTime={snap.close_time} />
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canCall || !(yesAsk > 0)}
                onClick={() => void call("UP")}
                className={cn(
                  "btn btn-sm font-mono",
                  canCall && yesAsk > 0 ? "bg-up/15 text-up hover:bg-up/25" : "bg-surface-2 text-subtle",
                )}
              >
                UP @ {yesAsk > 0 ? `${yesAsk}¢` : "—"} <span className="text-micro opacity-70">fee {yesAsk > 0 ? takerFeeCentsExact(yesAsk).toFixed(2) : "—"}¢</span>
              </button>
              <button
                type="button"
                disabled={!canCall || !(noAsk > 0)}
                onClick={() => void call("DOWN")}
                className={cn(
                  "btn btn-sm font-mono",
                  canCall && noAsk > 0 ? "bg-down/15 text-down hover:bg-down/25" : "bg-surface-2 text-subtle",
                )}
              >
                DOWN @ {noAsk > 0 ? `${noAsk}¢` : "—"} <span className="text-micro opacity-70">fee {noAsk > 0 ? takerFeeCentsExact(noAsk).toFixed(2) : "—"}¢</span>
              </button>
              <label className="flex items-center gap-2 font-mono text-micro text-muted">
                how sure? <span className="text-fg">{conf}%</span>
                <input type="range" min={51} max={95} value={conf} onChange={(e) => setConf(Number(e.target.value))} className="w-28" />
              </label>
              <span className="font-mono text-micro text-subtle">
                {tooLate ? "closed — inside the last 30 seconds" : <>closes in <MinsLeft closeTime={snap.close_time} /> · one call per window · paper</>}
              </span>
            </div>
          )}
          {err && <div className="font-mono text-micro text-down">{err}</div>}
        </div>
      )}
      </div>
    </section>
  );
}
