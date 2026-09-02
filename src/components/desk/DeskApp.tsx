import { useEffect, useMemo, useState } from "react";
import { TAB_SEATS } from "@/lib/desk/seats";
import { useDesk } from "@/lib/desk/store";
import { tourSeen } from "@/lib/desk/glossary";
import type { SeatId, TabId } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { BotCard } from "./BotCard";
import { MetaFooter, SatoshiTab } from "./SatoshiTab";
import { SettingsTab } from "./SettingsTab";
import { TopStrip } from "./TopStrip";
import { Tip } from "./Tip";
import { Tour } from "./Tour";

const TABS: { id: TabId; label: string }[] = [
  { id: "satoshi", label: "SATOSHI" },
  { id: "structure", label: "STRUCTURE" },
  { id: "tape", label: "TAPE" },
  { id: "derivs", label: "DERIVS" },
  { id: "book", label: "BOOK" },
  { id: "context", label: "CONTEXT" },
  { id: "settings", label: "SETTINGS" },
];

export function DeskApp() {
  const frame = useDesk();
  const [tab, setTab] = useState<TabId>("satoshi");
  const [focus, setFocus] = useState<SeatId | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`seat-${focus}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tab, focus]);

  const hasSnap = Boolean(frame.snap);
  useEffect(() => {
    if (!hasSnap) return;
    if (tourSeen()) return;
    const t = window.setTimeout(() => {
      setTourStep(0);
      setTourOn(true);
    }, 800);
    return () => window.clearTimeout(t);
  }, [hasSnap]);

  useEffect(() => {
    const go = () => {
      setTourStep(0);
      setTourOn(true);
    };
    window.addEventListener("satoshi-tour", go);
    return () => window.removeEventListener("satoshi-tour", go);
  }, []);

  const voteMap = useMemo(() => {
    const m = new Map(frame.votes.map((v) => [v.seat, v]));
    return m;
  }, [frame.votes]);

  const jump = (seat: SeatId) => {
    const dest =
      (Object.entries(TAB_SEATS) as [Exclude<TabId, "satoshi" | "settings">, SeatId[]][]).find(
        ([, ids]) => ids.includes(seat),
      )?.[0] ?? "structure";
    setFocus(seat);
    setTab(dest);
  };

  const startTour = () => {
    setTourStep(0);
    setTourOn(true);
  };

  const seats = tab !== "satoshi" && tab !== "settings" ? TAB_SEATS[tab] : [];

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header
        data-tour="tour-header"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2"
      >
        <div className="flex items-baseline gap-2">
          <h1 className="font-sans text-title font-medium tracking-tight">Satoshi's Council</h1>
          <span className="font-mono text-micro uppercase tracking-widest text-subtle">
            BTC 15m paper
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-label="Replay 60-second tour"
            title="Replay 60-second tour"
            onClick={startTour}
            className="rounded-sm px-2 py-1 font-mono text-micro text-muted hover:bg-surface-2 hover:text-fg"
          >
            ?
          </button>
          <nav className="flex flex-wrap gap-1" aria-label="Council tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-sm px-2 py-1 font-mono text-micro tracking-wide",
                  tab === t.id
                    ? "bg-surface-3 text-fg"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Tip k={`tab.${t.id}`} hoverOnly>
                  {t.label}
                </Tip>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <TopStrip
        snap={frame.snap}
        chair={frame.chair}
        demo={frame.settings.source === "demo"}
        learn={frame.learner.learn_phase}
        graded={frame.learner.graded_windows}
        evAvg={
          frame.learner.chair_ev_n
            ? frame.learner.chair_ev_sum / frame.learner.chair_ev_n
            : 0
        }
        evN={frame.learner.chair_ev_n}
      />

      {frame.lastError && (
        <div className="border-b border-down/40 bg-down/10 px-3 py-1 font-mono text-ui text-down">
          {frame.lastError}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto">
        {!frame.snap && (
          <div className="p-6 font-mono text-ui text-muted">Opening the window…</div>
        )}
        {frame.snap && tab === "satoshi" && frame.chair && (
          <SatoshiTab
            snap={frame.snap}
            chair={frame.chair}
            settings={frame.settings}
            callLog={frame.call_log}
            onJump={jump}
          />
        )}
        {frame.snap && seats.length > 0 && (
          <div className="grid gap-3 p-3">
            <div className="font-mono text-micro text-subtle">
              snapshot {new Date(frame.snap.as_of).toISOString()} · shared across this tab
            </div>
            {seats.map((id) => {
              const vote = voteMap.get(id);
              if (!vote) return null;
              return (
                <BotCard
                  key={id}
                  seat={id}
                  snap={frame.snap!}
                  vote={vote}
                  focused={focus === id}
                />
              );
            })}
          </div>
        )}
        {tab === "settings" && <SettingsTab settings={frame.settings} learner={frame.learner} />}
      </main>

      <MetaFooter
        chair={frame.chair}
        law_wrongs={frame.learner.law_wrongs}
        lockdown={frame.learner.lockdown}
        lockdown_until={frame.learner.lockdown_until}
        tape={frame.learner.settle_tape}
        settling={frame.settling}
      />
      <footer
        data-tour="tour-footer"
        className="border-t border-border px-3 py-1.5 font-mono text-micro text-subtle"
      >
        Paper research council. Not financial advice. Not Kalshi. No real money.
      </footer>
      <Tour
        open={tourOn}
        step={tourStep}
        tab={tab}
        onTab={setTab}
        onStep={setTourStep}
        onClose={() => setTourOn(false)}
      />
    </div>
  );
}
