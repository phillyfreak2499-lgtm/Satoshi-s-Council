import { useEffect, useMemo, useRef, useState } from "react";
import { TAB_SEATS } from "@/lib/desk/seats";
import { GlobalHeader } from "./GlobalHeader";
import { Crest } from "./Crest";
import { useDesk } from "@/lib/desk/store";
import { tourSeen } from "@/lib/desk/glossary";
import { CHAIR_SCALP, readScalp, scalpAvg } from "@/lib/desk/scalp";
import { SEAT_IDS, type SeatId, type TabId } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { BotCard } from "./BotCard";
import { MetaFooter, SatoshiTab } from "./SatoshiTab";
import { GuidedFloor } from "./GuidedFloor";
import { CouncilEntrance, CouncilFocusToggle, CouncilGuides } from "./CouncilExperience";
import { SettingsTab } from "./SettingsTab";
import { TopStrip } from "./TopStrip";
import { Tip } from "./Tip";
import { Tour } from "./Tour";
import { Toaster, toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { TrustStrip, Welcome } from "./Welcome";
import {
  applyDisplayPrefs,
  markWelcomeSeen,
  readFloorDensity,
  readFloorMode,
  readSeatView,
  setFloorDensity as saveFloorDensity,
  setFloorMode as saveFloorMode,
  setSeatView as saveSeatView,
  TRUST_CHIPS,
  welcomeSeen,
  type FloorDensity,
  type FloorMode,
  type SeatView,
} from "./prefs";
import { beacon } from "@/lib/desk/beacon";
import { gtagEvent } from "@/lib/desk/ga";
import { Palette } from "./Palette";
import { FloorSkeleton } from "./Skeleton";
import { BoardTab } from "./Feedback";
import { AtelierTab } from "./AtelierTab";
import { CrewTab } from "./CrewTab";
import { ArenaTab } from "./ArenaTab";
import { BooksTab } from "./BooksTab";

const PRIMARY: { id: TabId; label: string }[] = [
  { id: "satoshi", label: "Overview" },
  { id: "structure", label: "Specialists" },
];
// One shape for every primary nav item — the tab buttons (FLOOR, DESKS, BOOKS,
// BOARD) and the ARENA room link alike — so every word sits at the same size in
// the same box, whether it is a <button> or an <a>.
const NAV_TAB =
  "flex min-h-11 shrink-0 items-center gap-1 rounded-md border px-2.5 font-mono text-micro tracking-wide";
const NAV_TAB_IDLE = "border-transparent text-muted hover:bg-surface-2 hover:text-fg";
const NAV_TAB_ON = "border-border-strong bg-surface-2 text-fg";
const DESKS: { id: TabId; label: string; intro: string }[] = [
  {
    id: "structure",
    label: "STRUCTURE",
    intro: "candles and swings · WICK, DRIFT, STREAK, EXHAUST",
  },
  { id: "tape", label: "TAPE", intro: "order flow and the Kalshi book · PULSE, TAPE, WHALE, VEL" },
  {
    id: "derivs",
    label: "DERIVS",
    intro: "funding, open interest, liquidations · CARRY, CHAIN, CASCADE, VOLT",
  },
  { id: "book", label: "BOOK", intro: "the odds themselves · ODDS, STRIKE, CHEAP, FADE, INDEX" },
  { id: "context", label: "CONTEXT", intro: "clock and regime · ORBIT, CLOCK, WIRE, WARDEN" },
];
const DESK_IDS = new Set<TabId>(DESKS.map((d) => d.id));
const MORE: { id: TabId; label: string; hint: string }[] = [
  { id: "crew", label: "PIT CREW", hint: "SWEEP · COACH · WRENCH · LEDGER" },
  { id: "atelier", label: "GALLERY", hint: "all visualizations and Streamer" },
  { id: "settings", label: "SETTINGS", hint: "demo, alerts, display" },
];
const NUDGE_KEY = "satoshi-desk-nudge-v1";
const INTRO_KEY = "satoshi-desk-intro-v1";
const LINKABLE_TABS = new Set<TabId>([
  "satoshi",
  "structure",
  "tape",
  "derivs",
  "book",
  "context",
  "books",
  "board",
  "crew",
  "atelier",
  "settings",
]);

function nudgeOff(): boolean {
  try {
    return localStorage.getItem(NUDGE_KEY) === "off";
  } catch {
    return false;
  }
}

function introOff(): boolean {
  try {
    const saved = localStorage.getItem(INTRO_KEY);
    if (saved === "on") return false;
    return saved === "off" || welcomeSeen();
  } catch {
    return false;
  }
}

function MoreMenu({
  tab,
  onTab,
  onTour,
  onSearch,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  onTour: () => void;
  onSearch: () => void;
}) {
  const cur = MORE.find((m) => m.id === tab);
  const item =
    "flex min-h-10 cursor-pointer select-none items-center justify-between gap-3 rounded-sm px-2 font-mono text-micro text-fg outline-none data-[highlighted]:bg-surface-2";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Floor tools"
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2.5 font-mono text-micro tracking-wide",
            cur ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {cur ? cur.label : "Desk tools"} <span aria-hidden="true">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-60 rounded-md border border-border bg-surface p-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
        >
          {MORE.map((m) => (
            <DropdownMenu.Item key={m.id} onSelect={() => onTab(m.id)} className={item}>
              {m.label}
              <span className="text-subtle">{m.hint}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item onSelect={onSearch} className={item}>
            Search the desk<span className="text-subtle">⌘K</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onTour} className={item}>
            Replay the 60-second tour<span className="text-subtle">?</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function DeskApp() {
  const frame = useDesk();
  const [tab, setTab] = useState<TabId>("satoshi");
  const [focus, setFocus] = useState<SeatId | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [welcomeOn, setWelcomeOn] = useState(false);
  const [paletteOn, setPaletteOn] = useState(false);
  const [nudge, setNudge] = useState(false);
  // Read in the effect below, never during render: these touch localStorage and
  // would otherwise differ between the server and the first client paint.
  const [introHidden, setIntroHidden] = useState(false);
  const setIntroductionHidden = (hidden: boolean) => {
    setIntroHidden(hidden);
    if (hidden) setNudge(false);
    try {
      localStorage.setItem(INTRO_KEY, hidden ? "off" : "on");
      if (hidden) localStorage.setItem(NUDGE_KEY, "off");
    } catch { /* private mode: the choice still works for this visit */ }
  };
  const [seatView, setSeatViewState] = useState<SeatView>("auto");
  const [floorDensity, setFloorDensityState] = useState<FloorDensity>("quiet");
  const [floorMode, setFloorModeState] = useState<FloorMode>("pro");
  const setFloorMode = (mode: FloorMode) => {
    setFloorModeState(mode);
    saveFloorMode(mode);
    setTab("satoshi");
    if (mode === "guided") setWelcomeOn(false);
  };
  const setSeatView = (v: SeatView) => {
    setSeatViewState(v);
    saveSeatView(v);
  };
  const setFloorDensity = (v: FloorDensity) => {
    setFloorDensityState(v);
    saveFloorDensity(v);
  };

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`seat-${focus}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tab, focus]);

  const hasSnap = Boolean(frame.snap);
  useEffect(() => {
    applyDisplayPrefs();
    setSeatViewState(readSeatView());
    setFloorDensityState(readFloorDensity());
    setFloorModeState(readFloorMode());
    setNudge(!tourSeen() && welcomeSeen() && !nudgeOff());
    setIntroHidden(introOff());
    beacon("desk_view", true);
  }, []);
  useEffect(() => {
    if (paletteOn) beacon("palette_open");
  }, [paletteOn]);
  useEffect(() => {
    if (!hasSnap) return;
    if (floorMode === "guided" || tourSeen() || welcomeSeen()) return;
    const t = window.setTimeout(() => setWelcomeOn(true), 600);
    return () => window.clearTimeout(t);
  }, [hasSnap, floorMode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOn((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      (
        Object.entries(TAB_SEATS) as [
          Exclude<TabId, "satoshi" | "atelier" | "settings" | "board" | "crew" | "arena" | "books">,
          SeatId[],
        ][]
      ).find(([, ids]) => ids.includes(seat))?.[0] ?? "structure";
    setFocus(seat);
    setFloorModeState("pro");
    saveFloorMode("pro");
    setTab(dest);
  };

  // Deep links: /?tab=books opens a tab, /?seat=INDEX jumps to a seat; the address follows the tab.
  const urlReady = useRef(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("tab");
      const s = sp.get("seat")?.toUpperCase();
      if (t && t !== "arena" && LINKABLE_TABS.has(t as TabId)) {
        setTab(t as TabId);
        setFloorModeState("pro");
      } else if (!s && sp.get("view") === "guided") {
        setFloorModeState("guided");
        saveFloorMode("guided");
      }
      if (s && (SEAT_IDS as readonly string[]).includes(s)) jump(s as SeatId);
    } catch {
      /* no window */
    }
    urlReady.current = true;
  }, []);
  useEffect(() => {
    if (!urlReady.current) return;
    try {
      const u = new URL(window.location.href);
      if (tab === "satoshi") u.searchParams.delete("tab");
      else u.searchParams.set("tab", tab);
      if (floorMode === "guided" && tab === "satoshi") u.searchParams.set("view", "guided");
      else u.searchParams.delete("view");
      u.searchParams.delete("seat");
      const next = `${u.pathname}${u.search}${u.hash}`;
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
        window.history.replaceState(null, "", next);
    } catch {
      /* no window */
    }
  }, [tab, floorMode]);

  const startTour = () => {
    setWelcomeOn(false);
    setNudge(false);
    setTourStep(0);
    setTourOn(true);
    beacon("tour_start");
  };
  const desk = DESKS.find((d) => d.id === tab) ?? null;

  const seats =
    tab !== "satoshi" &&
    tab !== "atelier" &&
    tab !== "settings" &&
    tab !== "board" &&
    tab !== "crew" &&
    tab !== "arena" &&
    tab !== "books"
      ? TAB_SEATS[tab]
      : [];

  return (
    <div className="observatory council-full-site flex min-h-dvh flex-col bg-bg text-fg" data-lean={frame.chair?.lean.toLowerCase() ?? "wait"}>
      <a href="#floor-main" className="skip-link">
        Skip to the floor
      </a>
      <GlobalHeader
        tour="tour-header"
        searchOverride={tab === "satoshi" ? floorMode === "guided" ? "?view=guided" : "" : `?tab=${tab}`}
        action={{ label: "Search", hint: "⌘K", onSelect: () => setPaletteOn(true) }}
      />
      <nav
        aria-label="Floor views"
        className="council-floor-tools gutter flex flex-wrap items-center gap-1 border-b border-border bg-surface py-1"
      >
        <span className="mr-2 font-mono text-micro uppercase tracking-widest text-subtle">
          Floor
        </span>
        {floorMode === "guided" ? (
          <>
            <button type="button" aria-current="page" className={cn(NAV_TAB, NAV_TAB_ON)}>
              Guided
            </button>
            <button
              type="button"
              onClick={() => setFloorMode("pro")}
              className={cn(NAV_TAB, NAV_TAB_IDLE)}
            >
              Pro Floor
            </button>
          </>
        ) : (
          <>
            {PRIMARY.map((item) => {
              const active = item.id === "structure" ? DESK_IDS.has(tab) : tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(NAV_TAB, active ? NAV_TAB_ON : NAV_TAB_IDLE)}
                >
                  {item.label}
                </button>
              );
            })}
            <MoreMenu
              tab={tab}
              onTab={setTab}
              onTour={startTour}
              onSearch={() => setPaletteOn(true)}
            />
            <button
              type="button"
              onClick={() => setFloorMode("guided")}
              className={cn(NAV_TAB, NAV_TAB_IDLE)}
            >
              Guided Floor
            </button>
          </>
        )}
        {floorMode === "pro" && tab === "satoshi" ? <div className="ml-auto"><CouncilFocusToggle focused={introHidden} onToggle={() => setIntroductionHidden(!introHidden)} /></div> : null}
      </nav>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2/50 px-3 py-1.5">
        <TrustStrip className="hidden sm:flex" />
        <p className="min-w-0 truncate font-mono text-micro text-subtle sm:hidden">
          {TRUST_CHIPS.join(" · ")}
        </p>
        <Tip k="beta.disclaimer" className="hidden sm:inline">
          <span className="font-mono text-micro text-muted">
            Every UP / DOWN / WAIT is practice. Nothing here places a live trade, and none of it is
            advice.
          </span>
        </Tip>
        {floorMode === "pro" && nudge && !tourOn && tab !== "satoshi" ? (
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={startTour}
              className="min-h-8 rounded-sm border border-border px-2 font-mono text-micro text-fg hover:bg-surface-2"
            >
              New here? Take the 60-second tour
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setNudge(false);
                try {
                  localStorage.setItem(NUDGE_KEY, "off");
                } catch {
                  /* private mode */
                }
              }}
              className="min-h-8 min-w-8 rounded-sm px-1 font-mono text-micro text-subtle hover:text-fg"
            >
              ×
            </button>
          </span>
        ) : null}
      </div>

      {desk ? (
        <div
          className="nav-scroll flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3"
          aria-label="Seat desks"
        >
          <span className="mr-1 shrink-0 font-mono text-micro uppercase tracking-widest text-subtle">
            desks
          </span>
          {DESKS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setTab(d.id)}
              aria-current={tab === d.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center rounded-md border px-2.5 font-mono text-micro tracking-wide",
                tab === d.id
                  ? "border-border-strong bg-surface-2 text-fg"
                  : "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Tip k={`tab.${d.id}`} hoverOnly>
                {d.label}
              </Tip>
            </button>
          ))}
          <span className="ml-auto hidden shrink-0 font-mono text-micro text-subtle lg:block">
            {desk.intro}
          </span>
        </div>
      ) : null}

      {floorMode === "pro" && tab === "satoshi" && !introHidden ? (
        <CouncilEntrance onTour={startTour} onEnter={() => gtagEvent("enter_the_floor")} />
      ) : null}

      {tab !== "satoshi" ? (
        <TopStrip
          snap={frame.snap}
          chair={frame.chair}
          demo={frame.settings.source === "demo"}
          learn={frame.learner.learn_phase}
          graded={frame.learner.graded_windows}
          evAvg={scalpAvg(readScalp(frame.learner, CHAIR_SCALP).legs) ?? 0}
          evN={readScalp(frame.learner, CHAIR_SCALP).legs.length}
          tz={frame.settings.tz}
          brainAge={frame.brain_age_s}
          frameAt={frame.frame_at}
          callLog={frame.call_log}
        />
      ) : null}

      {frame.lastError && (
        <div className="border-b border-down/40 bg-down/10 px-3 py-1 font-mono text-ui text-down">
          {frame.lastError}
        </div>
      )}

      <main
        id="floor-main"
        className={cn("min-h-0 flex-1", tab === "atelier" ? "overflow-hidden" : "overflow-auto")}
      >
        {!frame.snap && tab !== "atelier" && tab !== "board" && tab !== "settings" && (
          <FloorSkeleton demo={frame.settings.source === "demo"} />
        )}
        {frame.snap && tab === "satoshi" && frame.chair && floorMode === "guided" && (
          <GuidedFloor
            snap={frame.snap}
            chair={frame.chair}
            callLog={frame.call_log}
            demo={frame.settings.source === "demo"}
            onPro={() => setFloorMode("pro")}
          />
        )}
        {frame.snap && tab === "satoshi" && frame.chair && floorMode === "pro" && (
          <SatoshiTab
            snap={frame.snap}
            chair={frame.chair}
            settings={frame.settings}
            callLog={frame.call_log}
            onJump={jump}
            v2={frame.v2}
            onOpenArena={() => setTab("arena")}
            onOpenBooks={() => setTab("books")}
            density={floorDensity}
            onDensityChange={setFloorDensity}
            strip={
              <TopStrip
                floor
                snap={frame.snap}
                chair={frame.chair}
                demo={frame.settings.source === "demo"}
                learn={frame.learner.learn_phase}
                graded={frame.learner.graded_windows}
                evAvg={scalpAvg(readScalp(frame.learner, CHAIR_SCALP).legs) ?? 0}
                evN={readScalp(frame.learner, CHAIR_SCALP).legs.length}
                tz={frame.settings.tz}
                brainAge={frame.brain_age_s}
                frameAt={frame.frame_at}
                callLog={frame.call_log}
              />
            }
          />
        )}
        {frame.snap && seats.length > 0 && (
          <div className="grid gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-micro text-subtle">
              <span className="min-w-0">{desk ? `${desk.label} · ${desk.intro}` : ""}</span>
              <span className="flex items-center gap-2">
                <span className="hidden lg:inline">
                  snapshot {new Date(frame.snap.as_of).toISOString()} · shared across this tab
                </span>
                <button
                  type="button"
                  aria-pressed={seatView === "all"}
                  onClick={() => setSeatView(seatView === "all" ? "auto" : "all")}
                  className="btn btn-secondary btn-sm"
                >
                  {seatView === "all" ? "fold sitting seats" : "expand all seats"}
                </button>
              </span>
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
                  compact={seatView === "auto" && vote.lean === "WAIT" && focus !== id}
                />
              );
            })}
          </div>
        )}
        {tab === "atelier" && <AtelierTab />}
        {tab === "board" && <BoardTab frame={frame} />}
        {tab === "crew" && <CrewTab />}
        {tab === "arena" && <ArenaTab tz={frame.settings.tz} onCall={() => setTab("satoshi")} />}
        {tab === "books" && <BooksTab tz={frame.settings.tz} />}
        {tab === "settings" && <SettingsTab settings={frame.settings} learner={frame.learner} />}
        {tab === "satoshi" && floorMode === "pro" && !introHidden ? <div className="obs-container"><CouncilGuides /></div> : null}
      </main>

      {floorMode === "pro" && (
        <MetaFooter
          chair={frame.chair}
          law_wrongs={frame.learner.law_wrongs}
          lockdown={frame.learner.lockdown}
          lockdown_until={frame.learner.lockdown_until}
          tape={frame.learner.settle_tape}
          settling={frame.settling}
        />
      )}
      <footer
        data-tour="tour-footer"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-micro text-subtle"
      >
        <Crest size={16} className="shrink-0 opacity-80" />
        <span>
          Paper research desk · Bitcoin only · Not financial advice · Not affiliated with Kalshi ·
          No real money.
        </span>
        <span className="ml-auto flex flex-wrap gap-x-3">
          <a href="/about" className="min-h-8 leading-8 hover:text-fg">
            How it works
          </a>
          <a href="/faq" className="min-h-8 leading-8 hover:text-fg">
            FAQ
          </a>
          <a href="/legal" className="min-h-8 leading-8 hover:text-fg">
            Paper only
          </a>
          <button
            type="button"
            onClick={() => setPaletteOn(true)}
            className="min-h-8 hover:text-fg"
          >
            Glossary ⌘K
          </button>
        </span>
      </footer>
      <Tour
        open={tourOn}
        step={tourStep}
        tab={tab}
        onTab={(t) => {
          setFloorModeState("pro");
          saveFloorMode("pro");
          setTab(t);
        }}
        onStep={setTourStep}
        onClose={() => setTourOn(false)}
        onDone={() => {
          beacon("tour_done");
          toast("You're on the floor.", {
            description:
              "The chair's call is up top. Hover or tap any dotted label for a definition.",
          });
        }}
      />
      <Welcome
        open={welcomeOn}
        onTour={() => {
          markWelcomeSeen();
          beacon("welcome_tour");
          startTour();
        }}
        onFloor={() => {
          markWelcomeSeen();
          beacon("welcome_floor");
          setWelcomeOn(false);
          setNudge(!tourSeen() && !nudgeOff());
        }}
      />
      <Palette
        open={paletteOn}
        onOpenChange={setPaletteOn}
        onTab={(t) => {
          setFloorModeState("pro");
          saveFloorMode("pro");
          setTab(t);
        }}
        onJump={jump}
        onTour={startTour}
      />
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{ className: "font-mono text-ui" }}
      />
    </div>
  );
}
