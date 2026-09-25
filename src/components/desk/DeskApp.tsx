import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { TAB_SEATS } from "@/lib/desk/seats";
import { GlobalHeader } from "./GlobalHeader";
import { PaperDisclaimer } from "./PaperDisclaimer";
import { useDesk } from "@/lib/desk/store";
import { tourSeen } from "@/lib/desk/glossary";
import { CHAIR_SCALP, readScalp, scalpAvg } from "@/lib/desk/scalp";
import { SEAT_IDS, type SeatId, type TabId } from "@/lib/desk/types";
import type { BooksWindow } from "@/lib/desk/books";
import { cn } from "@/lib/utils";
import { BotCard } from "./BotCard";
import { MetaFooter, SatoshiTab } from "./SatoshiTab";
import { GuidedFloor } from "./GuidedFloor";
import { LiveConnectionNotice } from "./LiveConnectionNotice";
import { SettingsTab } from "./SettingsTab";
import { TopStrip } from "./TopStrip";
import { Tip } from "./Tip";
import { Tour } from "./Tour";
import { Toaster, toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Welcome } from "./Welcome";
import {
  applyDisplayPrefs,
  markWelcomeSeen,
  readFloorDensity,
  readFloorMode,
  readSeatView,
  setFloorDensity as saveFloorDensity,
  setFloorMode as saveFloorMode,
  setSeatView as saveSeatView,
  welcomeSeen,
  type FloorDensity,
  type FloorMode,
  type SeatView,
} from "./prefs";
import { beacon } from "@/lib/desk/beacon";
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
/**
 * THE FLOOR VIEW SWITCH — the first choice on the page, in both views.
 *
 * Guided and Pro are two ways to watch the SAME live window, so the control
 * that moves between them has to look like one control with two settings, not
 * like a link to somewhere else. It renders identically in both modes, sits in
 * the same place, and never hides behind a menu.
 *
 * WHY IT IS NOT IN "DESK TOOLS" ANY MORE. Pro mode used to list "Overview",
 * "Specialists", "Desk tools" and "Guided Floor" in one flat row — so Guided
 * read as a fourth Pro section rather than the other half of the product — and
 * on phones the dedicated button disappeared entirely into the Desk tools
 * dropdown. A reader on a phone could not find the plain-language view at all
 * without opening a menu that looked like it held settings.
 *
 * Both labels stay spelled out. "Guided" alone, or "Overview", would put the
 * reader back to guessing which of them is a whole view and which is a section.
 */
function FloorModeSwitch({ mode, onMode }: { mode: FloorMode; onMode: (m: FloorMode) => void }) {
  const seg =
    "flex min-h-11 flex-1 shrink-0 items-center justify-center rounded-md border px-3 font-mono text-micro tracking-wide sm:flex-none";
  return (
    <nav
      aria-label="Floor view"
      className="council-floor-view gutter flex items-center gap-1 border-b border-border bg-surface py-1"
    >
      <span className="mr-2 hidden font-mono text-micro uppercase tracking-widest text-subtle sm:inline">
        View
      </span>
      <div className="flex w-full items-center gap-1 sm:w-auto">
        {(
          [
            ["guided", "Guided Floor", "the plain-language view"],
            ["pro", "Pro Floor", "the full research view"],
          ] as const
        ).map(([id, label, hint]) => {
          const on = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onMode(id)}
              aria-current={on ? "page" : undefined}
              title={hint}
              className={cn(seg, on ? NAV_TAB_ON : NAV_TAB_IDLE)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="ml-auto hidden font-mono text-micro text-subtle lg:block">
        Same live window · {mode === "guided" ? "in plain English" : "with the full evidence"}
      </span>
    </nav>
  );
}

/**
 * Does this address name a floor view of its own?
 *
 * `?view=guided` asks for Guided outright; a `?tab=` or `?seat=` deep link is a
 * Pro section and therefore asks for Pro. Either way the saved preference must
 * stand aside, or a shared link would open the wrong view for half the people
 * who follow it.
 */
function urlPinsFloorMode(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("view") === "guided" || sp.has("tab") || sp.has("seat");
  } catch {
    return false;
  }
}

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

function MoreMenu({
  tab,
  onTab,
  onTour,
  onSearch,
  onWelcome,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  onTour: () => void;
  onSearch: () => void;
  onWelcome: () => void;
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
          className="council-desk-menu z-50 min-w-60 rounded-md border border-border bg-surface p-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
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
          <DropdownMenu.Item onSelect={onWelcome} className={item}>About this desk</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onTour} className={item}>
            Replay the 60-second tour<span className="text-subtle">?</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function DeskApp({ last }: { last?: BooksWindow | null } = {}) {
  const frame = useDesk();
  const initialSearch = useRouterState({ select: state => state.location.searchStr });
  const [tab, setTab] = useState<TabId>(() => {
    const params = new URLSearchParams(initialSearch);
    const requested = params.get("tab");
    if (requested && LINKABLE_TABS.has(requested as TabId)) return requested as TabId;
    const seat = params.get("seat")?.toUpperCase();
    if (seat) {
      const desk = Object.entries(TAB_SEATS).find(([, ids]) => (ids as readonly string[]).includes(seat));
      if (desk) return desk[0] as TabId;
    }
    return "satoshi";
  });
  const [focus, setFocus] = useState<SeatId | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [welcomeOn, setWelcomeOn] = useState(false);
  const [paletteOn, setPaletteOn] = useState(false);
  const [nudge, setNudge] = useState(false);
  // Read in the effect below, never during render: these touch localStorage and
  // would otherwise differ between the server and the first client paint.
  const [seatView, setSeatViewState] = useState<SeatView>("auto");
  const [floorDensity, setFloorDensityState] = useState<FloorDensity>("quiet");
  const [floorMode, setFloorModeState] = useState<FloorMode>(() => new URLSearchParams(initialSearch).get("view") === "guided" ? "guided" : "pro");
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

  useEffect(() => {
    applyDisplayPrefs();
    setSeatViewState(readSeatView());
    setFloorDensityState(readFloorDensity());
    // THE URL OUTRANKS THE SAVED PREFERENCE, so a link that pins a view is not
    // quietly overruled by what this browser happened to choose last time.
    // Everything else falls back to the stored choice, and a browser that has
    // never chosen opens Guided. The read happens here rather than in the
    // initial state because it touches localStorage: doing it during render
    // would make the server and the first client paint disagree.
    if (!urlPinsFloorMode()) setFloorModeState(readFloorMode());
    setNudge(!tourSeen() && welcomeSeen() && !nudgeOff());
    beacon("desk_view", true);
  }, []);
  useEffect(() => {
    if (paletteOn) beacon("palette_open");
  }, [paletteOn]);
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
      setWelcomeOn(false);
      setNudge(false);
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
      // /floor and other old links open the floor with the tour running.
      if (sp.get("tour") === "1") window.dispatchEvent(new Event("satoshi-tour"));
    } catch {
      /* no window */
    }
    urlReady.current = true;
  }, []);
  // Which floor a reader actually ended up on, once per session per floor. It
  // runs after the address and the saved preference have both been applied, so
  // it counts the floor that was really shown rather than the first guess.
  useEffect(() => {
    if (!urlReady.current) return;
    if (tab !== "satoshi") return;
    beacon(floorMode === "guided" ? "floor_guided_open" : "floor_pro_open", true);
  }, [floorMode, tab]);

  useEffect(() => {
    if (!urlReady.current) return;
    try {
      const u = new URL(window.location.href);
      if (tab === "satoshi") {
        if (u.pathname === "/") u.searchParams.set("tab", "satoshi");
        else u.searchParams.delete("tab");
      }
      else u.searchParams.set("tab", tab);
      if (floorMode === "guided" && tab === "satoshi") u.searchParams.set("view", "guided");
      else u.searchParams.delete("view");
      u.searchParams.delete("seat");
      u.searchParams.delete("tour");
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
      <FloorModeSwitch mode={floorMode} onMode={setFloorMode} />

      {/* Secondary navigation, and it is secondary: these are sections INSIDE
          the Pro Floor, chosen after the view above. Guided has no second row
          because it is deliberately one page. */}
      {floorMode === "pro" ? (
        <nav
          aria-label="Pro Floor sections"
          className="council-floor-tools gutter flex flex-wrap items-center gap-1 border-b border-border bg-surface py-1"
        >
          <span className="mr-2 hidden font-mono text-micro uppercase tracking-widest text-subtle sm:inline">
            Pro Floor
          </span>
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
            onWelcome={() => setWelcomeOn(true)}
          />
        </nav>
      ) : null}

      <div className="company-desk-intro company-container"><div><p className="company-eyebrow">{frame.settings.source === "demo" ? "Demo · Simulated data" : "Bitcoin · 15-minute paper research"}</p><h2>{tab === "satoshi" ? "The live floor." : tab === "atelier" ? "The gallery." : tab === "settings" ? "Your preferences." : desk ? "The specialist desks." : "Inside the research desk."}</h2></div><p>Paper only · No live orders</p>{nudge && !tourOn ? <button type="button" className="company-text-link" onClick={startTour}>Take a quick tour →</button> : null}</div>

      <LiveConnectionNotice frame={frame} />

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

      {desk || tab === "crew" ? (
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
            votes={frame.votes}
            knobs={frame.learner.knobs}
            demo={frame.settings.source === "demo"}
            last={last}
            onPro={() => setFloorMode("pro")}
          />
        )}
        {frame.snap && tab === "satoshi" && frame.chair && floorMode === "pro" && (
          <SatoshiTab
            snap={frame.snap}
            chair={frame.chair}
            votes={frame.votes}
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
      </main>

      {floorMode === "pro" && (tab === "satoshi" || desk || tab === "crew") && (
        <MetaFooter
          chair={frame.chair}
          law_wrongs={frame.learner.law_wrongs}
          lockdown={frame.learner.lockdown}
          lockdown_until={frame.learner.lockdown_until}
          tape={frame.learner.settle_tape}
          settling={frame.settling}
        />
      )}
      <PaperDisclaimer />
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
