import { useEffect, useMemo, useRef, useState } from "react";
import { TAB_SEATS } from "@/lib/desk/seats";
import { SiteHeader } from "./SiteHeader";
import { Crest } from "./Crest";
import { useDesk } from "@/lib/desk/store";
import { tourSeen } from "@/lib/desk/glossary";
import { CHAIR_SCALP, readScalp, scalpAvg } from "@/lib/desk/scalp";
import { SEAT_IDS, type SeatId, type TabId } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { BotCard } from "./BotCard";
import { MetaFooter, SatoshiTab } from "./SatoshiTab";
import { IntroBand } from "./IntroBand";
import { SettingsTab } from "./SettingsTab";
import { TopStrip } from "./TopStrip";
import { Tip } from "./Tip";
import { Tour } from "./Tour";
import { Toaster, toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { TrustStrip, Welcome } from "./Welcome";
import { applyDisplayPrefs, markWelcomeSeen, readSeatView, setSeatView as saveSeatView, TRUST_CHIPS, welcomeSeen, type SeatView } from "./prefs";
import { beacon } from "@/lib/desk/beacon";
import { Palette } from "./Palette";
import { FloorSkeleton } from "./Skeleton";
import { BoardTab } from "./Feedback";
import { useBoardUnread } from "./use-board-unread";
import { AtelierTab } from "./AtelierTab";
import { CrewTab } from "./CrewTab";
import { ArenaTab } from "./ArenaTab";
import { BooksTab } from "./BooksTab";

const PRIMARY: { id: TabId; label: string; href?: string }[] = [
  { id: "satoshi", label: "FLOOR" },
  { id: "structure", label: "DESKS" },
  { id: "arena", label: "ARENA", href: "/arena" },
  { id: "books", label: "BOOKS" },
  { id: "board", label: "BOARD" },
];
// One shape for every primary nav item — the tab buttons (FLOOR, DESKS, BOOKS,
// BOARD) and the ARENA room link alike — so every word sits at the same size in
// the same box, whether it is a <button> or an <a>.
const NAV_TAB = "flex min-h-11 shrink-0 items-center gap-1 rounded-md border px-2.5 font-mono text-micro tracking-wide";
const NAV_TAB_IDLE = "border-transparent text-muted hover:bg-surface-2 hover:text-fg";
const NAV_TAB_ON = "border-border-strong bg-surface-2 text-fg";
const DESKS: { id: TabId; label: string; intro: string }[] = [
  { id: "structure", label: "STRUCTURE", intro: "candles and swings · WICK, DRIFT, STREAK, EXHAUST" },
  { id: "tape", label: "TAPE", intro: "order flow and the Kalshi book · PULSE, TAPE, WHALE, VEL" },
  { id: "derivs", label: "DERIVS", intro: "funding, open interest, liquidations · CARRY, CHAIN, CASCADE, VOLT" },
  { id: "book", label: "BOOK", intro: "the odds themselves · ODDS, STRIKE, CHEAP, FADE, INDEX" },
  { id: "context", label: "CONTEXT", intro: "clock and regime · ORBIT, CLOCK, WIRE, WARDEN" },
];
const DESK_IDS = new Set<TabId>(DESKS.map((d) => d.id));
const MORE: { id: TabId; label: string; hint: string }[] = [
  { id: "crew", label: "PIT CREW", hint: "SWEEP · COACH · WRENCH · LEDGER" },
  { id: "atelier", label: "ATELIER", hint: "the gallery" },
  { id: "settings", label: "SETTINGS", hint: "demo, alerts, display" },
];
const NUDGE_KEY = "satoshi-desk-nudge-v1";
const LINKABLE_TABS = new Set<TabId>(["satoshi", "structure", "tape", "derivs", "book", "context", "books", "board", "crew", "atelier", "settings"]);

function nudgeOff(): boolean {
  try {
    return localStorage.getItem(NUDGE_KEY) === "off";
  } catch {
    return false;
  }
}

function MoreMenu({ tab, onTab, onTour, onSearch }: { tab: TabId; onTab: (t: TabId) => void; onTour: () => void; onSearch: () => void }) {
  const cur = MORE.find((m) => m.id === tab);
  const item = "flex min-h-10 cursor-pointer select-none items-center justify-between gap-3 rounded-sm px-2 font-mono text-micro text-fg outline-none data-[highlighted]:bg-surface-2";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="More tabs and pages"
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2.5 font-mono text-micro tracking-wide",
            cur ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {cur ? cur.label : "MORE"} <span aria-hidden="true">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-60 rounded-md border border-border bg-surface p-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
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
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {[
            ["/about", "How it works"],
            ["/faq", "FAQ"],
            ["/legal", "Paper only"],
          ].map(([href, label]) => (
            <DropdownMenu.Item key={href} asChild className={item}>
              <a href={href}>
                {label}
                <span className="text-subtle">page</span>
              </a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function DeskApp() {
  const frame = useDesk();
  const [tab, setTab] = useState<TabId>("satoshi");
  const boardUnread = useBoardUnread(tab === "board");
  const [focus, setFocus] = useState<SeatId | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [welcomeOn, setWelcomeOn] = useState(false);
  const [paletteOn, setPaletteOn] = useState(false);
  const [nudge, setNudge] = useState(false);
  // Read in the effect below, never during render: welcomeSeen() touches localStorage
  // and would otherwise differ between the server and the first client paint.
  const [returning, setReturning] = useState(false);
  const [seatView, setSeatViewState] = useState<SeatView>("auto");
  const setSeatView = (v: SeatView) => {
    setSeatViewState(v);
    saveSeatView(v);
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
    setNudge(!tourSeen() && welcomeSeen() && !nudgeOff());
    setReturning(welcomeSeen());
    beacon("desk_view", true);
  }, []);
  useEffect(() => {
    if (paletteOn) beacon("palette_open");
  }, [paletteOn]);
  useEffect(() => {
    if (!hasSnap) return;
    if (tourSeen() || welcomeSeen()) return;
    const t = window.setTimeout(() => setWelcomeOn(true), 600);
    return () => window.clearTimeout(t);
  }, [hasSnap]);
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
      (Object.entries(TAB_SEATS) as [Exclude<TabId, "satoshi" | "atelier" | "settings" | "board" | "crew" | "arena" | "books">, SeatId[]][]).find(
        ([, ids]) => ids.includes(seat),
      )?.[0] ?? "structure";
    setFocus(seat);
    setTab(dest);
  };

  // Deep links: /?tab=books opens a tab, /?seat=INDEX jumps to a seat; the address follows the tab.
  const urlReady = useRef(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("tab");
      if (t && t !== "arena" && LINKABLE_TABS.has(t as TabId)) setTab(t as TabId);
      const s = sp.get("seat")?.toUpperCase();
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
      u.searchParams.delete("seat");
      const next = `${u.pathname}${u.search}${u.hash}`;
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
    } catch {
      /* no window */
    }
  }, [tab]);

  const startTour = () => {
    setWelcomeOn(false);
    setNudge(false);
    setTourStep(0);
    setTourOn(true);
    beacon("tour_start");
  };
  const desk = DESKS.find((d) => d.id === tab) ?? null;
  const navRef = useRef<HTMLElement>(null);
  const [navMore, setNavMore] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const check = () => setNavMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);

  const seats =
    tab !== "satoshi" && tab !== "atelier" && tab !== "settings" && tab !== "board" && tab !== "crew" && tab !== "arena" && tab !== "books"
      ? TAB_SEATS[tab]
      : [];

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a href="#floor-main" className="skip-link">
        Skip to the floor
      </a>
      <SiteHeader
        fold="lg"
        tour="tour-header"
        onBrand={() => setTab("satoshi")}
        nav={
          <>
            <button
              type="button"
              aria-label="Search the desk (Command or Control K)"
              title="Search the desk · ⌘K"
              onClick={() => setPaletteOn(true)}
              className="btn btn-sm text-muted hover:text-fg"
            >
              <span aria-hidden="true">⌘K</span>
              <span className="sr-only lg:not-sr-only">search</span>
            </button>
            <button
              type="button"
              aria-label="Replay the 60-second tour"
              title="Replay the 60-second tour"
              onClick={startTour}
              className="btn btn-icon btn-sm text-muted hover:text-fg"
            >
              ?
            </button>
            <div className="relative min-w-0 max-w-full">
              {navMore ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-r from-transparent to-bg" /> : null}
              {navMore ? <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 z-10 -translate-y-1/2 font-mono text-micro text-subtle">›</span> : null}
              <nav ref={navRef} className="nav-scroll flex max-w-full items-center gap-1 overflow-x-auto" aria-label="Council tabs">
                {PRIMARY.map((t) => {
                  const active = t.id === "structure" ? DESK_IDS.has(tab) : tab === t.id;
                  if (t.href) {
                    return (
                      <a key={t.id} href={t.href} className={cn(NAV_TAB, NAV_TAB_IDLE)}>
                        <Tip k={`tab.${t.id}`} hoverOnly>
                          {t.label}
                        </Tip>
                      </a>
                    );
                  }
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(NAV_TAB, active ? NAV_TAB_ON : NAV_TAB_IDLE)}
                    >
                      <Tip k={t.id === "structure" ? "tab.floor" : `tab.${t.id}`} hoverOnly>
                        {t.label}
                      </Tip>
                      {t.id === "board" && boardUnread > 0 ? (
                        <span
                          aria-label={`${boardUnread} new`}
                          className="rounded-sm bg-wait/20 px-1 font-mono text-micro tabular text-wait"
                        >
                          {boardUnread}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <MoreMenu tab={tab} onTab={setTab} onTour={startTour} onSearch={() => setPaletteOn(true)} />
              </nav>
            </div>
          </>
        }
        menu={[
          ...PRIMARY.map((t) =>
            t.href
              ? { label: t.label, href: t.href, hint: "room" }
              : { label: t.label, onSelect: () => setTab(t.id), active: t.id === "structure" ? DESK_IDS.has(tab) : tab === t.id },
          ),
          ...MORE.map((m) => ({ label: m.label, hint: m.hint, onSelect: () => setTab(m.id), active: tab === m.id })),
          { label: "Search the desk", hint: "⌘K", onSelect: () => setPaletteOn(true) },
          { label: "Replay the 60-second tour", hint: "?", onSelect: startTour },
          { label: "How it works", href: "/about", hint: "page" },
          { label: "FAQ", href: "/faq", hint: "page" },
          { label: "Paper only", href: "/legal", hint: "page" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2/50 px-3 py-1.5">
        <TrustStrip className="hidden sm:flex" />
        <p className="min-w-0 truncate font-mono text-micro text-subtle sm:hidden">{TRUST_CHIPS.join(" · ")}</p>
        <Tip k="beta.disclaimer" className="hidden sm:inline">
          <span className="font-mono text-micro text-muted">Every UP / DOWN / WAIT is practice. Nothing here places a live trade, and none of it is advice.</span>
        </Tip>
        {nudge && !tourOn && tab !== "satoshi" ? (
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <button type="button" onClick={startTour} className="min-h-8 rounded-sm border border-border px-2 font-mono text-micro text-fg hover:bg-surface-2">
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
        <div className="nav-scroll flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3" aria-label="Seat desks">
          <span className="mr-1 shrink-0 font-mono text-micro uppercase tracking-widest text-subtle">desks</span>
          {DESKS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setTab(d.id)}
              aria-current={tab === d.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center rounded-md border px-2.5 font-mono text-micro tracking-wide",
                tab === d.id ? "border-border-strong bg-surface-2 text-fg" : "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Tip k={`tab.${d.id}`} hoverOnly>
                {d.label}
              </Tip>
            </button>
          ))}
          <span className="ml-auto hidden shrink-0 font-mono text-micro text-subtle lg:block">{desk.intro}</span>
        </div>
      ) : null}

      {tab === "satoshi" ? (
        <IntroBand
          demo={frame.settings.source === "demo"}
          nudge={nudge && !tourOn}
          returning={returning}
          onTour={startTour}
          onDismissNudge={() => {
            setNudge(false);
            try {
              localStorage.setItem(NUDGE_KEY, "off");
            } catch {
              /* private mode */
            }
          }}
        />
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

      <main id="floor-main" className={cn("min-h-0 flex-1", tab === "atelier" ? "overflow-hidden" : "overflow-auto")}>
        {!frame.snap && tab !== "atelier" && tab !== "board" && tab !== "settings" && <FloorSkeleton demo={frame.settings.source === "demo"} />}
        {frame.snap && tab === "satoshi" && frame.chair && (
          <SatoshiTab
            snap={frame.snap}
            chair={frame.chair}
            settings={frame.settings}
            callLog={frame.call_log}
            onJump={jump}
            v2={frame.v2}
            onOpenArena={() => setTab("arena")}
            onOpenBooks={() => setTab("books")}
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
                <span className="hidden lg:inline">snapshot {new Date(frame.snap.as_of).toISOString()} · shared across this tab</span>
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
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-micro text-subtle"
      >
        <Crest size={16} className="shrink-0 opacity-80" />
        <span>Paper research desk · Bitcoin only · Not financial advice · Not affiliated with Kalshi · No real money.</span>
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
          <button type="button" onClick={() => setPaletteOn(true)} className="min-h-8 hover:text-fg">
            Glossary ⌘K
          </button>
        </span>
      </footer>
      <Tour
        open={tourOn}
        step={tourStep}
        tab={tab}
        onTab={setTab}
        onStep={setTourStep}
        onClose={() => setTourOn(false)}
        onDone={() => {
          beacon("tour_done");
          toast("You're on the floor.", { description: "The chair's call is up top. Hover or tap any dotted label for a definition." });
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
      <Palette open={paletteOn} onOpenChange={setPaletteOn} onTab={setTab} onJump={jump} onTour={startTour} />
      <Toaster theme="dark" position="bottom-center" toastOptions={{ className: "font-mono text-ui" }} />
    </div>
  );
}
